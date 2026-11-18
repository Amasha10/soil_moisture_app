from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # MongoDB
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "soil_monitor"

    # Key the ESP32 sends in the X-API-Key header
    device_api_key: str = "change-this-device-key"

    # Alert rules
    default_threshold: float = 30.0   # % below which the soil is "too dry"
    hysteresis: float = 5.0           # must rise to threshold + this to clear the alert
    reminder_hours: float = 3.0       # repeat the alert if still dry after this many hours
    offline_after_minutes: int = 15   # device shown as offline if no reading for this long

    # Expo push service
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"
    expo_access_token: str | None = None  # only needed if push security is enabled in Expo

    cors_origins: str = "*"


settings = Settings()
