import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getDevice,
  getNotifications,
  getReadings,
  registerPushToken,
  updateDevice,
} from '../api';
import MoistureChart from '../components/MoistureChart';
import MoistureGauge from '../components/MoistureGauge';
import { REFRESH_INTERVAL_MS } from '../config';
import { registerForPushNotifications } from '../notifications';
import { colors, formatDateTime, timeAgo } from '../theme';

const RANGES = [
  { label: '24 h', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

export default function DashboardScreen() {
  const [device, setDevice] = useState(null);
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [waiting, setWaiting] = useState(false); // device not created yet (no readings)
  const [pushStatus, setPushStatus] = useState('Setting up notifications...');
  const [thresholdInput, setThresholdInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dev, rows, notes] = await Promise.all([
        getDevice(),
        getReadings(hours),
        getNotifications(10),
      ]);
      setDevice(dev);
      setReadings(rows);
      setAlerts(notes);
      setWaiting(false);
      setError(null);
    } catch (err) {
      if (err.status === 404) {
        setWaiting(true);
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hours]);

  // Initial load + auto refresh
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep the threshold input in sync with the server value
  useEffect(() => {
    if (device) setThresholdInput(String(Math.round(device.threshold)));
  }, [device?.threshold]);

  // Register for push notifications once
  useEffect(() => {
    (async () => {
      try {
        const token = await registerForPushNotifications();
        await registerPushToken(token);
        setPushStatus('Notifications on');
      } catch (err) {
        setPushStatus(`Notifications off: ${err.message}`);
      }
    })();
  }, []);

  // Refresh when a notification arrives or is tapped
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => load());
    const tapped = Notifications.addNotificationResponseReceivedListener(() => load());
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const saveThreshold = async () => {
    const value = Number(thresholdInput);
    if (!Number.isFinite(value) || value < 1 || value > 99) {
      Alert.alert('Invalid value', 'Enter a number between 1 and 99.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDevice({ threshold: value });
      setDevice(updated);
      Alert.alert('Saved', `You will be notified when moisture drops below ${value}%.`);
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const reading = device?.last_reading;
  const isLow = device?.status === 'low';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Soil Moisture</Text>
        {device && (
          <View style={styles.onlineRow}>
            <View
              style={[styles.dot, { backgroundColor: device.online ? colors.ok : colors.offline }]}
            />
            <Text style={styles.muted}>
              {device.name} · {device.online ? 'Online' : 'Offline'}
            </Text>
          </View>
        )}
      </View>

      {error && (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {waiting && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Waiting for the sensor</Text>
          <Text style={styles.muted}>
            No readings received yet. The ESP32 uploads an average every 5 minutes.
          </Text>
        </View>
      )}

      {device && (
        <>
          <View style={[styles.card, isLow && styles.lowCard]}>
            <MoistureGauge
              value={reading?.moisture_percent}
              threshold={device.threshold}
              status={device.status}
            />
            <Text style={[styles.statusText, { color: isLow ? colors.low : colors.ok }]}>
              {device.status === 'no_data'
                ? 'No data yet'
                : isLow
                  ? 'Soil is too dry. Water the plant now.'
                  : 'Moisture level is good.'}
            </Text>
            <Text style={styles.updated}>Last updated {timeAgo(reading?.created_at)}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>History</Text>
              <View style={styles.segment}>
                {RANGES.map((r) => (
                  <Pressable
                    key={r.hours}
                    onPress={() => setHours(r.hours)}
                    style={[styles.segmentItem, hours === r.hours && styles.segmentActive]}
                  >
                    <Text
                      style={[styles.segmentText, hours === r.hours && styles.segmentTextActive]}
                    >
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <MoistureChart readings={readings} threshold={device.threshold} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Alert threshold</Text>
            <Text style={styles.muted}>Notify me when soil moisture drops below:</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={thresholdInput}
                onChangeText={setThresholdInput}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.percentSign}>%</Text>
              <Pressable
                style={[styles.button, saving && { opacity: 0.6 }]}
                onPress={saveThreshold}
                disabled={saving}
              >
                <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent alerts</Text>
            {alerts.length === 0 ? (
              <Text style={styles.muted}>No low-moisture alerts yet.</Text>
            ) : (
              alerts.map((a, i) => (
                <View key={`${a.created_at}-${i}`} style={styles.alertRow}>
                  <Text style={styles.alertValue}>{Math.round(a.moisture_percent)}%</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertBody}>{a.body}</Text>
                    <Text style={styles.alertTime}>{formatDateTime(a.created_at)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}

      <Text style={styles.pushStatus}>{pushStatus}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  onlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  muted: { color: colors.muted, fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lowCard: { borderColor: colors.low, borderWidth: 2 },
  errorCard: { borderColor: colors.low, backgroundColor: '#FFF3EF' },
  errorText: { color: colors.low },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 6 },
  statusText: { fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 16 },
  updated: { color: colors.muted, textAlign: 'center', marginTop: 4, fontSize: 13 },
  segment: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: 8, padding: 2 },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 12, color: colors.muted },
  segmentTextActive: { color: colors.text, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 18,
    width: 70,
    textAlign: 'center',
    color: colors.text,
  },
  percentSign: { fontSize: 18, marginLeft: 6, color: colors.text, flex: 1 },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  alertValue: { fontSize: 18, fontWeight: '700', color: colors.low, width: 54 },
  alertBody: { color: colors.text, fontSize: 14 },
  alertTime: { color: colors.muted, fontSize: 12, marginTop: 2 },
  pushStatus: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 6 },
});
