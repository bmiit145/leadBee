import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../theme';
import { leadService } from '../services/lead.service';
import { Lead } from '../types';
import { BottomSheet, Avatar } from './ui';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  selectedId?: string;
  onSelect: (lead: Lead) => void;
}

/** "Select Lead" — searchable lead list for booking a meeting without starting
 *  from a lead's detail screen. The currently-selected lead is dimmed, since
 *  re-picking it is a no-op. */
export function LeadPickerSheet({ visible, onDismiss, selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['lead-picker'],
    queryFn: () => leadService.getAll({ limit: 100 }),
    enabled: visible,
  });

  const leads = useMemo(() => {
    const items = data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (l) => l.contactName.toLowerCase().includes(q) || l.contactPhone.includes(q)
    );
  }, [data, search]);

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} maxHeightRatio={0.9}>
      <Text style={styles.title}>Select Lead</Text>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={17} color={colors.primary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by customer name, number"
          placeholderTextColor={colors.textDisabled}
          style={styles.searchInput}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(item: Lead) => item._id}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 420 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No leads found.</Text>}
          renderItem={({ item }) => {
            const isCurrent = item._id === selectedId;
            return (
              <TouchableOpacity
                style={[styles.row, isCurrent && styles.rowCurrent]}
                onPress={() => {
                  onSelect(item);
                  onDismiss();
                }}
                activeOpacity={0.75}
              >
                <Avatar name={item.contactName} size={46} variant="solid" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, isCurrent && styles.dimText]} numberOfLines={1}>
                    {item.contactName}
                  </Text>
                  <Text style={[styles.phone, isCurrent && styles.dimText]}>{item.contactPhone}</Text>
                </View>
                {isCurrent ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 21, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: `${colors.primary}0F`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: 10,
  },
  rowCurrent: { opacity: 0.5 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  phone: { fontSize: 14, color: colors.textSecondary, marginTop: 1 },
  dimText: { color: colors.textDisabled },
  emptyText: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.lg },
});
