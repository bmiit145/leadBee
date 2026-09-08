import { MD3LightTheme, configureFonts } from 'react-native-paper';

// ─── Core Palette ───
export const colors = {
  // Primary
  primary: '#6C63FF',
  primaryDark: '#5A52D5',
  primaryLight: '#8B85FF',

  // Semantic
  secondary: '#FF6584',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',

  // Surfaces
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceVariant: '#F0F1F3',

  // Text — WCAG AA compliant on #F4F5F7 and #FFFFFF
  text: '#111827',
  textSecondary: '#4B5563',
  textTertiary: '#6B7280',
  textDisabled: '#9CA3AF',

  // Borders
  border: '#D1D5DB',
  borderLight: '#E5E7EB',

  // Input-specific
  inputText: '#111827',
  inputLabel: '#374151',
  inputPlaceholder: '#9CA3AF',
  inputBorder: '#D1D5DB',
  inputBorderFocused: '#6C63FF',
  inputBackground: '#FFFFFF',

  // Status
  status: {
    idle: '#6B7280',
    nonVisited: '#D97706',
    visited: '#D97706',
    sold: '#16A34A',
  },
};

// ─── Spacing Scale (4px base) ───
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Border Radius ───
export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
};

// ─── Typography ───
export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.5 },
  h2: { fontSize: 24, fontWeight: '600' as const, color: colors.text, letterSpacing: -0.3 },
  h3: { fontSize: 20, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.text },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const, color: colors.text },
  bodySmall: { fontSize: 14, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.textSecondary },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.inputLabel, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
};

// ─── Shadow Presets ───
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
};

// ─── React Native Paper Theme (MD3) ───
export const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: '#FFFFFF',
    primaryContainer: '#EDE9FE',
    secondary: colors.secondary,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceVariant,
    onSurface: colors.text,
    onSurfaceVariant: colors.textSecondary,
    outline: colors.inputBorder,
    outlineVariant: colors.borderLight,
    error: colors.error,
    onError: '#FFFFFF',
    elevation: {
      level0: 'transparent',
      level1: colors.surface,
      level2: colors.surface,
      level3: colors.surface,
      level4: colors.surface,
      level5: colors.surface,
    },
  },
};
