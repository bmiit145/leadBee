import { Platform } from 'react-native';

type HapticsModule = typeof import('expo-haptics');

/**
 * `expo-haptics` is a native module, so it only exists in a binary built after
 * it was added. Loading it lazily — and treating a failure as "this device has
 * no haptics" — keeps an older build running instead of failing at import.
 */
let cached: HapticsModule | null | undefined;

function haptics(): HapticsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-haptics') as HapticsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Small physical confirmations, for gestures that have no button to press —
 * the double tap that switches organization, the press-and-hold that opens the
 * switcher.
 *
 * Feedback, never the thing itself: a device with no motor, system haptics
 * switched off, or a build older than this package loses the buzz and nothing
 * else.
 */
function safely(run: (module: HapticsModule) => Promise<unknown>): void {
  if (Platform.OS === 'web') return;
  const module = haptics();
  if (!module) return;
  try {
    void run(module).catch(() => undefined);
  } catch {
    // No haptic engine in this build — the gesture still did its work.
  }
}

/** A gesture was recognised and something is happening. */
export function tapFeedback(): void {
  safely((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
}

/** A picker or sheet opened under the finger. */
export function selectionFeedback(): void {
  safely((h) => h.selectionAsync());
}

/** The gesture could not be carried out. */
export function warningFeedback(): void {
  safely((h) => h.notificationAsync(h.NotificationFeedbackType.Warning));
}
