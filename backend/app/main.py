import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import ReturnDocument

from . import db as database
from .config import settings
from .db import get_db
from .push import send_expo_push
from .schemas import (
    DeviceOut,
    DeviceUpdate,
    NotificationOut,
    PushTokenIn,
    ReadingAck,
    ReadingIn,
    ReadingOut,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

# Readings older than this (uploaded late from the ESP32 queue) are stored but don't trigger alerts
ALERT_MAX_AGE_SECONDS = 10 * 60


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    log.info("Connected to MongoDB")
    yield
    await database.close()


app = FastAPI(title="Smart Soil Moisture Monitoring API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------- helpers
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def device_defaults(device_id: str, now: datetime) -> dict:
    return {
        "device_id": device_id,
        "name": device_id,
        "threshold": settings.default_threshold,
        "alert_active": False,
        "last_alert_at": None,
        "created_at": now,
    }


async def latest_reading(device_id: str) -> dict | None:
    return await get_db().readings.find_one(
        {"device_id": device_id}, {"_id": 0, "received_at": 0}, sort=[("created_at", -1)]
    )


async def build_device_out(device: dict) -> DeviceOut:
    reading = await latest_reading(device["device_id"])
    if reading is None:
        status, online = "no_data", False
    else:
        status = "low" if reading["moisture_percent"] < device["threshold"] else "ok"
        online = utcnow() - reading["created_at"] <= timedelta(minutes=settings.offline_after_minutes)
    return DeviceOut(
        device_id=device["device_id"],
        name=device.get("name") or device["device_id"],
        threshold=device["threshold"],
        alert_active=device.get("alert_active", False),
        last_alert_at=device.get("last_alert_at"),
        online=online,
        status=status,
        last_reading=ReadingOut(**reading) if reading else None,
    )


async def evaluate_alert(device: dict, moisture: float, now: datetime, background: BackgroundTasks) -> bool:
    """Decide whether a low-moisture notification must be sent. Returns True if one was triggered."""
    db = get_db()
    threshold = device["threshold"]
    device_id = device["device_id"]

    if moisture < threshold:
        last_alert = device.get("last_alert_at")
        due = (
            not device.get("alert_active")
            or last_alert is None
            or now - last_alert >= timedelta(hours=settings.reminder_hours)
        )
        if not due:
            return False

        name = device.get("name") or device_id
        title = "Soil moisture is low"
        body = f"{name}: soil moisture is {moisture:.0f}% (below {threshold:.0f}%). Please water the plant."

        await db.devices.update_one(
            {"device_id": device_id}, {"$set": {"alert_active": True, "last_alert_at": now}}
        )
        await db.notifications.insert_one(
            {
                "device_id": device_id,
                "title": title,
                "body": body,
                "moisture_percent": moisture,
                "threshold": threshold,
                "created_at": now,
            }
        )

        tokens = [
            t["token"]
            async for t in db.push_tokens.find({"$or": [{"device_id": device_id}, {"device_id": None}]})
        ]
        # Send in the background so the ESP32 gets its HTTP response immediately
        background.add_task(
            send_expo_push,
            tokens,
            title,
            body,
            {"type": "low_moisture", "device_id": device_id, "moisture_percent": moisture},
        )
        log.info("Low moisture alert for %s (%.1f%% < %.1f%%)", device_id, moisture, threshold)
        return True

    # Clear the alert only after the soil is clearly wet again (prevents flapping around the threshold)
    if device.get("alert_active") and moisture >= threshold + settings.hysteresis:
        await db.devices.update_one({"device_id": device_id}, {"$set": {"alert_active": False}})
        log.info("Alert cleared for %s (%.1f%%)", device_id, moisture)

    return False


# ---------------------------------------------------------------- routes
@app.get("/health")
async def health():
    await get_db().command("ping")
    return {"status": "ok"}


@app.post("/api/readings", response_model=ReadingAck, status_code=201)
async def create_reading(
    reading: ReadingIn,
    background: BackgroundTasks,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Called by the ESP32 every 5 minutes with the averaged reading."""
    if not secrets.compare_digest(x_api_key, settings.device_api_key):
        raise HTTPException(status_code=401, detail="Invalid device API key")

    db = get_db()
    now = utcnow()

    await db.readings.insert_one(
        {
            "device_id": reading.device_id,
            "moisture_percent": round(reading.moisture_percent, 1),
            "raw_value": reading.raw_value,
            "sample_count": reading.sample_count,
            "created_at": now - timedelta(seconds=reading.age_seconds),
            "received_at": now,
        }
    )

    device = await db.devices.find_one_and_update(
        {"device_id": reading.device_id},
        {"$setOnInsert": device_defaults(reading.device_id, now)},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    alert = False
    if reading.age_seconds <= ALERT_MAX_AGE_SECONDS:
        alert = await evaluate_alert(device, reading.moisture_percent, now, background)

    return ReadingAck(status="stored", alert_triggered=alert)


@app.get("/api/devices", response_model=list[DeviceOut])
async def list_devices():
    devices = [d async for d in get_db().devices.find({}, {"_id": 0})]
    return [await build_device_out(d) for d in devices]


@app.get("/api/devices/{device_id}", response_model=DeviceOut)
async def get_device(device_id: str):
    device = await get_db().devices.find_one({"device_id": device_id}, {"_id": 0})
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found. Waiting for its first reading.")
    return await build_device_out(device)


@app.patch("/api/devices/{device_id}", response_model=DeviceOut)
async def update_device(device_id: str, update: DeviceUpdate):
    changes = update.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "threshold" in changes:
        changes["alert_active"] = False  # re-evaluate against the new threshold on the next reading

    device = await get_db().devices.find_one_and_update(
        {"device_id": device_id},
        {"$set": changes},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return await build_device_out(device)


@app.get("/api/devices/{device_id}/readings", response_model=list[ReadingOut])
async def get_readings(
    device_id: str,
    hours: int = Query(24, ge=1, le=24 * 30),
    limit: int = Query(2000, ge=1, le=10000),
):
    """Historical readings, oldest first."""
    since = utcnow() - timedelta(hours=hours)
    cursor = (
        get_db()
        .readings.find(
            {"device_id": device_id, "created_at": {"$gte": since}},
            {"_id": 0, "received_at": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    rows = [r async for r in cursor]
    rows.reverse()
    return rows


@app.post("/api/push-tokens", status_code=201)
async def register_push_token(body: PushTokenIn):
    """Called by the mobile app on startup to receive notifications."""
    if not (body.token.startswith("ExponentPushToken[") or body.token.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Not an Expo push token")
    await get_db().push_tokens.update_one(
        {"token": body.token},
        {"$set": {"device_id": body.device_id, "updated_at": utcnow()}},
        upsert=True,
    )
    return {"status": "registered"}


@app.delete("/api/push-tokens/{token}")
async def remove_push_token(token: str):
    await get_db().push_tokens.delete_one({"token": token})
    return {"status": "removed"}


@app.get("/api/notifications", response_model=list[NotificationOut])
async def list_notifications(device_id: str | None = None, limit: int = Query(20, ge=1, le=200)):
    query = {"device_id": device_id} if device_id else {}
    cursor = get_db().notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    return [n async for n in cursor]
