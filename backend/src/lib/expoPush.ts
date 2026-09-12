import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Push delivery through Expo's push service.
 *
 * Expo fronts FCM and APNs behind one token format the app already obtains, so
 * the server needs no platform credentials of its own. Called with plain
 * `fetch` rather than `expo-server-sdk`: the protocol is one POST, and a
 * dependency for that is more surface than it saves.
 * See docs/adr/0002-notifications.md.
 *
 * Push is a courtesy on top of the in-app inbox, never the record of it, so
 * nothing here throws. Tokens are never logged — anyone holding one can push
 * to that device.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo's documented per-request ceiling. */
const MAX_PER_REQUEST = 100;
const TIMEOUT_MS = 10_000;
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const ticketsResponse = z.object({
  data: z.array(
    z.object({
      status: z.string(),
      details: z.object({ error: z.string().optional() }).optional(),
    })
  ),
});

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN.test(value);
}

/**
 * Sends each message once.
 *
 * @returns the tokens Expo reported as no longer registered (app uninstalled,
 *          permission revoked), so the caller can stop sending to them.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<string[]> {
  const deliverable = messages.filter((m) => isExpoPushToken(m.to));
  const stale: string[] = [];

  for (let start = 0; start < deliverable.length; start += MAX_PER_REQUEST) {
    const batch = deliverable.slice(start, start + MAX_PER_REQUEST);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default' }))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn({ status: response.status, count: batch.length }, 'push batch rejected');
        continue;
      }

      const parsed = ticketsResponse.safeParse(await response.json());
      if (!parsed.success) {
        logger.warn({ count: batch.length }, 'push response not understood');
        continue;
      }

      // Tickets come back in request order, one per message.
      parsed.data.data.forEach((ticket, index) => {
        const message = batch[index];
        if (message && ticket.details?.error === 'DeviceNotRegistered') stale.push(message.to);
      });
    } catch (error) {
      logger.warn({ err: error, count: batch.length }, 'push batch failed');
    }
  }

  return stale;
}
