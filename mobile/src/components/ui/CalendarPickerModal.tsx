import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface SingleProps {
  mode: 'single';
  value: Date | null;
  onApply: (value: Date) => void;
}
interface RangeProps {
  mode: 'range';
  value: { start: Date | null; end: Date | null };
  onApply: (value: { start: Date; end: Date }) => void;
}

type Props = (SingleProps | RangeProps) & {
  visible: boolean;
  onDismiss: () => void;
  title: string;
};

/**
 * "Select meeting date" / "Select date range" — same calendar grid either way,
 * just a different selection + highlight rule. Footer is always Clear / Cancel
 * / Apply, matching the reference app's date dialogs exactly.
 */
export function CalendarPickerModal(props: Props) {
  const { visible, onDismiss, title, mode } = props;
  const initial = mode === 'single' ? props.value ?? new Date() : props.value.start ?? new Date();
  const [cursor, setCursor] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [single, setSingle] = useState<Date | null>(mode === 'single' ? props.value : null);
  const [rangeStart, setRangeStart] = useState<Date | null>(mode === 'range' ? props.value.start : null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(mode === 'range' ? props.value.end : null);

  useEffect(() => {
    if (!visible) return;
    if (mode === 'single') {
      setSingle(props.value);
      setCursor(new Date((props.value ?? new Date()).getFullYear(), (props.value ?? new Date()).getMonth(), 1));
    } else {
      setRangeStart(props.value.start);
      setRangeEnd(props.value.end);
      const base = props.value.start ?? new Date();
      setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const subtitle =
    mode === 'single'
      ? single
        ? fmt(single)
        : '—'
      : rangeStart && rangeEnd
        ? `${fmt(rangeStart)} → ${fmt(rangeEnd)}`
        : rangeStart
          ? fmt(rangeStart)
          : '—';

  const handleDayPress = (d: Date) => {
    if (mode === 'single') {
      setSingle(d);
      return;
    }
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(startOfDay(d));
      setRangeEnd(null);
    } else if (d < rangeStart) {
      setRangeEnd(rangeStart);
      setRangeStart(startOfDay(d));
    } else {
      setRangeEnd(startOfDay(d));
    }
  };

  const isInRange = (d: Date) =>
    mode === 'range' && !!rangeStart && !!rangeEnd && d >= rangeStart && d <= rangeEnd;
  const isRangeEndpoint = (d: Date) =>
    mode === 'range' && ((!!rangeStart && sameDay(d, rangeStart)) || (!!rangeEnd && sameDay(d, rangeEnd)));

  const handleClear = () => {
    setSingle(null);
    setRangeStart(null);
    setRangeEnd(null);
  };

  const handleApply = () => {
    if (mode === 'single' && single) {
      props.onApply(single);
      onDismiss();
    } else if (mode === 'range' && rangeStart && rangeEnd) {
      props.onApply({ start: rangeStart, end: rangeEnd });
      onDismiss();
    }
  };

  const canApply = mode === 'single' ? !!single : !!(rangeStart && rangeEnd);
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            >
              <Ionicons name="chevron-back" size={18} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekLabel}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((d) => {
              const outOfMonth = d.getMonth() !== cursor.getMonth();
              const selected =
                mode === 'single' ? !!single && sameDay(d, single) : isRangeEndpoint(d);
              const inRange = isInRange(d) && !selected;
              return (
                <TouchableOpacity
                  key={d.toISOString()}
                  style={[
                    styles.dayCell,
                    inRange && styles.dayCellInRange,
                    selected && styles.dayCellSelected,
                  ]}
                  onPress={() => handleDayPress(d)}
                  disabled={outOfMonth}
                >
                  <Text
                    style={[
                      styles.dayText,
                      outOfMonth && styles.dayTextMuted,
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={handleClear}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, !canApply && styles.applyBtnDisabled]}
                onPress={handleApply}
                disabled={!canApply}
              >
                <Text style={styles.applyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const CELL = '14.28%';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.xl, padding: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  title: { fontSize: 17, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  closeBtn: { padding: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.sm },
  navBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: `${colors.primary}14`, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 15, fontWeight: '700', color: colors.text, minWidth: 140, textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  weekLabel: { width: CELL, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: CELL, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCellInRange: { backgroundColor: `${colors.primary}1A` },
  dayCellSelected: { backgroundColor: colors.primary, borderRadius: borderRadius.md },
  dayText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  dayTextMuted: { color: colors.textDisabled },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  clearText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  cancelText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  applyBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: borderRadius.full },
  applyBtnDisabled: { backgroundColor: colors.textDisabled },
  applyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
