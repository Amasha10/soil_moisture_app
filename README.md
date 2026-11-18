# Smart Soil Moisture Monitoring and Notification System using ESP32

```
FC-28 ──► ESP32 ──(Wi-Fi, HTTP POST every 5 min)──► FastAPI ──► MongoDB
                                                       │
                                                       └─(moisture low)──► Expo Push ──► React Native app
```

| Folder      | What it is |
|-------------|------------|
| `firmware/` | ESP32 sketch: samples every 10 s, uploads the 5-minute average, queues readings if Wi-Fi drops |
| `backend/`  | Python FastAPI + MongoDB: stores readings, decides when to alert, sends push notifications |
| `mobile/`   | React Native (Expo) app: live moisture, history chart, threshold setting, alert list, push notifications |

---

## 1. Firmware (ESP32 DevKit V1)

Wiring: FC-28 VCC → 3V3, GND → GND, AO → GPIO 34, DO not connected.

1. Arduino IDE → Boards Manager → install **esp32 by Espressif Systems**. Board: **ESP32 Dev Module**.
2. Open `firmware/soil_moisture_monitor/soil_moisture_monitor.ino`.
3. **Calibrate:** set `CALIBRATION_MODE = true`, upload, open Serial Monitor (115200).
   - Probe dry (in air or bone-dry soil) → note the value → `DRY_VALUE`
   - Probe in a glass of water (only up to the line on the probe) → note the value → `WET_VALUE`
