import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { Button } from 'react-native-paper';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  registrationService,
  RegistrationError,
} from '../../src/services/registration.service';
import { colors, spacing, borderRadius } from '../../src/theme';
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';

const CODE_LENGTH = registrationService.codeLength;
/** Long enough that a slow mail server is not mistaken for a broken button. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Confirm the emailed code.
 *
 * One hidden input backs all six boxes rather than six focused inputs: the
 * keyboard never moves between fields, paste puts the whole code in at once,
 * and there is no focus to lose when a digit is deleted.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [devCode, setDevCode] = useState<string | null>(
    () => (email ? registrationService.devCodeFor(email) : undefined) ?? null
  );

  const inputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (!email) {
      setError(t('verifyEmail.missingEmail'));
      return;
    }
    try {
      setVerifying(true);
      setError(null);
      await registrationService.verify(email, value);
      setVerified(true);
    } catch (err) {
      setError(
        err instanceof RegistrationError ? err.message : t('verifyEmail.failedMessage')
      );
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const onChangeCode = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    // Submitting on the last digit saves a deliberate tap on a button whose
    // only possible moment to be pressed is exactly now.
    if (digits.length === CODE_LENGTH) void submit(digits);
  };

  const onResend = async () => {
    if (!email || cooldown > 0) return;
    try {
      setResending(true);
      setError(null);
      await registrationService.resend(email);
      // Read back from the service rather than the response: inside the
      // cooldown no new code is issued and the previous one still stands.
      setDevCode(registrationService.devCodeFor(email) ?? null);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode('');
    } catch (err) {
      setError(
        err instanceof RegistrationError ? err.message : t('verifyEmail.failedMessage')
      );
    } finally {
      setResending(false);
    }
  };

  if (verified) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={40} color={colors.surface} />
        </View>
        <Text style={styles.title}>{t('verifyEmail.successTitle')}</Text>
        <Text style={[styles.description, styles.successText]}>
          {t('verifyEmail.successBody')}
        </Text>

        {/* The organization step is the next screen to build, not this one.
            Saying so beats dropping someone at a dead end. */}
        <View style={styles.nextCard}>
          <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.nextText}>{t('verifyEmail.nextStep')}</Text>
        </View>

        <Button
          mode="contained"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
          buttonColor={colors.primary}
        >
          {t('verifyEmail.backToSignIn')}
        </Button>
      </View>
    );
  }

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
        <TouchableOpacity
          style={styles.backRow}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Text style={styles.backText}>{t('verifyEmail.back')}</Text>
        </TouchableOpacity>

        <View style={styles.mailIcon}>
          <Ionicons name="mail-open-outline" size={32} color={colors.text} />
        </View>

        <Text style={styles.title}>{t('verifyEmail.title')}</Text>
        <Text style={styles.description}>
          {t('verifyEmail.subtitle')}
          {'\n'}
          <Text style={styles.emailText}>{email ?? t('verifyEmail.yourEmail')}</Text>
        </Text>

        {error ? (
          <View style={styles.feedbackWrap}>
            <InlineFeedback
              tone="error"
              title={t('verifyEmail.failed')}
              message={error}
              onDismiss={() => setError(null)}
            />
          </View>
        ) : null}

        {/* One real input, visually hidden behind the boxes it fills. */}
        <TouchableOpacity
          style={styles.codeRow}
          activeOpacity={1}
          onPress={() => inputRef.current?.focus()}
          accessibilityRole="button"
          accessibilityLabel={t('verifyEmail.codeAccessibility')}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.codeBox,
                index === code.length && styles.codeBoxActive,
                !!code[index] && styles.codeBoxFilled,
              ]}
            >
              <Text style={styles.codeDigit}>{code[index] ?? ''}</Text>
            </View>
          ))}
          <RNTextInput
            ref={inputRef}
            value={code}
            onChangeText={onChangeCode}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoFocus
            editable={!verifying}
            style={styles.hiddenInput}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
          />
        </TouchableOpacity>

        <Button
          mode="contained"
          onPress={() => submit(code)}
          loading={verifying}
          disabled={verifying || code.length < CODE_LENGTH}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
          buttonColor={colors.primary}
        >
          {verifying ? t('verifyEmail.verifying') : t('verifyEmail.verify')}
        </Button>

        <View style={styles.resendRow}>
          <Text style={styles.resendText}>{t('verifyEmail.noCode')}</Text>
          <TouchableOpacity
            onPress={onResend}
            disabled={cooldown > 0 || resending}
            activeOpacity={0.7}
          >
            <Text style={[styles.resendLink, cooldown > 0 && styles.resendLinkDisabled]}>
              {cooldown > 0
                ? t('verifyEmail.resendIn', { seconds: cooldown })
                : t('verifyEmail.resend')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* No mail is actually sent yet, so in a dev build the code is shown
            here. Guarded by __DEV__: a release build must never print it. */}
        {__DEV__ && devCode && (
          <View style={styles.devHint}>
            <Ionicons name="construct-outline" size={14} color={colors.warning} />
            <Text style={styles.devHintText}>
              {t('verifyEmail.devHint', { code: devCode })}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
    marginLeft: -spacing.xs,
  },
  backText: { fontSize: 14, fontWeight: '600', color: colors.text },
  mailIcon: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
  successText: { textAlign: 'center' },
  emailText: { color: colors.text, fontWeight: '700' },
  feedbackWrap: { marginTop: spacing.md },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeBoxActive: { borderColor: colors.inputBorderFocused },
  codeBoxFilled: { borderColor: colors.text, backgroundColor: colors.surfaceVariant },
  codeDigit: { fontSize: 24, fontWeight: '700', color: colors.text },
  hiddenInput: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0,
  },
  button: { marginTop: spacing.md, borderRadius: borderRadius.md, alignSelf: 'stretch' },
  buttonContent: { height: 54 },
  buttonLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  resendText: { fontSize: 14, color: colors.textSecondary },
  resendLink: { fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: 5 },
  resendLinkDisabled: { color: colors.textTertiary },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  nextText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  devHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xl,
  },
  devHintText: { fontSize: 12, color: colors.warning },
});
