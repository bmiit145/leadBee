import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../theme';
import { BottomSheet } from './ui';
import { DateRangeField } from './fields';

export interface DateRangeValue {
  start: Date | null;
  end: Date | null;
}

export const EMPTY_RANGE: DateRangeValue = { start: null, end: null };

/** `YYYY-MM-DD` of the day as the user sees it — the API reads it in their time zone. */
export function toDayParam(date: Date | null): string | undefined {
  if (!date) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const rangeLabel = (range: DateRangeValue) =>
  range.start && range.end
    ? `${range.start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${range.end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
    : null;

export interface ChoiceOption {
  value: string;
  label: string;
  color?: string;
  count?: number;
}

export interface ChoiceSection {
  key: string;
  title: string;
  options: ChoiceOption[];
  /** Shown when there is nothing to choose from. */
  emptyText?: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  range: DateRangeValue;
  /** Selected value per section key; absent means "any". */
  choices: Record<string, string | undefined>;
  sections: ChoiceSection[];
  onApply: (next: { range: DateRangeValue; choices: Record<string, string | undefined> }) => void;
}

/**
 * The filter sheet behind the list's filter button: a date range plus any
 * number of single-choice sections (meeting type, purpose, label). Edits are a
 * draft until Apply, so closing the sheet changes nothing.
 */
export function WorkFilterSheet({ visible, onDismiss, range, choices, sections, onApply }: Props) {
  const { t } = useTranslation();
  const [draftRange, setDraftRange] = useState<DateRangeValue>(range);
  const [draftChoices, setDraftChoices] = useState(choices);

  useEffect(() => {
    if (visible) {
      setDraftRange(range);
      setDraftChoices(choices);
    }
    // Reset the draft each time the sheet opens, from what is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (sectionKey: string, value: string) =>
    setDraftChoices((prev) => ({ ...prev, [sectionKey]: prev[sectionKey] === value ? undefined : value }));

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} maxHeightRatio={0.9}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('work.filter.title')}</Text>
        <TouchableOpacity
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('work.filter.close')}
          hitSlop={10}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ gap: spacing.md }}>
        <View>
          <DateRangeField
            label={t('work.filter.dateRange')}
            value={draftRange}
            onChange={(v) => setDraftRange(v)}
            placeholder={t('work.filter.selectDates')}
            dialogTitle={t('work.filter.dateRange')}
          />
          {draftRange.start ? (
            <TouchableOpacity onPress={() => setDraftRange(EMPTY_RANGE)} style={styles.clearRange}>
              <Text style={styles.clearRangeText}>{t('work.filter.clearDates')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {sections.map((section) => (
          <View key={section.key}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.options.length === 0 ? (
              <Text style={styles.empty}>{section.emptyText}</Text>
            ) : (
              <View style={styles.chips}>
                {section.options.map((option) => {
                  const active = draftChoices[section.key] === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => toggle(section.key, option.value)}
                      style={[styles.chip, active && styles.chipActive]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                    >
                      {option.color ? <View style={[styles.dot, { backgroundColor: option.color }]} /> : null}
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {option.label}
                        {option.count !== undefined ? ` (${option.count})` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, styles.secondary]}
          onPress={() => {
            setDraftRange(EMPTY_RANGE);
            setDraftChoices({});
          }}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{t('work.filter.reset')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.primary]}
          onPress={() => {
            onApply({ range: draftRange, choices: draftChoices });
            onDismiss();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{t('work.filter.apply')}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

/** What is filtered right now, each removable on its own — shown under the search bar. */
export function ActiveFilterChips({ filters, onClearAll }: { filters: ActiveFilter[]; onClearAll: () => void }) {
  const { t } = useTranslation();
  if (filters.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeRow}>
      {filters.map((filter) => (
        <TouchableOpacity
          key={filter.key}
          style={styles.activeChip}
          onPress={filter.onRemove}
          accessibilityRole="button"
          accessibilityLabel={t('work.filter.remove', { label: filter.label })}
        >
          <Text style={styles.activeChipText}>{filter.label}</Text>
          <Ionicons name="close" size={14} color="#FFFFFF" />
        </TouchableOpacity>
      ))}
      {filters.length > 1 ? (
        <TouchableOpacity onPress={onClearAll} style={styles.clearAll} accessibilityRole="button">
          <Text style={styles.clearAllText}>{t('work.filter.clearAll')}</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  body: { flexGrow: 0 },
  clearRange: { alignSelf: 'flex-end', paddingVertical: 4 },
  clearRangeText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
  sectionTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text, marginBottom: 8 },
  empty: { fontSize: 13, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#FFFFFF' },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  button: { flex: 1, borderRadius: borderRadius.full, paddingVertical: 13, alignItems: 'center' },
  secondary: { borderWidth: 1.5, borderColor: colors.primary },
  secondaryText: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
  activeRow: { gap: 8, alignItems: 'center' },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 5,
  },
  activeChipText: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
  clearAll: { paddingHorizontal: 6, paddingVertical: 5 },
  clearAllText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
});
