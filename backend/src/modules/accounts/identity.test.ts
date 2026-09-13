import { describe, expect, it } from 'vitest';
import {
  identifierKind,
  joinName,
  resolveIdentity,
  splitName,
  type IdentityCandidate,
} from './identity.js';

const real = (id: string): IdentityCandidate => ({ id, disposable: false });
const pending = (id: string): IdentityCandidate => ({ id, disposable: true });

describe('resolveIdentity', () => {
  it('treats an email and mobile nobody holds as a new person', () => {
    expect(resolveIdentity(null, null)).toEqual({ kind: 'new', supersede: [] });
  });

  it('recognises the same person when one account holds both', () => {
    expect(resolveIdentity(real('a'), real('a'))).toEqual({
      kind: 'existing',
      accountId: 'a',
      disposable: false,
    });
  });

  it('reports when that one account is only an unconfirmed registration', () => {
    expect(resolveIdentity(pending('a'), pending('a'))).toEqual({
      kind: 'existing',
      accountId: 'a',
      disposable: true,
    });
  });

  it('refuses an email already tied to a different mobile', () => {
    expect(resolveIdentity(real('a'), null)).toEqual({ kind: 'conflict', reason: 'EMAIL_IN_USE' });
  });

  it('refuses a mobile already tied to a different email', () => {
    expect(resolveIdentity(null, real('b'))).toEqual({ kind: 'conflict', reason: 'PHONE_IN_USE' });
  });

  it('refuses an email and a mobile that belong to two different people', () => {
    expect(resolveIdentity(real('a'), real('b'))).toEqual({
      kind: 'conflict',
      reason: 'IDENTITY_CONFLICT',
    });
  });

  it('lets a real person take identifiers held only by an unconfirmed registration', () => {
    expect(resolveIdentity(pending('a'), null)).toEqual({ kind: 'new', supersede: ['a'] });
    expect(resolveIdentity(pending('a'), pending('b'))).toEqual({
      kind: 'new',
      supersede: ['a', 'b'],
    });
  });

  it('never lets an unconfirmed registration outweigh a real account', () => {
    expect(resolveIdentity(real('a'), pending('b'))).toEqual({
      kind: 'conflict',
      reason: 'EMAIL_IN_USE',
    });
    expect(resolveIdentity(pending('a'), real('b'))).toEqual({
      kind: 'conflict',
      reason: 'PHONE_IN_USE',
    });
  });
});

describe('splitName / joinName', () => {
  it('splits on the first word', () => {
    expect(splitName('Asha Mehta')).toEqual({ firstName: 'Asha', lastName: 'Mehta' });
    expect(splitName('  Priya   Kumar  Shah ')).toEqual({
      firstName: 'Priya',
      lastName: 'Kumar Shah',
    });
  });

  it('leaves the last name empty for a single word rather than inventing one', () => {
    expect(splitName('Madhuri')).toEqual({ firstName: 'Madhuri', lastName: '' });
  });

  it('joins without stray spaces', () => {
    expect(joinName('Priya', '')).toBe('Priya');
    expect(joinName('Priya', 'Kumar Shah')).toBe('Priya Kumar Shah');
  });
});

describe('identifierKind', () => {
  it('reads an @ as an email and anything else as a mobile number', () => {
    expect(identifierKind('owner@acme.test')).toBe('email');
    expect(identifierKind('+91 90000 00001')).toBe('phone');
  });
});
