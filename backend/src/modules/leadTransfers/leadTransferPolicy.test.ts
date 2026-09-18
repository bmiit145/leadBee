import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AppError } from '../../lib/errors.js';
import {
  TRANSFER_ERROR,
  TRANSFER_EXPIRY_DAYS,
  assertMayRequestTransfer,
  effectiveStatus,
  expiryFrom,
  mayDecideTransfer,
  mayViewTransfer,
} from './leadTransferPolicy.js';

const OWNER = new Types.ObjectId();
const RECIPIENT = new Types.ObjectId();
const BYSTANDER = new Types.ObjectId();
const ORGANIZER = new Types.ObjectId();

const agent = (userId: Types.ObjectId) => ({ userId, isOrganizer: false });
const organizer = { userId: ORGANIZER, isOrganizer: true };

/** A request the owner made themselves. */
const request = { fromUser: OWNER, toUser: RECIPIENT, requestedBy: OWNER };

function codeOf(run: () => void): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    const app = error as AppError;
    return { status: app.statusCode, code: app.code };
  }
  throw new Error('expected the call to throw');
}

describe('assertMayRequestTransfer', () => {
  it('lets the owner hand their lead on', () => {
    expect(() =>
      assertMayRequestTransfer({ assignedTo: OWNER }, RECIPIENT.toString(), agent(OWNER))
    ).not.toThrow();
  });

  it('lets an organizer transfer a lead they do not own', () => {
    expect(() =>
      assertMayRequestTransfer({ assignedTo: OWNER }, RECIPIENT.toString(), organizer)
    ).not.toThrow();
  });

  it('refuses anyone else with 403 — including the lead’s creator once it is reassigned', () => {
    expect(
      codeOf(() =>
        assertMayRequestTransfer({ assignedTo: OWNER }, RECIPIENT.toString(), agent(BYSTANDER))
      ).status
    ).toBe(403);
  });

  it('refuses a transfer to the current owner with a stable code', () => {
    expect(
      codeOf(() =>
        assertMayRequestTransfer({ assignedTo: OWNER }, OWNER.toString(), organizer)
      )
    ).toEqual({ status: 422, code: TRANSFER_ERROR.INVALID_RECIPIENT });
  });

  it('compares a populated owner by id', () => {
    expect(() =>
      assertMayRequestTransfer(
        { assignedTo: { _id: OWNER, name: 'Asha' } },
        RECIPIENT.toString(),
        agent(OWNER)
      )
    ).not.toThrow();
  });
});

describe('mayDecideTransfer', () => {
  it('gives accept and decline to the recipient only', () => {
    expect(mayDecideTransfer(request, 'accept', agent(RECIPIENT))).toBe(true);
    expect(mayDecideTransfer(request, 'decline', agent(RECIPIENT))).toBe(true);
  });

  it('does not let the sender accept on the recipient’s behalf', () => {
    expect(mayDecideTransfer(request, 'accept', agent(OWNER))).toBe(false);
    expect(mayDecideTransfer(request, 'decline', agent(OWNER))).toBe(false);
  });

  it('gives withdrawing to the sender, not the recipient', () => {
    expect(mayDecideTransfer(request, 'cancel', agent(OWNER))).toBe(true);
    expect(mayDecideTransfer(request, 'cancel', agent(RECIPIENT))).toBe(false);
  });

  it('lets the owner withdraw a request an organizer made for them', () => {
    const onBehalf = { ...request, requestedBy: ORGANIZER };
    expect(mayDecideTransfer(onBehalf, 'cancel', agent(OWNER))).toBe(true);
  });

  it('gives an organizer every decision', () => {
    for (const decision of ['accept', 'decline', 'cancel'] as const) {
      expect(mayDecideTransfer(request, decision, organizer)).toBe(true);
    }
  });

  it('gives a bystander none', () => {
    for (const decision of ['accept', 'decline', 'cancel'] as const) {
      expect(mayDecideTransfer(request, decision, agent(BYSTANDER))).toBe(false);
    }
  });
});

describe('mayViewTransfer', () => {
  it('shows a request to its parties and organizers only', () => {
    expect(mayViewTransfer(request, agent(OWNER))).toBe(true);
    expect(mayViewTransfer(request, agent(RECIPIENT))).toBe(true);
    expect(mayViewTransfer(request, organizer)).toBe(true);
    expect(mayViewTransfer(request, agent(BYSTANDER))).toBe(false);
  });
});

describe('effectiveStatus', () => {
  const now = new Date('2026-09-18T10:00:00Z');

  it('reads a lapsed pending request as expired before anything sweeps it', () => {
    expect(effectiveStatus({ status: 'pending', expiresAt: now }, now)).toBe('expired');
  });

  it('leaves an unexpired pending request pending', () => {
    const later = new Date(now.getTime() + 1);
    expect(effectiveStatus({ status: 'pending', expiresAt: later }, now)).toBe('pending');
  });

  it('never rewrites a decided request, however old', () => {
    const past = new Date(now.getTime() - 1);
    expect(effectiveStatus({ status: 'accepted', expiresAt: past }, now)).toBe('accepted');
    expect(effectiveStatus({ status: 'declined', expiresAt: past }, now)).toBe('declined');
  });
});

describe('expiryFrom', () => {
  it(`lapses a request ${TRANSFER_EXPIRY_DAYS} days after it is made`, () => {
    const now = new Date('2026-09-18T10:00:00Z');
    expect(expiryFrom(now).toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });
});
