import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../../theme';

interface LabelProps {
  children: string;
  required?: boolean;
}

/** "Meeting Date *" — the bold label above a field. */
export function FieldLabel({ children, required }: LabelProps) {
  return (
    <Text style={styles.label}>
      {children}
      {required ? ' *' : ''}
    </Text>
  );
}

interface Props {
  /** Leading Ionicon. Ignored when `leading` is supplied. */
  icon?: string;
  /** Custom leading element (e.g. a status colour dot) instead of an icon. */
  leading?: React.ReactNode;
  /** Chosen value; when absent `placeholder` renders in the muted style. */
  value?: string | null;
  placeholder: string;
  /** Small muted line under the value (slot summary, why a field is locked). */
  hint?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Swap the trailing chevron for something else, or hide it with `null`. */
  trailing?: React.ReactNode | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * The tappable "icon · value · chevron" row that every picker field uses
 * (lead, date, time slot, members, meeting type, status).
 *
 * This was hand-rolled in each screen with slightly different padding and
 * disabled handling; it now has one definition, so a disabled field looks the
 * same whether it's on Create Meeting or Create Task.
 */
export function FormField({
  icon,
  leading,
  value,
  placeholder,
  hint,
  onPress,
  disabled = false,
  trailing,
  style,
}: Props) {
  const tint = disabled ? colors.textDisabled : colors.primary;
  const Wrapper: any = onPress && !disabled ? TouchableOpacity : View;

  return (
    <Wrapper
      style={[styles.field, disabled && styles.fieldDisabled, style]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
    >
      {leading ?? (icon ? <Ionicons name={icon as any} size={18} color={tint} /> : null)}

      <View style={styles.textWrap}>
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>

      {trailing === null ? null : trailing ?? (
        <Ionicons name="chevron-forward" size={18} color={tint} />
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: spacing.md },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceVariant },
  textWrap: { flex: 1 },
  value: { fontSize: 15, fontWeight: '600', color: colors.text },
  placeholder: { color: colors.textDisabled, fontWeight: '500' },
  hint: { fontSize: 12, color: colors.textDisabled, marginTop: 2 },
});
