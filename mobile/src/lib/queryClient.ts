import { AppState, type AppStateStatus, Platform } from 'react-native';
import { QueryClient, focusManager } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

/**
 * TanStack Query's default focus detection is a browser one — on React Native
 * it never fires, so the client believes the app is focused forever and polling
 * queries (the unread badge, for one) keep hitting the API from the background.
 *
 * Telling it about `AppState` stops that, and makes `refetchOnWindowFocus` mean
 * what it says for any query that opts in.
 */
AppState.addEventListener('change', (status: AppStateStatus) => {
  // Web has no AppState worth trusting; its own visibility handling is correct.
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
});
