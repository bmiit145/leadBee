import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Modal } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuth } from '../../src/stores/auth.store';
import { authService } from '../../src/services/auth.service';
import { apiErrorMessage } from '../../src/services/api';
import { ScreenHeader, ListCard, ListRow, ListSectionTitle } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';

/** Mirrors `changePasswordBody` on the API. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Account settings — only what LeadBee actually supports.
 *
 * The layout this is modelled on also offers push-notification toggles,
 * biometric sign-in, a language picker and cache controls. LeadBee has no
 * support for notification preferences, biometrics or a user-facing cache, and
 * the language switch was removed on purpose (d8777cd), so none of them appear
 * as controls that do nothing.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const appVersion = Constants.expoConfig?.version;

  const closePasswordModal = () => {
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = async () => {
    const invalid = (message: string) => Alert.alert(t('settings.validationTitle'), message);

    if (!currentPassword || !newPassword || !confirmPassword) {
      invalid(t('settings.passwordFieldsRequired'));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      invalid(t('settings.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      invalid(t('settings.passwordMismatch'));
      return;
    }
    if (currentPassword === newPassword) {
      invalid(t('settings.passwordSameAsCurrent'));
      return;
    }

    try {
      setSubmitting(true);
      await authService.changePassword(currentPassword, newPassword);
      closePasswordModal();
      // Changing the password revokes every session server-side, so staying
      // signed in would leave the user holding tokens that no longer work.
      Alert.alert(t('common.success'), t('settings.passwordChanged'), [
        {
          text: t('common.ok'),
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]);
    } catch (error) {
      Alert.alert(t('common.error'), apiErrorMessage(error, t('settings.passwordChangeFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  const passwordInputProps = {
    mode: 'outlined' as const,
    secureTextEntry: true,
    style: styles.modalInput,
    textColor: colors.inputText,
    outlineColor: colors.inputBorder,
    activeOutlineColor: colors.inputBorderFocused,
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('settings.title')} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <ListSectionTitle>{t('settings.security')}</ListSectionTitle>
        <ListCard>
          <ListRow
            icon="lock-closed-outline"
            title={t('profile.changePassword')}
            subtitle={t('settings.changePasswordHint')}
            onPress={() => setPasswordOpen(true)}
            isLast
          />
        </ListCard>

        <ListSectionTitle>{t('settings.about')}</ListSectionTitle>
        <ListCard>
          <ListRow
            icon="information-circle-outline"
            overline={t('settings.appVersion')}
            title={appVersion ?? '–'}
            isLast
          />
        </ListCard>
      </ScrollView>

      <Modal visible={passwordOpen} transparent animationType="slide" onRequestClose={closePasswordModal}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) },
            ]}
          >
            <Text style={styles.modalTitle}>{t('profile.changePassword')}</Text>

            <TextInput
              {...passwordInputProps}
              label={t('profile.currentPassword')}
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              {...passwordInputProps}
              label={t('profile.newPassword')}
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              {...passwordInputProps}
              label={t('profile.confirmNewPassword')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <View style={styles.modalActions}>
              <Button mode="outlined" onPress={closePasswordModal}>
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleChangePassword}
                loading={submitting}
                disabled={submitting}
                buttonColor={colors.primary}
              >
                {t('common.update')}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  modalInput: { backgroundColor: colors.surface, marginBottom: spacing.sm },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
