import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { TextInput, Button, Checkbox } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  registrationService,
  RegistrationError,
} from '../../src/services/registration.service';
import { registerSchema, RegisterFormData } from '../../src/utils/validators';
import { colors, spacing, borderRadius } from '../../src/theme';
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';

/**
 * Create an account — a person, not a company.
 *
 * There is no Company Name field on purpose. The reference app puts one here
 * and provisions an organization the moment you submit, which forces everyone
 * to be a founder: an employee joining an existing team has to invent a
 * company, or wait for an invite. Here the account comes first and the
 * organization question is asked once, afterwards, where it can be answered
 * either way.
 */
export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      acceptedTerms: false as unknown as true,
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    try {
      setLoading(true);
      setFormError(null);
      const pendingVerification = await registrationService.register({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        password: data.password,
      });
      router.push({
        pathname: '/(auth)/verify-email',
        params: { email: pendingVerification.email },
      });
    } catch (error) {
      setFormError(
        error instanceof RegistrationError
          ? error.message
          : t('register.failedMessage')
      );
    } finally {
      setLoading(false);
    }
  };

  // Paper's outlined input takes the same props on every field here; keeping
  // them in one place stops the form drifting out of step with itself.
  const fieldProps = {
    mode: 'outlined' as const,
    style: styles.input,
    contentStyle: styles.inputContent,
    textColor: colors.inputText,
    outlineColor: colors.inputBorder,
    activeOutlineColor: colors.inputBorderFocused,
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
          <Text style={styles.title}>{t('register.title')}</Text>
          <Text style={styles.description}>{t('register.subtitle')}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formLabel}>{t('register.formLabel')}</Text>

          {formError ? (
            <InlineFeedback
              tone="error"
              title={t('register.failed')}
              message={formError}
              onDismiss={() => setFormError(null)}
            />
          ) : null}

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Controller
                control={control}
                name="firstName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    {...fieldProps}
                    label={t('register.firstName')}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    autoCapitalize="words"
                    maxLength={40}
                    error={!!errors.firstName}
                  />
                )}
              />
              {errors.firstName && (
                <Text style={styles.errorText}>{errors.firstName.message}</Text>
              )}
            </View>

            <View style={styles.rowItem}>
              <Controller
                control={control}
                name="lastName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    {...fieldProps}
                    label={t('register.lastName')}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    autoCapitalize="words"
                    maxLength={40}
                    error={!!errors.lastName}
                  />
                )}
              />
              {errors.lastName && (
                <Text style={styles.errorText}>{errors.lastName.message}</Text>
              )}
            </View>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                {...fieldProps}
                label={t('register.email')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                error={!!errors.email}
                left={<TextInput.Icon icon="email-outline" color={colors.textSecondary} />}
              />
            )}
          />
          {errors.email ? (
            <Text style={styles.errorText}>{errors.email.message}</Text>
          ) : (
            <Text style={styles.helperText}>{t('register.emailHelper')}</Text>
          )}

          <Controller
            control={control}
            name="phone"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                {...fieldProps}
                label={t('register.phone')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                keyboardType="phone-pad"
                maxLength={15}
                error={!!errors.phone}
                left={<TextInput.Icon icon="phone-outline" color={colors.textSecondary} />}
              />
            )}
          />
          {errors.phone && <Text style={styles.errorText}>{errors.phone.message}</Text>}

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                {...fieldProps}
                label={t('register.password')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                error={!!errors.password}
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
          {errors.password ? (
            <Text style={styles.errorText}>{errors.password.message}</Text>
          ) : (
            <Text style={styles.helperText}>{t('register.passwordHelper')}</Text>
          )}

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                {...fieldProps}
                label={t('register.confirmPassword')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
                error={!!errors.confirmPassword}
                left={<TextInput.Icon icon="lock-check-outline" color={colors.textSecondary} />}
                right={
                  <TextInput.Icon
                    icon={showConfirm ? 'eye-off' : 'eye'}
                    onPress={() => setShowConfirm(!showConfirm)}
                    color={colors.textSecondary}
                  />
                }
              />
            )}
          />
          {errors.confirmPassword && (
            <Text style={styles.errorText}>{errors.confirmPassword.message}</Text>
          )}

          <Controller
            control={control}
            name="acceptedTerms"
            render={({ field: { onChange, value } }) => (
              <TouchableOpacity
                style={styles.termsRow}
                onPress={() => onChange(!value)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!value }}
              >
                <Checkbox
                  status={value ? 'checked' : 'unchecked'}
                  onPress={() => onChange(!value)}
                  color={colors.primary}
                />
                <Text style={styles.termsText}>{t('register.terms')}</Text>
              </TouchableOpacity>
            )}
          />
          {errors.acceptedTerms && (
            <Text style={styles.errorText}>{errors.acceptedTerms.message}</Text>
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
            {loading ? t('register.creating') : t('register.createAccount')}
          </Button>

          <View style={styles.securityNote}>
            <Ionicons name="business-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.securityText}>{t('register.orgNote')}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.signInRow}
          onPress={() => router.replace('/(auth)/login')}
          activeOpacity={0.7}
        >
          <Text style={styles.signInText}>{t('register.haveAccount')}</Text>
          <Text style={styles.signInLink}>{t('register.signIn')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  header: { alignItems: 'center', marginBottom: spacing.lg },
  logoImage: { width: 72, height: 72, borderRadius: borderRadius.xl },
  brandName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: spacing.sm,
  },
  intro: { marginBottom: spacing.lg },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
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
  row: { flexDirection: 'row', gap: spacing.sm },
  rowItem: { flex: 1 },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputContent: { height: 54 },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  helperText: {
    color: colors.textTertiary,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginLeft: -spacing.xs,
  },
  termsText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  button: { marginTop: spacing.md, borderRadius: borderRadius.md },
  buttonContent: { height: 54 },
  buttonLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  securityNote: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  securityText: {
    marginLeft: 6,
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  signInText: { fontSize: 14, color: colors.textSecondary },
  signInLink: { fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: 5 },
});
