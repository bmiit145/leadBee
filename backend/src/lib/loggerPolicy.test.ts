import { describe, expect, it } from 'vitest';
import { shouldUsePrettyTransport } from './loggerPolicy.js';

describe('shouldUsePrettyTransport', () => {
  it('uses pretty logs in local development', () => {
    expect(shouldUsePrettyTransport(true, false)).toBe(true);
  });

  it('keeps Vercel logs as structured JSON even when NODE_ENV is development', () => {
    expect(shouldUsePrettyTransport(true, true)).toBe(false);
  });

  it('does not enable pretty logs outside development', () => {
    expect(shouldUsePrettyTransport(false, false)).toBe(false);
  });
});
