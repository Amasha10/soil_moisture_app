from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ReadingIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    moisture_percent: float = Field(ge=0, le=100)
    raw_value: int = Field(ge=0, le=4095)
    sample_count: int = Field(default=1, ge=1)
    age_seconds: int = Field(default=0, ge=0, le=7 * 24 * 3600)


class ReadingOut(BaseModel):
    device_id: str
    moisture_percent: float
    raw_value: int
    sample_count: int
    created_at: datetime


class ReadingAck(BaseModel):
    status: str
    alert_triggered: bool


class DeviceOut(BaseModel):
    device_id: str
    name: str
    threshold: float
    alert_active: bool
    last_alert_at: datetime | None = None
    online: bool
    status: Literal["ok", "low", "no_data"]
    last_reading: ReadingOut | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    threshold: float | None = Field(default=None, ge=1, le=99)


class PushTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    device_id: str | None = None


class NotificationOut(BaseModel):
    device_id: str
    title: str
    body: str
    moisture_percent: float
    threshold: float
    created_at: datetime
