/**
 * useNetworkStatus — Enterprise-grade network connectivity hook
 *
 * Strategy:
 *  - Primary:  expo-network (available in Expo SDK, no extra install needed)
 *  - Polling:  checks every 3 s so we react quickly without native event overhead
 *  - Debounce: ignores momentary flickers (< 1 s) before updating UI
 *
 * Returns:
 *  isConnected  — true when internet is available
 *  isChecking   — true during the first check (use for initial splash)
 *  recheck      — call this to force an immediate connectivity test
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Network from 'expo-network';

const POLL_INTERVAL_MS = 3000;   // re-check every 3 s
const DEBOUNCE_MS = 1000;        // ignore state changes faster than this

export interface NetworkStatus {
  isConnected: boolean;
  isChecking: boolean;
  recheck: () => void;
}

export function useNetworkStatus(): NetworkStatus {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(true);

  // Debounce timer — prevents flickering when signal is unstable
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyState = useCallback((connected: boolean) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setIsConnected(connected);
      setIsChecking(false);
    }, DEBOUNCE_MS);
  }, []);

  const checkConnectivity = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      const online =
        state.isConnected === true && state.isInternetReachable === true;
      applyState(online);
    } catch {
      // If the check itself fails, assume offline
      applyState(false);
    }
  }, [applyState]);

  // Force an immediate recheck (used by retry button)
  const recheck = useCallback(() => {
    setIsChecking(true);
    checkConnectivity();
  }, [checkConnectivity]);

  useEffect(() => {
    // Initial check on mount
    checkConnectivity();

    // Poll on an interval
    pollTimer.current = setInterval(checkConnectivity, POLL_INTERVAL_MS);

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [checkConnectivity]);

  return { isConnected, isChecking, recheck };
}
