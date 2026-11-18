/*
 * Smart Soil Moisture Monitoring and Notification System
 * Board : ESP32 DevKit V1
 * Sensor: FC-28 soil moisture sensor
 *
 * Wiring
 *   FC-28 VCC -> ESP32 3V3
 *   FC-28 GND -> ESP32 GND
 *   FC-28 AO  -> ESP32 GPIO 34  (ADC1 pin, works while Wi-Fi is on)
 *   FC-28 DO  -> not connected
 *
 * Behaviour
 *   - Takes one sample every 10 s (each sample = 10 quick ADC reads averaged)
 *   - Every 5 minutes, averages all samples and uploads ONE reading to the backend
 *   - If the upload fails (Wi-Fi/server down), the reading is queued and retried
 *     every 30 s. Up to 24 readings (2 hours) are kept. The backend receives
 *     "age_seconds" so queued readings get the correct timestamp.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// Wi-Fi password and device key live in secrets.h (not committed).
// Copy secrets.example.h to secrets.h and fill it in.
#include "secrets.h"

// ================== PINS ==================
#define SOIL_SENSOR_PIN 34

// ================== WI-FI ==================
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// ================== BACKEND ==================
// Use your computer's LAN IP while testing (run uvicorn with --host 0.0.0.0)
const char* SERVER_URL     = "http://192.168.1.174:8000/api/readings";
const char* DEVICE_ID      = "esp32-soil-01";
const char* DEVICE_API_KEY = SECRET_DEVICE_API_KEY;   // must match DEVICE_API_KEY in backend .env

// ================== CALIBRATION ==================
// 1. Set CALIBRATION_MODE = true and upload.
// 2. Note the raw value with the probe in dry air / completely dry soil -> DRY_VALUE
// 3. Note the raw value with the probe in water / fully wet soil       -> WET_VALUE
// 4. Put the values below, set CALIBRATION_MODE = false and upload again.
const bool CALIBRATION_MODE = false;
const int  DRY_VALUE = 3500;   // higher raw value = drier
const int  WET_VALUE = 1300;   // lower raw value  = wetter

// ================== TIMING ==================
const unsigned long SAMPLE_INTERVAL_MS = 10UL * 1000UL;        // 10 seconds
const unsigned long UPLOAD_INTERVAL_MS = 5UL * 60UL * 1000UL;  // 5 minutes
const unsigned long RETRY_INTERVAL_MS  = 30UL * 1000UL;        // 30 seconds
const unsigned long WIFI_TIMEOUT_MS    = 15UL * 1000UL;
const int READS_PER_SAMPLE = 10;

// ================== OFFLINE QUEUE ==================
struct Reading {
  float percent;
  int raw;
  int samples;
  unsigned long measuredAt;   // millis() when the average was taken
};

const int QUEUE_SIZE = 24;
Reading queueBuf[QUEUE_SIZE];
int qHead = 0;
int qCount = 0;

// ================== STATE ==================
unsigned long lastSampleAt  = 0;
unsigned long windowStartAt = 0;
unsigned long lastRetryAt   = 0;
long rawSum = 0;
int  sampleCount = 0;

// ---------------------------------------------------------------
int readSensorRaw() {
  long sum = 0;
  for (int i = 0; i < READS_PER_SAMPLE; i++) {
    sum += analogRead(SOIL_SENSOR_PIN);
    delay(10);
  }
  return (int)(sum / READS_PER_SAMPLE);
}

float rawToPercent(int raw) {
  float pct = (float)(DRY_VALUE - raw) * 100.0f / (float)(DRY_VALUE - WET_VALUE);
  if (pct < 0.0f)   pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return pct;
}

// ---------------------------------------------------------------
bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("Connecting to Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("Wi-Fi connection failed");
  return false;
}

// ---------------------------------------------------------------
void enqueue(const Reading& r) {
  if (qCount == QUEUE_SIZE) {            // full -> drop the oldest
    qHead = (qHead + 1) % QUEUE_SIZE;
    qCount--;
    Serial.println("Queue full, oldest reading dropped");
  }
  queueBuf[(qHead + qCount) % QUEUE_SIZE] = r;
  qCount++;
}

// Returns HTTP status code, or -1 if there is no Wi-Fi / connection error
int sendReading(const Reading& r) {
  if (!ensureWiFi()) return -1;

  unsigned long ageSec = (millis() - r.measuredAt) / 1000UL;

  String payload = String("{\"device_id\":\"") + DEVICE_ID +
                   "\",\"moisture_percent\":" + String(r.percent, 1) +
                   ",\"raw_value\":" + r.raw +
                   ",\"sample_count\":" + r.samples +
                   ",\"age_seconds\":" + ageSec + "}";

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;

  if (strncmp(SERVER_URL, "https", 5) == 0) {
    // For a real deployment, replace setInsecure() with setCACert(rootCA)
    secureClient.setInsecure();
    http.begin(secureClient, SERVER_URL);
  } else {
    http.begin(plainClient, SERVER_URL);
  }

  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  int code = http.POST(payload);

  Serial.print("POST ");
  Serial.print(payload);
  Serial.print(" -> ");
  Serial.println(code);
  if (code > 0) {
    Serial.println(http.getString());
  }

  http.end();
  return code;
}

void flushQueue() {
  while (qCount > 0) {
    int code = sendReading(queueBuf[qHead]);

    bool success     = (code >= 200 && code < 300);
    bool clientError = (code >= 400 && code < 500 && code != 429); // bad key/payload: retrying won't help

    if (success || clientError) {
      if (clientError) {
        Serial.println("Server rejected reading (check API key / payload). Dropped.");
      }
      qHead = (qHead + 1) % QUEUE_SIZE;
      qCount--;
    } else {
      Serial.print("Upload failed, ");
      Serial.print(qCount);
      Serial.println(" reading(s) waiting. Will retry.");
      break;
    }
  }
}

// ---------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  analogReadResolution(12);                          // 0 - 4095
  analogSetPinAttenuation(SOIL_SENSOR_PIN, ADC_11db); // full 0 - ~3.3 V range

  Serial.println();
  Serial.println("Smart Soil Moisture Monitoring System");
  Serial.println("-------------------------------------");

  if (CALIBRATION_MODE) {
    Serial.println("CALIBRATION MODE: printing raw values, no uploads");
    return;
  }

  ensureWiFi();

  unsigned long now = millis();
  lastSampleAt  = now - SAMPLE_INTERVAL_MS;  // take the first sample immediately
  windowStartAt = now;
  lastRetryAt   = now;
}

void loop() {
  if (CALIBRATION_MODE) {
    Serial.print("Raw value: ");
    Serial.println(readSensorRaw());
    delay(1000);
    return;
  }

  unsigned long now = millis();

  // 1) Sample every 10 seconds
  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    int raw = readSensorRaw();
    rawSum += raw;
    sampleCount++;
    Serial.printf("Sample %d | raw=%d | moisture=%.1f%%\n", sampleCount, raw, rawToPercent(raw));
  }

  // 2) Every 5 minutes: average, queue and upload
  if (now - windowStartAt >= UPLOAD_INTERVAL_MS && sampleCount > 0) {
    int avgRaw = (int)(rawSum / sampleCount);
    Reading r = { rawToPercent(avgRaw), avgRaw, sampleCount, now };

    Serial.printf("5-min average -> raw=%d, moisture=%.1f%% (%d samples)\n",
                  r.raw, r.percent, r.samples);

    enqueue(r);
    rawSum = 0;
    sampleCount = 0;
    windowStartAt = now;

    flushQueue();
    lastRetryAt = millis();
  }

  // 3) Retry pending uploads every 30 seconds
  if (qCount > 0 && millis() - lastRetryAt >= RETRY_INTERVAL_MS) {
    lastRetryAt = millis();
    flushQueue();
  }

  delay(50);
}
