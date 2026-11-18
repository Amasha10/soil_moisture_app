import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export default function MoistureGauge({ value, threshold, status }) {
  const color = status === 'low' ? colors.low : colors.ok;
  const pct = Math.max(0, Math.min(100, value ?? 0));

  return (
    <View>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color }]}>{value == null ? '--' : Math.round(value)}</Text>
        <Text style={[styles.unit, { color }]}>%</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
        <View style={[styles.marker, { left: `${threshold}%` }]} />
      </View>

      <View style={styles.labels}>
        <Text style={styles.label}>Dry</Text>
        <Text style={styles.label}>Alert below {Math.round(threshold)}%</Text>
        <Text style={styles.label}>Wet</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  valueRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  value: { fontSize: 72, fontWeight: '700', lineHeight: 80 },
  unit: { fontSize: 28, fontWeight: '600', marginTop: 10, marginLeft: 4 },
  track: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.track,
    marginTop: 12,
    overflow: 'visible',
  },
  fill: { height: '100%', borderRadius: 7 },
  marker: {
    position: 'absolute',
    top: -4,
    width: 3,
    height: 22,
    marginLeft: -1.5,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  label: { fontSize: 12, color: colors.muted },
});
