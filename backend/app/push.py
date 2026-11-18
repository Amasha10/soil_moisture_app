"""Sends push notifications through the Expo push service."""

import logging

import httpx

from .config import settings
from .db import get_db

log = logging.getLogger("push")


async def send_expo_push(tokens: list[str], title: str, body: str, data: dict) -> int:
    """Send one notification to every token. Returns how many were accepted."""
    if not tokens:
        log.info("No push tokens registered, skipping push")
        return 0

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
            "priority": "high",
            "channelId": "soil-alerts",
        }
        for token in tokens
    ]

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"

    accepted = 0
    db = get_db()

    async with httpx.AsyncClient(timeout=15) as client:
        for i in range(0, len(messages), 100):  # Expo accepts max 100 per request
            chunk = messages[i : i + 100]
            try:
                resp = await client.post(settings.expo_push_url, json=chunk, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                log.warning("Expo push request failed: %s", exc)
                continue

            tickets = resp.json().get("data", [])
            for message, ticket in zip(chunk, tickets):
                if ticket.get("status") == "ok":
                    accepted += 1
                    continue
                error = (ticket.get("details") or {}).get("error")
                log.warning("Push to %s failed: %s", message["to"], ticket.get("message"))
                if error == "DeviceNotRegistered":
                    await db.push_tokens.delete_one({"token": message["to"]})

    log.info("Push sent to %d/%d tokens", accepted, len(tokens))
    return accepted
