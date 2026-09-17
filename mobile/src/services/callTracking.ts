import { PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  directionOf,
  getCallsSince,
  hasCallLogPermission,
  isCallLogAvailable,
} from '../../modules/call-log';
import { callService, type DeviceCallUpload, type LeadPhone } from './call.service';

/**
 * Call tracking, end to end: consent, permission, reading the phone's log,
 * deciding what belongs to a customer, and syncing only that.
 *
 * The rule this file exists to keep: **a call to someone who is not a customer
 * never leaves the phone.** Matching happens here, before any request is made
 * (docs/adr/0005-call-tracking.md, docs/PRIVACY-CALL-DATA.md).
 */

const CONSENT_KEY = 'leadbee_call_consent';
const LAST_SYNC_KEY = 'leadbee_call_last_sync';

/** The version of the disclosure someone agreed to; a reworded one asks again. */
export const CONSENT_VERSION = '2026-09-17';

/** How far back a first sync reaches. Older calls are history nobody expects to appear. */
const FIRST_SYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** One batch of the phone's log per sync; the next run continues from where it stopped. */
const READ_LIMIT = 500;

export interface ConsentRecord {
  version: string;
  grantedAt: string;
}

export const callTracking = {
  /** Android only: iOS has no call history API for any app, at any entitlement. */
  get isSupported(): boolean {
    return Platform.OS === 'android' && isCallLogAvailable;
  },

  async getConsent(): Promise<ConsentRecord | null> {
    const raw = await SecureStore.getItemAsync(CONSENT_KEY);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as ConsentRecord;
      // A reworded disclosure is a new decision, not an old one.
      return record.version === CONSENT_VERSION ? record : null;
    } catch {
      return null;
    }
  },

  async grantConsent(): Promise<ConsentRecord> {
    const record: ConsentRecord = { version: CONSENT_VERSION, grantedAt: new Date().toISOString() };
    await SecureStore.setItemAsync(CONSENT_KEY, JSON.stringify(record));
    return record;
  },

  /** Withdrawing stops reading immediately; calls already recorded stay with the organization. */
  async withdrawConsent(): Promise<void> {
    await SecureStore.deleteItemAsync(CONSENT_KEY);
    await SecureStore.deleteItemAsync(LAST_SYNC_KEY);
  },

  hasPermission(): boolean {
    return this.isSupported && hasCallLogPermission();
  },

  /**
   * Asks Android for the permission. Only ever called after the person has
   * read the disclosure and chosen to continue — Play requires that order, and
   * so does deserving the answer.
   */
  async requestPermission(): Promise<boolean> {
    if (!this.isSupported) return false;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      // Android's own dialog is terse; the app has already explained itself.
      {
        title: 'Allow LeadBee to read your call log',
        message:
          'Only calls with customers in LeadBee are recorded. Every other call stays on your phone.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  },

  /**
   * Reads new calls, keeps the ones belonging to a customer, and sends those.
   * Silent when consent or permission is missing: call tracking is a feature,
   * never a condition of using the app.
   */
  async sync(): Promise<{ written: number; matched: number; read: number } | null> {
    if (!this.isSupported) return null;
    if (!(await this.getConsent())) return null;
    if (!hasCallLogPermission()) return null;

    const since = await readLastSync();
    const calls = await getCallsSince(since, READ_LIMIT);
    if (calls.length === 0) {
      await writeLastSync(Date.now());
      return { written: 0, matched: 0, read: 0 };
    }

    const index = await callService.getPhoneIndex();
    const byNumber = phoneLookup(index);

    const matched: DeviceCallUpload[] = [];
    for (const call of calls) {
      const direction = directionOf(call.type);
      if (!direction) continue; // voicemail, blocked: not a call with a customer

      const leadId = byNumber.get(normalise(call.number));
      // Not a customer — discarded here, never uploaded.
      if (!leadId) continue;

      matched.push({
        deviceCallId: call.id,
        leadId,
        phoneNumber: normalise(call.number),
        direction,
        calledAt: new Date(call.timestamp).toISOString(),
        durationSeconds: call.durationSeconds,
      });
    }

    const result = matched.length > 0 ? await callService.sync(matched) : { written: 0, skipped: 0 };

    // Continue from the newest call read, so nothing is read twice and nothing
    // between this sync and the next is skipped.
    const newest = calls.reduce((latest, call) => Math.max(latest, call.timestamp), since);
    await writeLastSync(newest);

    return { written: result.written, matched: matched.length, read: calls.length };
  },
};

/** Last ten digits: the same number appears with and without a country code. */
function normalise(number: string): string {
  return (number || '').replace(/\D/g, '').slice(-10);
}

function phoneLookup(index: LeadPhone[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of index) map.set(entry.phone, entry.leadId);
  return map;
}

async function readLastSync(): Promise<number> {
  const raw = await SecureStore.getItemAsync(LAST_SYNC_KEY);
  const stored = raw ? Number(raw) : NaN;
  return Number.isFinite(stored) ? stored : Date.now() - FIRST_SYNC_WINDOW_MS;
}

async function writeLastSync(timestamp: number): Promise<void> {
  await SecureStore.setItemAsync(LAST_SYNC_KEY, String(timestamp));
}
