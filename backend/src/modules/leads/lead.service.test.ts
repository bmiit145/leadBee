import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { leadService, type Viewer } from './lead.service.js';
import { AppError } from '../../lib/errors.js';

const AGENT_ID = new Types.ObjectId();
const COLLEAGUE_ID = new Types.ObjectId();

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: AGENT_ID,
    isOrganizer: false,
    name: 'Asha',
    role: 'user',
    ...overrides,
  };
}

/**
 * The check runs in the route *before* the plan-limit check, so these cases are
 * what keeps a 403 from being reported as a 402. See docs/KNOWN-GAPS.md 2.2.
 */
describe('leadService.assertMayAssignOnCreate', () => {
  it('allows a create with no assignee — the lead falls to its creator', () => {
    expect(() => leadService.assertMayAssignOnCreate(undefined, viewer())).not.toThrow();
  });

  it('allows an agent to assign a lead to themselves', () => {
    expect(() =>
      leadService.assertMayAssignOnCreate(AGENT_ID.toString(), viewer())
    ).not.toThrow();
  });

  it('refuses an agent handing a new lead to a colleague', () => {
    expect(() =>
      leadService.assertMayAssignOnCreate(COLLEAGUE_ID.toString(), viewer())
    ).toThrow(AppError);
  });

  it('refuses with 403, not a plan-limit code', () => {
    try {
      leadService.assertMayAssignOnCreate(COLLEAGUE_ID.toString(), viewer());
      expect.unreachable('expected the assignment to be refused');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(403);
    }
  });

  it('allows an organizer to assign a lead to someone else', () => {
    expect(() =>
      leadService.assertMayAssignOnCreate(
        COLLEAGUE_ID.toString(),
        viewer({ isOrganizer: true, role: 'manager' })
      )
    ).not.toThrow();
  });
});
