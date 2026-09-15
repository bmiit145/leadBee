import { describe, expect, it } from 'vitest';
import { canManage, canSeeLead, canWorkOn, isAssignee } from './workAccess.js';

const organizer = { userId: 'org', isOrganizer: true };
const creator = { userId: 'creator', isOrganizer: false };
const assignee = { userId: 'assignee', isOrganizer: false };
const stranger = { userId: 'stranger', isOrganizer: false };

const task = { createdBy: 'creator', assignedTo: ['assignee'] };

describe('workAccess', () => {
  it('lets organizers see every lead, agents only their own', () => {
    const lead = { assignedTo: 'assignee', createdBy: 'creator' };
    expect(canSeeLead(lead, organizer)).toBe(true);
    expect(canSeeLead(lead, creator)).toBe(true);
    expect(canSeeLead(lead, assignee)).toBe(true);
    expect(canSeeLead(lead, stranger)).toBe(false);
  });

  it('lets participants work on an item, and nobody else', () => {
    expect(canWorkOn(task, organizer)).toBe(true);
    expect(canWorkOn(task, creator)).toBe(true);
    expect(canWorkOn(task, assignee)).toBe(true);
    expect(canWorkOn(task, stranger)).toBe(false);
  });

  it('lets the owner of the linked lead work on it', () => {
    expect(canWorkOn(task, stranger, true)).toBe(true);
  });

  it('keeps editing and deleting to the creator and organizers', () => {
    expect(canManage(task, organizer)).toBe(true);
    expect(canManage(task, creator)).toBe(true);
    expect(canManage(task, assignee)).toBe(false);
  });

  it('compares populated references by id', () => {
    const populated = { createdBy: { _id: 'creator', name: 'C' }, assignedTo: [{ _id: 'assignee' }] };
    expect(isAssignee(populated, assignee)).toBe(true);
    expect(canManage(populated, creator)).toBe(true);
  });
});
