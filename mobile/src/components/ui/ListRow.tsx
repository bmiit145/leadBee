import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, shadows } from '../../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** White rounded container that groups `ListRow`s. */
export function ListCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Small uppercase heading that sits above a `ListCard`. */
export function ListSectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

interface ListRowProps {
  /** Shown in a tinted circle on the left. Typed against the glyph map, so a
   *  misspelt icon fails typecheck instead of rendering a blank square. */
  icon: IoniconName;
  /** The main line. */
  title: string;
  /** Muted line above the title — the field name on a read-only detail row. */
  overline?: string;
  /** Muted line under the title — what a navigation row leads to. */
  subtitle?: string;
  /** Makes the row tappable and adds a trailing chevron. */
  onPress?: () => void;
  /** `danger` colours the icon and title, for destructive actions like Logout. */
  tone?: 'default' | 'danger';
  /** Drops the divider under the final row of a card. */
  isLast?: boolean;
}

/**
 * One row of a settings-style list: icon · text · optional chevron.
 *
 * Covers both read-only detail rows (overline + value) and navigation rows
 * (title + subtitle + chevron), so the profile, company and settings screens
 * share one rhythm rather than three hand-tuned copies.
 */
export function ListRow({
  icon,
  title,
  overline,
  subtitle,
  onPress,
  tone = 'default',
  isLast = false,
}: ListRowProps) {
  const tint = tone === 'danger' ? colors.error : colors.primary;

  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: `${tint}0F` }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={styles.textWrap}>
        {overline ? <Text style={styles.overline}>{overline}</Text> : null}
        <Text
          style={[styles.title, overline ? styles.value : null, tone === 'danger' && styles.danger]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </>
  );

  const rowStyle = [styles.row, !isLast && styles.divider];

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <TouchableOpacity
      style={rowStyle}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xxl,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  overline: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  title: { fontSize: 16, fontWeight: '500', color: colors.text },
  value: { fontWeight: '600' },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  danger: { color: colors.error },
});
