import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { z } from 'zod';
import i18n from '../i18n';
import { authService } from './auth.service';
import { notificationHref } from './notification.service';

type NotificationsModule = typeof import('expo-notifications');

/** Where a tapped push leads, and which inbox row it came from. */
export interface PushTap {
  href: string;
  notificationId?: string;
}

/**
 * Push registration and tap routing.
 *
 * `expo-notifications` is a native module, and every one of its files asks for
 * its native half the moment it loads. A JS bundle shipped over the air to a
 * binary built before the module was added (MOB-19) would crash on import. So
 * the package is loaded only after confirming the native side exists; an older
 * build simply goes without push, and the in-app inbox still works.
 */
let loading: Promise<NotificationsModule | null> | undefined;

function loadNotifications(): Promise<NotificationsModule | null> {
  if (!loading) {
    loading = requireOptionalNativeModule('ExpoPushTokenManager')
      ? import('expo-notifications').catch(() => null)
      : Promise.resolve(null);
  }
  return loading;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** A push's payload arrives from outside the app, so it is parsed, not trusted. */
const pushPayload = z.object({
  entityType: z.enum(['lead', 'task', 'meeting']),
  entityId: z.string().regex(OBJECT_ID),
  // Optional and forgiving: a malformed id costs only the read receipt, never the tap.
  notificationId: z.string().regex(OBJECT_ID).optional().catch(undefined),
});

function easProjectId(): string | undefined {
  const fromExtra: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;
  return Constants.easConfig?.projectId ?? undefined;
}

/**
 * Asks for permission and registers this device's token with the API.
 *
 * Silent on every failure. Push is a courtesy on top of the inbox, and a
 * refused permission or a missing EAS project must never interrupt sign-in.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    const Notifications = await loadNotifications();
    // Expo cannot mint a token without an EAS project. That is a build
    // configuration step (docs/adr/0002-notifications.md), not a runtime error.
    const projectId = easProjectId();
    if (!Notifications || !projectId) return;

    // Android 13+ shows the permission prompt only once a channel exists.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: i18n.t('notifications.channelName'),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const granted =
      current.granted ||
      (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await authService.registerPushToken(token);
  } catch (error) {
    if (__DEV__) console.warn('Push registration skipped:', error);
  }
}

/**
 * Shows pushes while the app is open, reports a tapped one, and reports
 * arrivals so the badge can refresh.
 *
 * A tap is *reported*, not navigated: on a cold start it arrives before the
 * app has a session or a navigator, so the caller decides when to act on it.
 *
 * @returns an unsubscribe for the effect that set it up.
 */
export function listenForNotifications(handlers: {
  onOpen: (tap: PushTap) => void;
  onReceive: () => void;
}): () => void {
  let isCancelled = false;
  const subscriptions: Array<{ remove: () => void }> = [];

  void loadNotifications()
    .then(async (Notifications) => {
      if (!Notifications || isCancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      const report = (data: unknown) => {
        const parsed = pushPayload.safeParse(data);
        if (!parsed.success) return;
        handlers.onOpen({
          href: notificationHref(parsed.data.entityType, parsed.data.entityId),
          notificationId: parsed.data.notificationId,
        });
      };

      subscriptions.push(
        Notifications.addNotificationReceivedListener(() => handlers.onReceive()),
        Notifications.addNotificationResponseReceivedListener((response) =>
          report(response.notification.request.content.data)
        )
      );

      // A tap that cold-started the app happened before this listener existed.
      // Cleared once reported, so the same tap is not replayed the next time
      // this listener is set up.
      const launchedBy = await Notifications.getLastNotificationResponseAsync();
      if (launchedBy && !isCancelled) {
        report(launchedBy.notification.request.content.data);
        await Notifications.clearLastNotificationResponseAsync();
      }
    })
    .catch(() => undefined);

  return () => {
    isCancelled = true;
    subscriptions.forEach((subscription) => subscription.remove());
  };
}
