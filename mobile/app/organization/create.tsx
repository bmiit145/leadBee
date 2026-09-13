import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/stores/auth.store';
import { onboardingService } from '../../src/services/onboarding.service';
import { apiErrorMessage } from '../../src/services/api';
import { InlineFeedback } from '../../src/components/ui/InlineFeedback';
import { colors, spacing, borderRadius } from '../../src/theme';

const NAME_MIN = 2;
const NAME_MAX = 120;
const HANDLE_MIN = 3;
const HANDLE_MAX = 50;
/** Long enough to skip the keystrokes in the middle of a word. */
const HANDLE_CHECK_DELAY_MS = 400;

/** `Acme Realty Pvt. Ltd.` → `acme-realty-pvt-ltd`, mirroring the API. */
function toHandle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX);
}

type HandleState = 'idle' | 'checking' | 'available' | 'taken' | 'too_short' | 'unknown';

/**
 * Create your own organization — reached from the no-organization screen.
 *
 * Asks only for what an organization needs. The owner is the person already
 * signed in, so their name, email, mobile and password are not asked again.
 * On success the app switches straight into the new organization.
 */
export default function CreateOrganizationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { account, createOrganization } = useAuth();

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  // Once the handle is edited by hand, the name stops overwriting it.
  const [handleTouched, setHandleTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [handleState, setHandleState] = useState<HandleState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestCheck = useRef(0);

  const nameValid = name.trim().length >= NAME_MIN;

  // Availability is advisory: the API checks again when the form is submitted.
  useEffect(() => {
    if (!handle) {
      setHandleState('idle');
      return;
    }
    if (handle.length < HANDLE_MIN) {
      setHandleState('too_short');
      return;
    }
    setHandleState('checking');
    const checkId = ++latestCheck.current;
    const timer = setTimeout(async () => {
      try {
        const result = await onboardingService.isHandleAvailable(handle);
        // A slower answer for an older value must not overwrite a newer one.
        if (checkId !== latestCheck.current) return;
        setHandleState(result.available ? 'available' : result.reason === 'too_short' ? 'too_short' : 'taken');
      } catch {
        if (checkId === latestCheck.current) setHandleState('unknown');
      }
    }, HANDLE_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [handle]);

  const onChangeName = (value: string) => {
    setName(value);
    setError(null);
    if (!handleTouched) setHandle(toHandle(value));
  };

  const onChangeHandle = (value: string) => {
    setHandleTouched(true);
    setError(null);
    // Kept typeable: a trailing hyphen is allowed while the handle is being written.
    setHandle(value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, HANDLE_MAX));
  };

  // `unknown` (the check itself failed) does not block: the API decides.
  const canSubmit =
    nameValid && handleState !== 'checking' && handleState !== 'taken' && handleState !== 'too_short' && !submitting;

  const onSubmit = async () => {
    setNameTouched(true);
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      setError(null);
      await createOrganization({
        organizationName: name.trim(),
        slug: toHandle(handle) || undefined,
      });
      router.replace('/(leads)');
    } catch (err) {
      setError(apiErrorMessage(err, t('createOrganization.failedMessage')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleHint = (() => {
    switch (handleState) {
      case 'checking':
        return { icon: null, color: colors.textSecondary, text: t('createOrganization.handleChecking') };
      case 'available':
        return {
          icon: 'checkmark-circle' as const,
          color: colors.success,
          text: t('createOrganization.handleAvailable', { slug: handle }),
        };
      case 'taken':
        return {
          icon: 'close-circle' as const,
          color: colors.error,
          text: t('createOrganization.handleTaken', { slug: handle }),
        };
      case 'too_short':
        return { icon: 'alert-circle' as const, color: colors.error, text: t('createOrganization.handleTooShort') };
      default:
        return { icon: null, color: colors.textSecondary, text: t('createOrganization.handleHelper') };
    }
  })();

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
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backRow}
          onPress={() => router.back()}
          disabled={submitting}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Text style={styles.backText}>{t('createOrganization.back')}</Text>
        </TouchableOpacity>

        <View style={styles.iconBadge}>
          <Ionicons name="business-outline" size={30} color={colors.text} />
        </View>

        <Text style={styles.title}>{t('createOrganization.title')}</Text>
        <Text style={styles.description}>{t('createOrganization.subtitle')}</Text>

        <View style={styles.form}>
          <Text style={styles.formLabel}>{t('createOrganization.formLabel')}</Text>

          {error ? (
            <InlineFeedback
              tone="error"
              title={t('createOrganization.failed')}
              message={error}
              onDismiss={() => setError(null)}
            />
          ) : null}

          <TextInput
            {...fieldProps}
            label={t('createOrganization.name')}
            value={name}
            onChangeText={onChangeName}
            onBlur={() => setNameTouched(true)}
            autoCapitalize="words"
            autoFocus
            maxLength={NAME_MAX}
            error={nameTouched && !nameValid}
            editable={!submitting}
            left={<TextInput.Icon icon="domain" color={colors.textSecondary} />}
          />
          {nameTouched && !nameValid ? (
            <Text style={styles.errorText}>{t('createOrganization.nameRequired')}</Text>
          ) : null}

          <TextInput
            {...fieldProps}
            label={t('createOrganization.handle')}
            value={handle}
            onChangeText={onChangeHandle}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={HANDLE_MAX}
            error={handleState === 'taken' || handleState === 'too_short'}
            editable={!submitting}
            left={<TextInput.Icon icon="at" color={colors.textSecondary} />}
          />
          <View style={styles.hintRow}>
            {handleState === 'checking' ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : handleHint.icon ? (
              <Ionicons name={handleHint.icon} size={14} color={handleHint.color} />
            ) : null}
            <Text style={[styles.hintText, { color: handleHint.color }]}>{handleHint.text}</Text>
          </View>

          {account?.email ? (
            <View style={styles.ownerNote}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.ownerNoteText}>
                {t('createOrganization.ownerNote', { email: account.email })}
              </Text>
            </View>
          ) : null}

          <Button
            mode="contained"
            onPress={onSubmit}
            loading={submitting}
            disabled={!canSubmit}
            style={styles.button}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            buttonColor={colors.primary}
          >
            {submitting ? t('createOrganization.creating') : t('createOrganization.create')}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
    marginLeft: -spacing.xs,
  },
  backText: { fontSize: 14, fontWeight: '600', color: colors.text },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surfaceVariant,
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
  form: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xl,
  },
  formLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputContent: { height: 54 },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: spacing.xs,
    marginBottom: spacing.md,
    minHeight: 18,
  },
  hintText: { flex: 1, fontSize: 12, lineHeight: 17 },
  ownerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  ownerNoteText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  button: { marginTop: spacing.lg, borderRadius: borderRadius.md },
  buttonContent: { height: 54 },
  buttonLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
});
