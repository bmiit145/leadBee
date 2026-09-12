import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/stores/auth.store';
import { authService } from '../../src/services/auth.service';
import { apiErrorMessage } from '../../src/services/api';
import {
  Avatar,
  FieldLabel,
  PrimaryButton,
  ScreenHeader,
  StickyFooter,
  STICKY_FOOTER_SPACE,
} from '../../src/components/ui';
import { colors, spacing, borderRadius } from '../../src/theme';

/** Loose on purpose: the API owns the real rule; this only catches typos early. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * Edit the fields a user may change about themselves — name, email and
 * designation, the same whitelist `PUT /auth/me` accepts.
 *
 * Phone is shown but locked: it is the sign-in identifier, and letting a user
 * change it here would be a quiet way to lose access to the account.
 */
export default function EditProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, reloadSession } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [designation, setDesignation] = useState(user?.designation ?? '');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const changes = { name: name.trim(), email: email.trim(), designation: designation.trim() };
  const isDirty =
    changes.name !== user.name ||
    changes.email !== (user.email ?? '') ||
    changes.designation !== (user.designation ?? '');

  const handleSave = async () => {
    // Nothing to send — leave rather than showing a button that does nothing.
    if (!isDirty) {
      router.back();
      return;
    }
    if (!changes.name) {
      Alert.alert(t('common.error'), t('editProfile.nameRequired'));
      return;
    }
    if (changes.email && !EMAIL_PATTERN.test(changes.email)) {
      Alert.alert(t('common.error'), t('editProfile.invalidEmail'));
      return;
    }

    setSaving(true);
    try {
      await authService.updateProfile(changes);
    } catch (error) {
      setSaving(false);
      Alert.alert(t('common.error'), apiErrorMessage(error, t('editProfile.saveFailed')));
      return;
    }

    // The edit is saved at this point. If re-reading the session fails on a
    // bad network, success is still correct; Profile's pull-to-refresh or the
    // next app start picks up the new values.
    await reloadSession().catch(() => undefined);
    setSaving(false);
    Alert.alert(t('common.success'), t('editProfile.saved'), [
      { text: t('common.ok'), onPress: () => router.back() },
    ]);
  };

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
      <ScreenHeader title={t('editProfile.title')} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: STICKY_FOOTER_SPACE + spacing.md }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarWrap}>
            <Avatar name={changes.name || user.name} size={112} variant="solid" />
          </View>

          <FieldLabel required>{t('editProfile.fullName')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            left={<TextInput.Icon icon="account-outline" color={colors.textSecondary} />}
          />

          <FieldLabel>{t('editProfile.email')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            left={<TextInput.Icon icon="email-outline" color={colors.textSecondary} />}
          />

          <FieldLabel>{t('editProfile.designation')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={designation}
            onChangeText={setDesignation}
            autoCapitalize="words"
            left={<TextInput.Icon icon="briefcase-outline" color={colors.textSecondary} />}
          />

          <FieldLabel>{t('editProfile.mobileNumber')}</FieldLabel>
          <TextInput
            {...inputProps}
            value={user.phone}
            disabled
            left={<TextInput.Icon icon="phone-outline" color={colors.textTertiary} />}
          />
          <Text style={styles.hint}>{t('editProfile.phoneLocked')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter>
        <PrimaryButton label={t('editProfile.save')} onPress={handleSave} loading={saving} />
      </StickyFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  avatarWrap: { alignItems: 'center', marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface },
  outline: { borderRadius: borderRadius.lg },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
});
