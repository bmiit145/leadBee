import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, Snackbar } from 'react-native-paper';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Updates from 'expo-updates';
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  View,
} from 'react-native';

import { paperTheme, colors } from '../src/theme';
import { AuthProvider, useAuth } from '../src/stores/auth.store';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';
import { NoInternetScreen } from '../src/components/NoInternetScreen';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ServerDownScreen } from '../src/components/ServerDownScreen';
import { OrgInactiveScreen } from '../src/components/OrgInactiveScreen';
import { queryClient } from '../src/lib/queryClient';
import { initializeI18n } from '../src/i18n';

const OTA_LAST_APPLIED_UPDATE_ID_KEY = 'ota:lastAppliedUpdateId';

function RootLayoutContent() {
  const { t } = useTranslation();
  const {
    isInitialized,
    isAuthenticated,
    serverStatus,
    isCheckingServer,
    checkServerHealth,
    orgInactiveMessage,
    logout,
  } = useAuth();

  const router = useRouter();
  const hasCheckedOtaRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [showOtaSnackbar, setShowOtaSnackbar] = useState(false);
  const [otaSnackbarMessage, setOtaSnackbarMessage] = useState('');

  const { isConnected, isChecking, recheck } = useNetworkStatus();

  useEffect(() => {
    void initializeI18n();
  }, []);

  /**
   * Over-the-air JS updates.
   *
   * `expo-updates` only. The Firebase Remote Config and Play in-app-update
   * layer the reference app carried has been dropped: it depended on another
   * product's Firebase project, and an API URL that can be repointed remotely
   * is a redirection risk this product does not need.
   */
  const runBackgroundOtaCheck = useCallback(async () => {
    try {
      if (__DEV__ || !Updates.isEnabled) return;

      const net = await Network.getNetworkStateAsync();
      if (net.isConnected === false || net.isInternetReachable === false) return;

      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) return;

      const fetched: any = await Updates.fetchUpdateAsync();
      const fetchedUpdateId =
        fetched?.manifest?.id || fetched?.manifest?.updateId || fetched?.updateId || null;

      // Skip only if this exact update was already APPLIED. The id is stored
      // when the user taps Restart, not when they are merely prompted — so
      // dismissing the prompt does not silently lose the update.
      if (fetchedUpdateId) {
        const lastApplied = await AsyncStorage.getItem(OTA_LAST_APPLIED_UPDATE_ID_KEY);
        if (lastApplied === fetchedUpdateId) return;
      }

      Alert.alert(t('updates.title'), t('updates.updateReadyInBackground'), [
        { text: t('updates.later'), style: 'cancel' },
        {
          text: t('updates.restartNow'),
          onPress: async () => {
            if (fetchedUpdateId) {
              await AsyncStorage.setItem(OTA_LAST_APPLIED_UPDATE_ID_KEY, fetchedUpdateId);
            }
            void Updates.reloadAsync();
          },
        },
      ]);

      setOtaSnackbarMessage(t('updates.updateReadyInBackground'));
      setShowOtaSnackbar(true);
    } catch (error) {
      // Silent by design: a failed update check must never interrupt startup.
      if (__DEV__) console.log('Background OTA check skipped:', error);
    }
  }, [t]);

  useEffect(() => {
    if (hasCheckedOtaRef.current) return;
    hasCheckedOtaRef.current = true;
    const timer = setTimeout(() => void runBackgroundOtaCheck(), 1800);
    return () => clearTimeout(timer);
  }, [runBackgroundOtaCheck]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const wasBackgrounded =
        appStateRef.current === 'background' || appStateRef.current === 'inactive';
      if (wasBackgrounded && nextAppState === 'active') {
        void runBackgroundOtaCheck();
      }
      appStateRef.current = nextAppState;
    });
    return () => subscription.remove();
  }, [runBackgroundOtaCheck]);

  // ─── Routing ───────────────────────────────────────────────────────────────
  // The lead workspace is the whole product, so there is one destination.
  useEffect(() => {
    if (!isInitialized) return;
    if (serverStatus !== 'healthy') return;

    if (isAuthenticated) {
      router.replace('/(leads)');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isInitialized, isAuthenticated, router, serverStatus]);

  if (!isInitialized) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isServerDown = serverStatus === 'unreachable' || serverStatus === 'database_down';
  if (isServerDown) {
    return (
      <ServerDownScreen
        status={serverStatus}
        onRetry={checkServerHealth}
        isChecking={isCheckingServer}
      />
    );
  }

  // The tenant is suspended or its trial lapsed. The credentials are valid, so
  // this is not a sign-in problem and must not be reported as one.
  if (orgInactiveMessage) {
    return (
      <OrgInactiveScreen
        message={orgInactiveMessage}
        onSignOut={async () => {
          await logout();
          router.replace('/(auth)/login');
        }}
      />
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="(leads)" options={{ headerShown: false, animation: 'none' }} />
      </Stack>

      {/*
        Offline overlay — drawn above the navigation stack rather than replacing
        it, so the stack stays mounted and the user resumes exactly where they
        were once connectivity returns.
      */}
      {!isConnected && <NoInternetScreen onRetry={recheck} isChecking={isChecking} />}

      <Snackbar
        visible={showOtaSnackbar}
        onDismiss={() => setShowOtaSnackbar(false)}
        duration={9000}
        action={{
          label: t('updates.restartNow'),
          onPress: () => void Updates.reloadAsync(),
        }}
      >
        {otaSnackbarMessage}
      </Snackbar>
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PaperProvider theme={paperTheme}>
            <StatusBar style="dark" />
            <RootLayoutContent />
          </PaperProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
