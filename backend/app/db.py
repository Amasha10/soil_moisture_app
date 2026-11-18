import certifi
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import settings

_client: AsyncMongoClient | None = None


def get_db() -> AsyncDatabase:
    if _client is None:
        raise RuntimeError("Database not connected")
    return _client[settings.mongodb_db]


async def connect() -> None:
    global _client
    options = {"tz_aware": True}
    if settings.mongodb_uri.startswith("mongodb+srv://"):
        # Atlas uses TLS; python.org builds on macOS ship without root certificates
        options["tlsCAFile"] = certifi.where()
    _client = AsyncMongoClient(settings.mongodb_uri, **options)
    db = get_db()
    await db.readings.create_index([("device_id", ASCENDING), ("created_at", DESCENDING)])
    await db.devices.create_index("device_id", unique=True)
    await db.push_tokens.create_index("token", unique=True)
    await db.notifications.create_index([("device_id", ASCENDING), ("created_at", DESCENDING)])


async def close() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
