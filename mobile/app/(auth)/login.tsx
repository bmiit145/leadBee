import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { TextInput, Button } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/stores/auth.store';
import {
  OrganizationSelectionRequired,
  type OrgChoice,
} from '../../src/services/auth.service';
import { apiErrorMessage } from '../../src/services/api';
import { loginSchema, LoginFormData } from '../../src/utils/validators';
import { colors, spacing, borderRadius } from '../../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  /**
   * Only populated when the API reports this phone belongs to several tenants.
   * The form never asks for an organization up front — for almost everyone
   * there is exactly one, and a field they always leave alone is a field that
   * should not exist.
   */
  const [orgChoices, setOrgChoices] = useState<OrgChoice[]>([]);
  const [pendingCredentials, setPendingCredentials] = useState<LoginFormData | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', password: '' },
  });

  const attemptLogin = async (data: LoginFormData, organizationId?: string) => {
    try {
      setLoading(true);
      await login(data.phone, data.password, organizationId);
      router.replace('/(leads)');
    } catch (error: any) {
      if (error instanceof OrganizationSelectionRequired) {
        setPendingCredentials(data);
        setOrgChoices(error.organizations);
        return;
      }
      Alert.alert(
        t('login.loginFailed'),
        apiErrorMessage(error, t('login.loginFailedMessage'))
      );
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (data: LoginFormData) => attemptLogin(data);

  const onPickOrganization = (organizationId: string) => {
    const credentials = pendingCredentials;
    setOrgChoices([]);
    setPendingCredentials(null);
    if (credentials) void attemptLogin(credentials, organizationId);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Image 
            source={require('../../assets/logo.png')} 
            style={styles.logoImage} 
            resizeMode="contain" 
          />
          <Text style={styles.subtitle}>{t('common.appName')}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>{t('login.welcomeBack')}</Text>
          <Text style={styles.description}>{t('login.subtitle')}</Text>

          <Controller
            control={control}
            name="phone"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label={t('login.phoneNumber')}
                mode="outlined"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="phone-pad"
                maxLength={15}
                error={!!errors.phone}
                style={styles.input}
                textColor={colors.inputText}
                outlineColor={colors.inputBorder}
                activeOutlineColor={colors.inputBorderFocused}
                left={<TextInput.Icon icon="phone" />}
              />
            )}
          />
          {errors.phone && (
            <Text style={styles.errorText}>{errors.phone.message}</Text>
          )}

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label={t('login.password')}
                mode="outlined"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry={!showPassword}
                error={!!errors.password}
                style={styles.input}
                textColor={colors.inputText}
                outlineColor={colors.inputBorder}
                activeOutlineColor={colors.inputBorderFocused}
                left={<TextInput.Icon icon="lock" />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? 'eye-off' : 'eye'}
                    onPress={() => setShowPassword(!showPassword)}
                  />
                }
              />
            )}
          />
          {errors.password && (
            <Text style={styles.errorText}>{errors.password.message}</Text>
          )}

          <Button
            mode="contained"
            onPress={handleSubmit(onSubmit)}
            loading={loading}
            disabled={loading}
            style={styles.button}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            buttonColor={colors.primary}
          >
            {loading ? t('login.signingIn') : t('login.signIn')}
          </Button>
        </View>
      </ScrollView>

      {/* Organization picker — only reached when one phone number is registered
          against more than one tenant. */}
      <Modal
        visible={orgChoices.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setOrgChoices([]);
          setPendingCredentials(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.orgCard}>
            <Text style={styles.orgTitle}>Choose an organization</Text>
            <Text style={styles.orgSubtitle}>
              This number is registered with more than one organization.
            </Text>

            <ScrollView style={styles.orgList}>
              {orgChoices.map((org) => (
                <TouchableOpacity
                  key={org._id}
                  style={styles.orgOption}
                  onPress={() => onPickOrganization(org._id)}
                >
                  <View style={styles.orgOptionText}>
                    <Text style={styles.orgName}>{org.name}</Text>
                    <Text style={styles.orgSlug}>{org.slug}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button
              mode="text"
              onPress={() => {
                setOrgChoices([]);
                setPendingCredentials(null);
              }}
              textColor={colors.textSecondary}
            >
              {t('common.cancel')}
            </Button>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoImage: {
    width: 200,
    height: 120,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  input: {
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  button: {
    marginTop: spacing.md,
    borderRadius: 12,
  },
  buttonContent: {
    height: 52,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  orgCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    maxHeight: 420,
  },
  orgTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  orgSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  orgList: { maxHeight: 280 },
  orgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.sm,
  },
  orgOptionText: { flex: 1 },
  orgName: { fontSize: 15, fontWeight: '600', color: colors.text },
  orgSlug: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
