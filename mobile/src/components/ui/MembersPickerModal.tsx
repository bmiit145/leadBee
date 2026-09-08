import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, borderRadius } from '../../theme';
import { userService, TeamMember } from '../../services/user.service';
import { useAuth } from '../../stores/auth.store';
import { CenterDialog } from './CenterDialog';
import { Avatar } from './Avatar';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** "Select Members" — multi-select list of team members, used by both Create
 *  Meeting's "Meeting Assign" and Create Task's "Select Members" sections. */
export function MembersPickerModal({ visible, onDismiss, selected, onChange }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => userService.list(),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <CenterDialog visible={visible} onDismiss={onDismiss} title="Select Members">
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.lg }} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: TeamMember) => item._id}
          style={{ maxHeight: 380 }}
          renderItem={({ item }) => {
            const checked = selected.includes(item._id);
            const isSelf = item._id === user?._id;
            return (
              <TouchableOpacity
                style={[styles.row, checked && styles.rowSelected]}
                onPress={() => toggle(item._id)}
                activeOpacity={0.75}
              >
                <Avatar icon="person" size={38} variant="solid" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{isSelf ? `Self (${item.name})` : item.name}</Text>
                  <Text style={styles.phone}>{item.phone}</Text>
                </View>
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.primary : colors.border}
                />
              </TouchableOpacity>
            );
          }}
        />
      )}
      <TouchableOpacity style={styles.doneBtn} onPress={onDismiss}>
        <Text style={styles.doneText}>Done{selected.length > 0 ? ` (${selected.length})` : ''}</Text>
      </TouchableOpacity>
    </CenterDialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderRadius: borderRadius.lg, paddingHorizontal: spacing.sm },
  rowSelected: { backgroundColor: `${colors.primary}0F` },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  phone: { fontSize: 12, color: colors.textSecondary },
  doneBtn: { backgroundColor: colors.primary, borderRadius: borderRadius.full, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  doneText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
