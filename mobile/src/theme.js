export const colors = {
  background: '#F3F6F1',
  card: '#FFFFFF',
  text: '#1B2A1E',
  muted: '#6B7A6E',
  border: '#E1E8DF',
  primary: '#2E7D32',
  ok: '#2E7D32',
  low: '#D84315',
  offline: '#9E9E9E',
  track: '#E8EEE6',
};

export function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${formatTime(iso)}`;
}
