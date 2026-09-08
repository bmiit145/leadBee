import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { getCurrentLanguage, toggleAppLanguage } from '../i18n';
import { colors, spacing, borderRadius } from '../theme';

export const LanguageToggle: React.FC = () => {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const currentLanguage = getCurrentLanguage();

  const handleToggle = async () => {
    if (isBusy) return;
    try {
      setIsBusy(true);
      await toggleAppLanguage();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Pressable
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel={t('language.switchLanguage')}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
      disabled={isBusy}
    >
      <Ionicons name="language-outline" size={14} color={colors.primary} />
      <Text style={styles.label}>
        {currentLanguage === 'en' ? t('language.toggleToGujarati') : t('language.toggleToEnglish')}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 32,
    minWidth: 56,
    marginRight: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '60',
    backgroundColor: colors.primary + '10',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
});
