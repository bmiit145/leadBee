import { requireOptionalNativeModule } from 'expo-modules-core';

/** One entry of the phone's call log, as Android stores it. */
export interface DeviceCall {
  /** The phone's own id for the entry — the key that keeps syncing idempotent. */
  id: string;
  number: string;
  /** Android's `CallLog.Calls.TYPE`. See `directionOf`. */
  type: number;
  /** Milliseconds since the epoch. */
  timestamp: number;
  durationSeconds: number;
}

export type CallDirection = 'incoming' | 'outgoing' | 'missed' | 'rejected';

interface CallLogNative {
  hasPermission(): boolean;
  getCallsSince(sinceEpochMs: number, limit: number): Promise<DeviceCall[]>;
}

/**
 * Absent on iOS — which has no call history API for any app — and on any build
 * made before this module existed. Callers check `isCallLogAvailable` and carry
 * on without it; call tracking is a feature, never a requirement.
 */
const native = requireOptionalNativeModule<CallLogNative>('LeadBeeCallLog');

export const isCallLogAvailable = native !== null;

export function hasCallLogPermission(): boolean {
  return native?.hasPermission() ?? false;
}

export async function getCallsSince(sinceEpochMs: number, limit = 500): Promise<DeviceCall[]> {
  if (!native) return [];
  return native.getCallsSince(sinceEpochMs, limit);
}

/** Android's call types, named. 4 is voicemail and 6 blocked — neither is a call with a customer. */
export function directionOf(type: number): CallDirection | null {
  switch (type) {
    case 1:
      return 'incoming';
    case 2:
      return 'outgoing';
    case 3:
      return 'missed';
    case 5:
      return 'rejected';
    default:
      return null;
  }
}
