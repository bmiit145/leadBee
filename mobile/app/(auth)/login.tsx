import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Modal,
  TouchableOpacity,
  StatusBar,
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
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

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
      setLoginError(null);
      await login(data.phone, data.password, organizationId);
      router.replace('/(leads)');
    } catch (error: any) {
      if (error instanceof OrganizationSelectionRequired) {
        setPendingCredentials(data);
        setOrgChoices(error.organizations);
        return;
      }
      setLoginError(apiErrorMessage(error, t('login.loginFailedMessage')));
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
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Image
            source={require('../../assets/leadbee-icon.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="LeadBee logo"
          />
          <Text style={styles.brandName}>LeadBee</Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>{t('login.welcomeBack')}</Text>
          <Text style={styles.description}>{t('login.subtitle')}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formLabel}>SIGN IN TO CONTINUE</Text>
          {loginError ? (
            <InlineFeedback
              tone="error"
              title={t('login.loginFailed')}
              message={loginError}
              onDismiss={() => setLoginError(null)}
            />
          ) : null}

          <Controller
            control={control}
            name="phone"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label={t('login.phoneNumber')}
                mode="outlined"
                value={value}
                onChangeText={(text) => {
                  setLoginError(null);
                  onChange(text);
                }}
                onBlur={onBlur}
                keyboardType="phone-pad"
                maxLength={15}
                error={!!errors.phone}
                style={styles.input}
                contentStyle={styles.inputContent}
                textColor={colors.inputText}
                outlineColor={colors.inputBorder}
                activeOutlineColor={colors.inputBorderFocused}
                left={<TextInput.Icon icon="phone-outline" color={colors.textSecondary} />}
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
                onChangeText={(text) => {
                  setLoginError(null);
                  onChange(text);
                }}
                onBlur={onBlur}
                secureTextEntry={!showPassword}
                error={!!errors.password}
                style={styles.input}
                contentStyle={styles.inputContent}
                textColor={colors.inputText}
                outlineColor={colors.inputBorder}
                activeOutlineColor={colors.inputBorderFocused}
                left={<TextInput.Icon icon="lock-outline" color={colors.textSecondary} />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? 'eye-off' : 'eye'}
                    onPress={() => setShowPassword(!showPassword)}
                    color={colors.textSecondary}
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

          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.securityText}>Your workspace data is protected.</Text>
          </View>
        </View>

        <Text style={styles.footer}>Lead management, without the noise.</Text>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoImage: {
    width: 88,
    height: 88,
    borderRadius: borderRadius.xl,
  },
  brandName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: spacing.sm,
  },
  intro: {
    marginBottom: spacing.xl,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  input: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  inputContent: { height: 54 },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  button: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
  buttonContent: {
    height: 54,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  securityNote: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  securityText: {
    marginLeft: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  footer: {
    color: colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
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
