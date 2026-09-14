import { describe, expect, it } from 'vitest';
import { chooseSignInOrganization } from './membershipChoice.js';

const acme = { organizationId: 'acme', usable: true };
const spirit = { organizationId: 'spirit', usable: true };
const suspended = { organizationId: 'old-co', usable: false };

describe('chooseSignInOrganization', () => {
  it('opens the only membership, even when its organization is unavailable', () => {
    expect(chooseSignInOrganization([suspended], {})).toEqual({
      kind: 'open',
      organizationId: 'old-co',
      reason: 'only',
    });
  });

  it('asks when there is no default and nothing used before', () => {
    expect(chooseSignInOrganization([acme, spirit], {})).toEqual({ kind: 'ask' });
  });

  it('opens the default organization first', () => {
    expect(
      chooseSignInOrganization([acme, spirit], {
        defaultOrganizationId: 'spirit',
        lastOrganizationId: 'acme',
      })
    ).toEqual({ kind: 'open', organizationId: 'spirit', reason: 'default' });
  });

  it('falls back to the last used organization when the default is unavailable', () => {
    expect(
      chooseSignInOrganization([acme, suspended], {
        defaultOrganizationId: 'old-co',
        lastOrganizationId: 'acme',
      })
    ).toEqual({ kind: 'open', organizationId: 'acme', reason: 'last_used' });
  });

  it('ignores a preference for an organization the person no longer belongs to', () => {
    expect(
      chooseSignInOrganization([acme, spirit], { defaultOrganizationId: 'left-long-ago' })
    ).toEqual({ kind: 'ask' });
  });

  it('asks when both the default and the last used are unavailable', () => {
    expect(
      chooseSignInOrganization([acme, suspended], {
        defaultOrganizationId: 'old-co',
        lastOrganizationId: 'old-co',
      })
    ).toEqual({ kind: 'ask' });
  });
});
