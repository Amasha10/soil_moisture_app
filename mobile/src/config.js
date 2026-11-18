// Use your computer's LAN IP (not localhost) when testing on a phone.
// Phone, ESP32 and computer must be on the same Wi-Fi network.
export const API_URL = 'http://192.168.1.174:8000';

// Must match DEVICE_ID in the ESP32 sketch
export const DEVICE_ID = 'esp32-soil-01';

// How often the dashboard refreshes while open (ms)
export const REFRESH_INTERVAL_MS = 60 * 1000;
