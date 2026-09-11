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
import { isValidMobilePhone, normalizePhone } from '../../src/utils/validators';
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

/** Loose on purpose: the API owns the real rule; this only catches typos early. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 6;
const MIN_NAME = 2;

interface FormState {
  name: string;
  phone: string;
  email: string;
  designation: string;
  role: UserRole;
  password: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  designation: '',
  role: 'user',
  password: '',
};

/**
 * Add a team member, or edit one.
 *
 * The mobile number is set once: it is the member's sign-in ID, and changing it
 * under them is a quiet way to lock them out. Roles offered stop at the caller's
 * own. On your own account the role is shown but locked — the API will not let
 * anyone change their own access, and offering it would only earn a 403.
 */
export default function TeamMemberFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user, reloadSession } = useAuth();

  const isEdit = Boolean(id);
  const isSelf = isEdit && id === user?._id;

  const member = useQuery({
    queryKey: queryKeys.users.detail(id ?? ''),
    queryFn: () => userService.getById(id!),
    enabled: isEdit,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(!isEdit);

  useEffect(() => {
    if (hydrated || !member.data) return;
    setForm({
      name: member.data.name,
      phone: member.data.phone,
      email: member.data.email ?? '',
      designation: member.data.designation ?? '',
      role: member.data.role,
      password: '',
    });
    setHydrated(true);
  }, [hydrated, member.data]);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async (): Promise<'created' | 'saved' | 'unchanged'> => {
      const name = form.name.trim();
      const email = form.email.trim();
      const designation = form.designation.trim();

      if (isEdit && member.data) {
        const changes: TeamMemberChanges = {};
        if (name !== member.data.name) changes.name = name;
        if (email !== (member.data.email ?? '')) changes.email = email;
        if (designation !== (member.data.designation ?? '')) changes.designation = designation;
        if (!isSelf && form.role !== member.data.role) changes.role = form.role;
        if (Object.keys(changes).length === 0) return 'unchanged';
        await userService.update(member.data._id, changes);
        return 'saved';
      }

      await userService.create({
        name,
        phone: normalizePhone(form.phone),
        email: email || undefined,
        password: form.password,
        role: form.role,
        designation: designation || undefined,
      });
      return 'created';
    },
    onSuccess: (outcome) => {
      if (outcome === 'unchanged') {
        router.back();
        return;
      }
      void qc.invalidateQueries({ queryKey: queryKeys.users.all });
      // Seats used, and your own name when you edited yourself, live in the session.
      void reloadSession().catch(() => undefined);
      Alert.alert(t('common.success'), outcome === 'created' ? t('team.created') : t('team.saved'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    },
    onError: (error) => Alert.alert(t('common.error'), apiErrorMessage(error, t('team.actionFailed'))),
  });

  const handleSave = () => {
    const email = form.email.trim();
    const problem =
      form.name.trim().length < MIN_NAME
        ? t('team.nameRequired')
        : !isEdit && !isValidMobilePhone(form.phone)
          ? t('team.phoneInvalid')
          : email && !EMAIL_PATTERN.test(email)
            ? t('team.emailInvalid')
            : !isEdit && form.password.length < MIN_PASSWORD
              ? t('team.passwordTooShort')
              : null;
    if (problem) {
      Alert.alert(t('common.error'), problem);
      return;
    }
    save.mutate();
  };

  const title = isEdit ? t('team.editMember') : t('team.addMember');

  if (isEdit && !hydrated) {
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

          <FieldLabel required>{t('team.phone')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={form.phone}
            onChangeText={set('phone')}
            keyboardType="phone-pad"
            disabled={isEdit}
            left={<TextInput.Icon icon="phone-outline" color={colors.textSecondary} />}
          />
          {isEdit ? <Text style={styles.hint}>{t('team.phoneLocked')}</Text> : null}

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

          {!isEdit ? (
            <>
              <FieldLabel required>{t('team.password')}</FieldLabel>
              <TextInput
                {...inputProps}
                value={form.password}
                onChangeText={set('password')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                left={<TextInput.Icon icon="lock-outline" color={colors.textSecondary} />}
              />
              <Text style={styles.hint}>{t('team.passwordHint')}</Text>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <PrimaryButton
          label={isEdit ? t('team.save') : t('team.addMember')}
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
