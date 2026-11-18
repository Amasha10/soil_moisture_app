import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, formatTime } from '../theme';

const MAX_BARS = 48;

// Groups readings into at most MAX_BARS buckets and averages each bucket
function bucketize(readings) {
  if (!readings.length) return [];
  const size = Math.ceil(readings.length / MAX_BARS);
  const buckets = [];
  for (let i = 0; i < readings.length; i += size) {
    const group = readings.slice(i, i + size);
    const avg = group.reduce((sum, r) => sum + r.moisture_percent, 0) / group.length;
    buckets.push({ value: avg, time: group[group.length - 1].created_at });
  }
  return buckets;
}

export default function MoistureChart({ readings, threshold }) {
  const buckets = useMemo(() => bucketize(readings), [readings]);

  const stats = useMemo(() => {
    if (!readings.length) return null;
    const values = readings.map((r) => r.moisture_percent);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }, [readings]);

  if (!buckets.length) {
    return <Text style={styles.empty}>No readings in this period yet.</Text>;
  }

  return (
    <View>
      <View style={styles.chart}>
        <View style={[styles.threshold, { bottom: `${threshold}%` }]} />
        {buckets.map((b, i) => (
          <View key={i} style={styles.slot}>
            <View
              style={[
                styles.bar,
                {
                  height: `${Math.max(b.value, 2)}%`,
                  backgroundColor: b.value < threshold ? colors.low : colors.ok,
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>{formatTime(buckets[0].time)}</Text>
        <Text style={styles.axisText}>{formatTime(buckets[buckets.length - 1].time)}</Text>
      </View>

      {stats && (
        <View style={styles.stats}>
          <Stat label="Min" value={stats.min} />
          <Stat label="Average" value={stats.avg} />
          <Stat label="Max" value={stats.max} />
          <Stat label="Readings" value={readings.length} raw />
        </View>
      )}
    </View>
  );
}

function Stat({ label, value, raw }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{raw ? value : `${Math.round(value)}%`}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    height: 140,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end', marginHorizontal: 1 },
  bar: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  threshold: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.text,
    opacity: 0.4,
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { fontSize: 11, color: colors.muted },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 30 },
});