4. Copy `secrets.example.h` to `secrets.h` (same folder) and fill in your Wi-Fi name, password and `DEVICE_API_KEY`. Set `CALIBRATION_MODE = false` and set `SERVER_URL`
   (your computer's LAN IP, e.g. `http://192.168.1.100:8000/api/readings`).
5. Upload. The Serial Monitor shows every sample and every upload result.

Percentage formula: `moisture % = (DRY_VALUE − raw) × 100 / (DRY_VALUE − WET_VALUE)`, clamped to 0–100.

> The ESP32 uses 2.4 GHz Wi-Fi only. GPIO 34 is an ADC1 pin, so it keeps working while Wi-Fi is on (ADC2 pins don't).

## 2. Backend (FastAPI + MongoDB)

Requires Python 3.10+ and MongoDB (local install or a free MongoDB Atlas cluster).

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then edit MONGODB_URI and DEVICE_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open http://localhost:8000/docs to see and try every endpoint.

**Test without hardware:** `python scripts/simulate_device.py --start 40 --step 3` posts a drying reading every 10 seconds, so an alert fires within about a minute.

### API

| Method | Path | Used by | Purpose |
|--------|------|---------|---------|
| POST | `/api/readings` | ESP32 (`X-API-Key` header) | Store a 5-min average, check the alert rule |
| GET | `/api/devices/{id}` | App | Current moisture, status (`ok`/`low`/`no_data`), online flag, threshold |
| PATCH | `/api/devices/{id}` | App | Change `threshold` or `name` |
| GET | `/api/devices/{id}/readings?hours=24` | App | History (oldest first) |
| GET | `/api/notifications?device_id=…` | App | Past low-moisture alerts |
| POST | `/api/push-tokens` | App | Register the phone for push |
| GET | `/health` | — | Health check (pings MongoDB) |

### Alert rule

- Moisture **below the threshold** (default 30%) → one push notification: *"Soil moisture is 24% (below 30%). Please water the plant."*
- It is **not repeated** on every reading while still dry. A reminder is sent only after `REMINDER_HOURS` (default 3 h).
- The alert **resets** once moisture rises to threshold + `HYSTERESIS` (default 35%). This stops repeated notifications when the value hovers around 30%.
- Readings that arrive late from the ESP32's offline queue (older than 10 min) are stored but don't trigger alerts.

### MongoDB collections

- `readings` — `device_id, moisture_percent, raw_value, sample_count, created_at, received_at`
- `devices` — `device_id, name, threshold, alert_active, last_alert_at`
- `push_tokens` — `token, device_id`
- `notifications` — `device_id, title, body, moisture_percent, threshold, created_at`

### Deploying to Railway

`backend/railway.json` sets the start command (`uvicorn` on Railway's `$PORT`) and the `/health` check.

```bash
npm i -g @railway/cli
railway login
cd backend
railway init                      # create a project
railway add --database mongo      # or skip and use a MongoDB Atlas URI
railway add --service api         # empty service for the backend
railway variables --service api \
  --set 'MONGODB_URI=${{MongoDB.MONGO_URL}}' \
  --set "DEVICE_API_KEY=$(openssl rand -hex 16)"
railway up --service api          # upload and deploy this folder
railway domain --service api      # get a public https://….up.railway.app URL
```

Any other variable from `.env.example` can be set the same way. If you deploy from GitHub instead, set the service's **Root Directory** to `/backend` and **Config File** to `/backend/railway.json`.

Then point the clients at the public URL:
- Firmware: `SERVER_URL = "https://<your-app>.up.railway.app/api/readings"`, and `DEVICE_API_KEY` set to the value above (`railway variables --service api` shows it).
- App: `API_URL` in `mobile/src/config.js`.

## 3. Mobile app (React Native / Expo)

```bash
npx create-expo-app@latest soil-app --template blank
cd soil-app
npx expo install expo-notifications expo-device expo-constants expo-build-properties expo-status-bar
```

Copy `App.js`, `app.json` and the `src/` folder from `mobile/` into `soil-app/` (replace the generated `App.js`/`app.json`).
Edit `src/config.js` → `API_URL` = your computer's LAN IP, `DEVICE_ID` = same as the sketch.

### Push notifications setup (required once)

Remote push notifications **do not work in Expo Go** on Android (SDK 53+). You need a development build:

1. `npm install -g eas-cli` → `eas login` → `eas init` (writes the real `projectId` into `app.json`).
2. **Android:** create a Firebase project → add an Android app with package `com.dotailabs.soilmoisture` →
   download `google-services.json` into the project root. Then upload the FCM V1 service-account key with
   `eas credentials` (Android → Push Notifications: FCM V1). If you don't need push yet, remove the `googleServicesFile` line from `app.json`.
3. Build and install: `eas build --profile development --platform android`
   (or `npx expo run:android` with a phone connected over USB).
4. Start the dev server: `npx expo start --dev-client`.

The app asks for notification permission and registers the phone with the backend on first launch. The bottom of the dashboard shows "Notifications on", or the reason they're off.

`usesCleartextTraffic` in `app.json` allows plain `http://` to your laptop during development. Once the backend is deployed with HTTPS, you can remove it.

### What the app shows

- Big moisture % with a bar and threshold marker. It turns red with "Soil is too dry. Water the plant now." when the value is low.
- Online/offline dot (offline = no reading for 15 min) and "last updated".
- History chart for 24 h / 7 days / 30 days with min / average / max.
- Editable alert threshold.
- List of recent alerts. Pull down to refresh. The dashboard also refreshes every minute and whenever a notification arrives.

## Testing checklist

1. Run the backend → `/health` returns `ok`.
2. Run `simulate_device.py` → readings appear in `/docs` → `GET /api/devices/esp32-soil-01`.
3. Open the app → the dashboard updates → when the value drops below 30%, the phone gets the notification.
4. Stop the simulator, flash the ESP32 → real readings arrive every 5 minutes.
5. Dry-soil test: take the probe out of the soil → within 5 minutes you get the "water now" notification. Put it in wet soil → the alert resets.

## Tips

- The FC-28 probe corrodes if powered all the time. For long-term use, power VCC from a GPIO, switch it on only while reading, and increase `SAMPLE_INTERVAL_MS`.
- To deploy, put the backend on a cloud VM with HTTPS and MongoDB Atlas, then change `SERVER_URL` in the sketch and `API_URL` in the app.
