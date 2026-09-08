import { createTheme, type Theme } from '@mui/material/styles';

/**
 * MUI, bent to the monochrome system.
 *
 * MUI's default palette is built around a saturated primary; here "primary" is
 * near-black in light mode and near-white in dark, so the two libraries do not
 * fight over what a button looks like. Tailwind handles layout, MUI handles
 * behaviour-heavy components (menus, dialogs, data grid), and both read the
 * same CSS custom properties from index.css.
 */

const shared = {
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    h1: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.015em' },
    h3: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' },
    button: { textTransform: 'none' as const, fontWeight: 500 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none' as const, fontWeight: 500 },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 400 },
    },
  },
} as const;

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#0a0a0a', contrastText: '#fafafa' },
    secondary: { main: '#525252' },
    error: { main: '#b42318' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#0a0a0a', secondary: '#737373' },
    divider: '#e5e5e5',
  },
});

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#fafafa', contrastText: '#0a0a0a' },
    secondary: { main: '#a3a3a3' },
    error: { main: '#f97066' },
    background: { default: '#0a0a0a', paper: '#141414' },
    text: { primary: '#fafafa', secondary: '#a3a3a3' },
    divider: '#262626',
  },
});
