/**
 * Simple logger utility for React Native.
 * In a real application, this might push logs to Sentry, DataDog, etc.
 */
export const logger = {
  info: (message: string, data?: any) => {
    if (process.env.EXPO_PUBLIC_ENVIRONMENT !== 'production') {
      console.info(`ℹ️ [INFO]: ${message}`, data || '');
    }
  },
  warn: (message: string, data?: any) => {
    console.warn(`⚠️ [WARN]: ${message}`, data || '');
  },
  error: (message: string, error?: any) => {
    console.error(`❌ [ERROR]: ${message}`, error || '');
    // e.g., Sentry.captureException(error);
  },
  debug: (message: string, data?: any) => {
    if (process.env.EXPO_PUBLIC_ENVIRONMENT === 'development') {
      console.debug(`🐛 [DEBUG]: ${message}`, data || '');
    }
  },
};
