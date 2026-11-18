"""
Pretend to be the ESP32 so you can test the backend and the app without hardware.

    python scripts/simulate_device.py                      # one reading every 10 s, slowly drying
    python scripts/simulate_device.py --interval 300       # real 5-minute cadence
    python scripts/simulate_device.py --start 40 --step 3  # dries faster -> triggers an alert sooner
"""

import argparse
import random
import time

import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:8000/api/readings")
parser.add_argument("--key", default="change-this-device-key")
parser.add_argument("--device", default="esp32-soil-01")
parser.add_argument("--interval", type=float, default=10, help="seconds between uploads")
parser.add_argument("--start", type=float, default=60, help="starting moisture %%")
parser.add_argument("--step", type=float, default=1.5, help="how much it dries per upload")
args = parser.parse_args()

DRY, WET = 3500, 1300
moisture = args.start

while True:
    moisture = max(0.0, moisture - args.step + random.uniform(-0.5, 0.5))
    if moisture < 5:  # "someone watered it"
        moisture = random.uniform(70, 85)
    raw = int(DRY - moisture / 100 * (DRY - WET))

    payload = {
        "device_id": args.device,
        "moisture_percent": round(moisture, 1),
        "raw_value": raw,
        "sample_count": 30,
        "age_seconds": 0,
    }
    try:
        r = httpx.post(args.url, json=payload, headers={"X-API-Key": args.key}, timeout=10)
        print(f"{payload['moisture_percent']:5.1f}%  -> {r.status_code} {r.text}")
    except httpx.HTTPError as exc:
        print("Request failed:", exc)
    time.sleep(args.interval)
