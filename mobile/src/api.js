import { API_URL, DEVICE_ID } from './config';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(body?.detail || `Request failed (${res.status})`, res.status);
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('Server did not respond', 0);
    if (err instanceof ApiError) throw err;
    throw new ApiError('Cannot reach the server. Check API_URL and Wi-Fi.', 0);
  } finally {
    clearTimeout(timer);
  }
}

export const getDevice = () => request(`/api/devices/${DEVICE_ID}`);

export const getReadings = (hours = 24) =>
  request(`/api/devices/${DEVICE_ID}/readings?hours=${hours}`);

export const getNotifications = (limit = 10) =>
  request(`/api/notifications?device_id=${DEVICE_ID}&limit=${limit}`);

export const updateDevice = (changes) =>
  request(`/api/devices/${DEVICE_ID}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const registerPushToken = (token) =>
  request('/api/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token, device_id: DEVICE_ID }),
  });
