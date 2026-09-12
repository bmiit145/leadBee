import React, { useState } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../stores/auth.store';
import { userService } from '../services/user.service';
import { queryKeys } from '../lib/queryKeys';
import { FormField, SelectListDialog } from './ui';
import type { SelectOption } from './ui';
import { colors } from '../theme';

interface Props {
  /** A member's id, or `null` for everyone. */
  value: string | null;
  onChange: (memberId: string | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * "All team members ▾" — the organizer's per-member view on Leads, Tasks and
 * Meetings.
 *
 * Renders nothing for anyone else, including an organizer previewing the agent
 * view: an agent's lists are already their own book, and the API ignores the
 * filter for them anyway.
 */
export function MemberFilter({ value, onChange, style }: Props) {
  const { t } = useTranslation();
  const { user, isOrganizer, viewMode } = useAuth();
  const [open, setOpen] = useState(false);
  const isVisible = isOrganizer && viewMode === 'admin';

  const members = useQuery({
    queryKey: queryKeys.users.members,
    queryFn: () => userService.list(),
    enabled: isVisible,
    staleTime: 5 * 60_000,
  });

  if (!isVisible) return null;

  const options: SelectOption<string | null>[] = [
    { value: null, label: t('memberFilter.all'), icon: 'people-outline' },
    ...(members.data ?? []).map((member) => ({
      value: member._id,
      label: member._id === user?._id ? t('memberFilter.self', { name: member.name }) : member.name,
      icon: 'person-outline',
    })),
  ];
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <View style={style}>
      <FormField
        icon={value ? 'person-outline' : 'people-outline'}
        value={selectedLabel ?? t('memberFilter.all')}
        placeholder={t('memberFilter.all')}
        onPress={() => setOpen(true)}
        trailing={<Ionicons name="chevron-down" size={18} color={colors.primary} />}
      />
      <SelectListDialog
        visible={open}
        onDismiss={() => setOpen(false)}
        title={t('memberFilter.title')}
        options={options}
        value={value}
        onSelect={onChange}
      />
    </View>
  );
}
