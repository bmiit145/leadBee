import { MD3LightTheme, configureFonts } from 'react-native-paper';

// ─── Core Palette ───
export const colors = {
  // Primary
  primary: '#000000',
  primaryDark: '#000000',
  primaryLight: '#333333',

  // Semantic
  secondary: '#666666',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',

  // Surfaces
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceVariant: '#F4F4F5',

  // Text
  text: '#09090B',
  textSecondary: '#71717A',
  textTertiary: '#A1A1AA',
  textDisabled: '#D4D4D8',

  // Borders
  border: '#E4E4E7',
  borderLight: '#F4F4F5',

  // Input-specific
  inputText: '#09090B',
  inputLabel: '#27272A',
  inputPlaceholder: '#A1A1AA',
  inputBorder: '#E4E4E7',
  inputBorderFocused: '#000000',
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
    primaryContainer: '#F4F4F5',
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
