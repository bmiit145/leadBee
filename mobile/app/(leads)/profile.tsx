import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/stores/auth.store';
import { authService } from '../../src/services/auth.service';
import { colors, spacing, borderRadius } from '../../src/theme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const {
    user,
    organization,
    logout,
    refreshAuth,
    projects,
    defaultProject,
    isProjectsLoading,
    refreshProjects,
    isOrganizer,
    viewMode,
    switchViewMode,
  } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedDefaultProject, setSelectedDefaultProject] = useState<string>('');
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);

  const selectedProjectName = useMemo(() => {
    if (!selectedDefaultProject) return '';
    return projects.find((project) => project._id === selectedDefaultProject)?.name || '';
  }, [projects, selectedDefaultProject]);

  useEffect(() => {
    const userDefaultId =
      typeof user?.defaultProject === 'object' && user.defaultProject !== null
        ? user.defaultProject._id
        : typeof user?.defaultProject === 'string'
        ? user.defaultProject
        : '';

    setSelectedDefaultProject(userDefaultId || defaultProject?._id || '');
  }, [defaultProject?._id, user?.defaultProject]);

  const handleLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleSaveDefaultProject = async () => {
    try {
      setProjectSaving(true);
      await authService.updateDefaultProject(selectedDefaultProject || null);
      await refreshAuth();
      await refreshProjects({ force: true });
      Alert.alert(t('common.success'), 'Default project updated successfully.');
    } catch (error: any) {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        'Failed to update default project.';
      Alert.alert(t('common.error'), message);
    } finally {
      setProjectSaving(false);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Validation', 'All password fields are required.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Validation', 'New password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Validation', 'New password and confirm password must match.');
      return;
    }

    if (currentPassword === newPassword) {
      Alert.alert('Validation', 'New password must be different from current password.');
      return;
    }

    try {
      setSubmitting(true);
      await authService.changePassword(currentPassword, newPassword);
      closePasswordModal();
      // Changing the password revokes every session server-side, so staying on
      // this screen would leave the user holding tokens that no longer work.
      Alert.alert(t('common.success'), 'Password changed. Please sign in again.', [
        {
          text: 'OK',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]);
    } catch (error: any) {
      const message = error?.response?.data?.error?.message || 'Failed to change password.';
      Alert.alert(t('common.error'), message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  // Organizer/Agent badge — reflects actual capability, not raw role string.
  const profileBadge = isOrganizer
    ? { label: 'Organizer', color: colors.primary }
    : { label: 'Agent', color: colors.info };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={48} color={colors.primary} />
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <View style={[styles.roleBadge, { backgroundColor: profileBadge.color + '20' }]}>
            <Text style={[styles.roleText, { color: profileBadge.color }]}>
              {profileBadge.label.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Which tenant this account belongs to. On a multi-tenant product the
            same person may hold accounts in more than one organization, so the
            profile has to say which one is on screen. */}
        {organization && (
          <View style={styles.orgCard}>
            <Ionicons name="business-outline" size={20} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Organization</Text>
              <Text style={styles.infoValue}>{organization.name}</Text>
            </View>
            {organization.plan ? (
              <View style={styles.planBadge}>
                <Text style={styles.planText}>{organization.plan.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={20} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>{t('profile.phone')}</Text>
              <Text style={styles.infoValue}>{user.phone}</Text>
            </View>
          </View>

          {user.email && (
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>{t('profile.email')}</Text>
                <Text style={styles.infoValue}>{user.email}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.sectionTitle}>{t('profile.defaultProject')}</Text>
          <TouchableOpacity
            style={styles.projectSelector}
            onPress={() => setProjectModalOpen(true)}
            disabled={isProjectsLoading || projects.length === 0}
          >
            <Text style={selectedProjectName ? styles.projectValue : styles.projectPlaceholder}>
              {isProjectsLoading
                ? t('profile.loadingProjects')
                : selectedProjectName || t('profile.noDefaultProject')}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {projects.length === 0 && !isProjectsLoading ? (
            <Text style={styles.projectHint}>{t('profile.noProjectsAssigned')}</Text>
          ) : (
            <Text style={styles.projectHint}>{t('profile.defaultProjectHint')}</Text>
          )}
          <Button
            mode="contained"
            onPress={handleSaveDefaultProject}
            loading={projectSaving}
            disabled={projectSaving || isProjectsLoading || projects.length === 0}
            style={styles.saveProjectButton}
            buttonColor={colors.primary}
          >
            {t('profile.saveDefaultProject')}
          </Button>
        </View>

        {isOrganizer && (
          <Button
            mode="outlined"
            onPress={switchViewMode}
            icon={viewMode === 'admin' ? 'account-arrow-right' : 'shield-account'}
            style={styles.switchProfileButton}
            textColor={colors.primary}
          >
            {viewMode === 'admin' ? 'Switch to Agent View' : 'Switch to Admin View'}
          </Button>
        )}

        <Button
          mode="contained"
          onPress={() => setShowPasswordModal(true)}
          icon="lock-reset"
          style={styles.changePasswordButton}
          buttonColor={colors.primary}
        >
          {t('profile.changePassword')}
        </Button>

        <Button
          mode="outlined"
          onPress={handleLogout}
          icon="logout"
          style={styles.logoutButton}
          textColor={colors.error}
        >
          {t('common.logout')}
        </Button>

        <View style={styles.footer}>
          <Text style={styles.footerText}>LeadBee</Text>
          <Text style={styles.footerCopyright}>Lead management, done properly.</Text>
        </View>
      </ScrollView>

      <Modal visible={showPasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) },
            ]}
          >
            <Text style={styles.modalTitle}>{t('profile.changePassword')}</Text>

            <TextInput
              label={t('profile.currentPassword')}
              mode="outlined"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              style={styles.modalInput}
              textColor={colors.inputText}
              outlineColor={colors.inputBorder}
              activeOutlineColor={colors.inputBorderFocused}
            />

            <TextInput
              label={t('profile.newPassword')}
              mode="outlined"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              style={styles.modalInput}
              textColor={colors.inputText}
              outlineColor={colors.inputBorder}
              activeOutlineColor={colors.inputBorderFocused}
            />

            <TextInput
              label={t('profile.confirmNewPassword')}
              mode="outlined"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              style={styles.modalInput}
              textColor={colors.inputText}
              outlineColor={colors.inputBorder}
              activeOutlineColor={colors.inputBorderFocused}
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

      <Modal
        visible={projectModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setProjectModalOpen(false)}
        >
          <View style={styles.projectModalCard}>
            <Text style={styles.modalTitle}>{t('profile.selectDefaultProject')}</Text>
            <ScrollView style={styles.projectModalList}>
              <TouchableOpacity
                style={[
                  styles.projectOption,
                  !selectedDefaultProject && styles.projectOptionSelected,
                ]}
                onPress={() => {
                  setSelectedDefaultProject('');
                  setProjectModalOpen(false);
                }}
              >
                <Text style={styles.projectOptionText}>
                  {t('profile.noDefaultProjectOption')}
                </Text>
                {!selectedDefaultProject ? (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                ) : null}
              </TouchableOpacity>

              {projects.map((project) => {
                const isSelected = selectedDefaultProject === project._id;
                return (
                  <TouchableOpacity
                    key={project._id}
                    style={[styles.projectOption, isSelected && styles.projectOptionSelected]}
                    onPress={() => {
                      setSelectedDefaultProject(project._id);
                      setProjectModalOpen(false);
                    }}
                  >
                    <Text style={styles.projectOptionText}>{project.name}</Text>
                    {isSelected ? (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.md },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  name: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  roleBadge: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: borderRadius.full },
  roleText: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  orgCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '15',
  },
  planText: { fontSize: 10, fontWeight: '700', color: colors.primary, letterSpacing: 0.8 },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  projectSelector: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectValue: { color: colors.text, fontSize: 15, fontWeight: '500' },
  projectPlaceholder: { color: colors.textSecondary, fontSize: 15 },
  projectHint: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  saveProjectButton: { marginTop: spacing.md, borderRadius: borderRadius.lg },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 12, color: colors.textSecondary },
  infoValue: { fontSize: 16, fontWeight: '500', color: colors.text },
  logoutButton: {
    marginTop: spacing.sm,
    borderColor: colors.error,
    borderRadius: borderRadius.lg,
  },
  switchProfileButton: {
    marginBottom: spacing.sm,
    borderColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  changePasswordButton: { borderRadius: borderRadius.lg },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  projectModalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    maxHeight: 360,
  },
  projectModalList: { maxHeight: 260 },
  projectOption: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectOptionSelected: { backgroundColor: colors.primary + '15' },
  projectOptionText: { fontSize: 15, color: colors.text },
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
  footer: { marginTop: 'auto', alignItems: 'center', paddingVertical: spacing.xl },
  footerText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  footerCopyright: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    opacity: 0.7,
  },
});
