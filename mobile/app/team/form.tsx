import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { TextInput } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userService, TeamMemberChanges } from '../../src/services/user.service';
import { apiErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth.store';
import { queryKeys } from '../../src/lib/queryKeys';
import { assignableRoles } from '../../src/config/roles';
import {
  EmptyState,
  FieldLabel,
  FormField,
  PrimaryButton,
  ScreenHeader,
  StickyFooter,
  STICKY_FOOTER_SPACE,
} from '../../src/components/ui';
import { SelectField } from '../../src/components/fields/SelectField';
import type { UserRole } from '../../src/types';
import { colors, spacing, borderRadius } from '../../src/theme';

const MIN_NAME = 2;

/**
 * Edit an existing team member's profile.
 *
 * This screen is reached only from the team list's "Edit" menu item, which
 * passes `?id=<userId>`. Name and designation can be changed freely; the
 * mobile number is locked (it is the member's sign-in ID); changing the role
 * is allowed only on someone else, never on yourself.
 *
 * Adding new members is handled by the Invite Members hub at
 * `/organization/invite` — there is no manual "create account" form.
 */
export default function TeamMemberFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user, reloadSession } = useAuth();

  // This screen only handles edits; if there is no id, go to the invite hub.
  useEffect(() => {
    if (!id) router.replace('/organization/invite');
  }, [id, router]);

  const isSelf = id === user?._id;

  const member = useQuery({
    queryKey: queryKeys.users.detail(id ?? ''),
    queryFn: () => userService.getById(id!),
    enabled: Boolean(id),
  });

  const [form, setForm] = useState({
    name: '',
    email: '',
    designation: '',
    role: 'user' as UserRole,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !member.data) return;
    setForm({
      name: member.data.name,
      email: member.data.email ?? '',
      designation: member.data.designation ?? '',
      role: member.data.role,
    });
    setHydrated(true);
  }, [hydrated, member.data]);

  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async (): Promise<'saved' | 'unchanged'> => {
      if (!member.data) return 'unchanged';
      const changes: TeamMemberChanges = {};
      const name = form.name.trim();
      const email = form.email.trim();
      const designation = form.designation.trim();
      if (name !== member.data.name) changes.name = name;
      if (email !== (member.data.email ?? '')) changes.email = email;
      if (designation !== (member.data.designation ?? '')) changes.designation = designation;
      if (!isSelf && form.role !== member.data.role) changes.role = form.role;
      if (Object.keys(changes).length === 0) return 'unchanged';
      await userService.update(member.data._id, changes);
      return 'saved';
    },
    onSuccess: (outcome) => {
      if (outcome === 'unchanged') {
        router.back();
        return;
      }
      void qc.invalidateQueries({ queryKey: queryKeys.users.all });
      // Seats used, and your own name when you edited yourself, live in the session.
      void reloadSession().catch(() => undefined);
      Alert.alert(t('common.success'), t('team.saved'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    },
    onError: (error) => Alert.alert(t('common.error'), apiErrorMessage(error, t('team.actionFailed'))),
  });

  const handleSave = () => {
    const problem =
      form.name.trim().length < MIN_NAME
        ? t('team.nameRequired')
        : null;
    if (problem) {
      Alert.alert(t('common.error'), problem);
      return;
    }
    save.mutate();
  };

  const title = t('team.editMember');

  if (!hydrated) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={title} />
        {member.isError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('team.loadFailed')}
            actionLabel={t('common.tryAgain')}
            onAction={() => void member.refetch()}
          />
        ) : (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        )}
      </View>
    );
  }

  const roleOptions = assignableRoles(user?.role ?? '').map((role) => ({
    value: role,
    label: t(`team.roles.${role}`),
  }));

  const inputProps = {
    mode: 'outlined' as const,
    style: styles.input,
    outlineStyle: styles.outline,
    textColor: colors.inputText,
    outlineColor: colors.inputBorder,
    activeOutlineColor: colors.inputBorderFocused,
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: STICKY_FOOTER_SPACE + spacing.md }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FieldLabel required>{t('team.fullName')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={form.name}
            onChangeText={set('name')}
            autoCapitalize="words"
            left={<TextInput.Icon icon="account-outline" color={colors.textSecondary} />}
          />

          <FieldLabel>{t('team.phone')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={member.data?.phone ?? ''}
            disabled
            left={<TextInput.Icon icon="phone-outline" color={colors.textSecondary} />}
          />
          <Text style={styles.hint}>{t('team.phoneLocked')}</Text>

          <FieldLabel>{t('team.email')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            left={<TextInput.Icon icon="email-outline" color={colors.textSecondary} />}
          />

          <FieldLabel>{t('team.designation')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={form.designation}
            onChangeText={set('designation')}
            autoCapitalize="words"
            left={<TextInput.Icon icon="briefcase-outline" color={colors.textSecondary} />}
          />

          {isSelf ? (
            <>
              <FieldLabel>{t('team.role')}</FieldLabel>
              <FormField
                icon="shield-outline"
                value={t(`team.roles.${form.role}`)}
                placeholder={t('team.role')}
                hint={t('team.selfRoleLocked')}
                disabled
                trailing={null}
              />
            </>
          ) : (
            <SelectField
              label={t('team.role')}
              required
              icon="shield-outline"
              placeholder={t('team.role')}
              options={roleOptions}
              value={form.role}
              onChange={set('role')}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <PrimaryButton
          label={t('team.save')}
          onPress={handleSave}
          loading={save.isPending}
        />
      </StickyFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  loader: { marginVertical: spacing.xl },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  input: { backgroundColor: colors.surface },
  outline: { borderRadius: borderRadius.lg },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
});
