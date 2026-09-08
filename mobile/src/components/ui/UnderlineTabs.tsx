import React, { useEffect, useRef } from 'react';
import { ScrollView, TouchableOpacity, Text, View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, spacing } from '../../theme';

export interface UnderlineTab {
  key: string;
  label: string;
}

interface Props {
  tabs: UnderlineTab[];
  active: string;
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Horizontally-scrolling text tabs with an underline on the active one.
 *
 * This is the fourth tab shape in the app and is deliberately its own control
 * (see the note in the madhavmms-ui skill): `FilterTabs` = separate bordered
 * chips, `SegmentedTabs` = one shared track, `SegmentedToggle` = two-option
 * slider, `FolderTabs` = in-header notebook tabs. Lead Details and Property
 * Details both need a scrollable underlined strip that sits above a panel.
 */
export function UnderlineTabs({ tabs, active, onChange, style }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef<Record<string, { x: number; width: number }>>({});

  useEffect(() => {
    const l = layouts.current[active];
    if (l && scrollRef.current) {
      scrollRef.current.scrollTo({ x: Math.max(0, l.x - 48), animated: true });
    }
  }, [active]);

  return (
    <View style={[styles.wrap, style]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onChange(tab.key)}
              onLayout={(e) => {
                layouts.current[tab.key] = {
                  x: e.nativeEvent.layout.x,
                  width: e.nativeEvent.layout.width,
                };
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
                {tab.label}
              </Text>
              <View style={[styles.underline, isActive && styles.underlineActive]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: spacing.md, gap: spacing.lg, paddingTop: 3 },
  tab: { minHeight: 52, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
  labelActive: { color: colors.primary, fontWeight: '700' },
  underline: {
    height: 2,
    alignSelf: 'stretch',
    marginTop: 8,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineActive: { backgroundColor: colors.primary },
});
