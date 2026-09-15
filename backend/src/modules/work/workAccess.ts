/**
 * Who may do what with a lead, a task or a meeting, inside one organization.
 *
 * Cross-tenant isolation is not decided here — the tenant plugin has already
 * made another organization's rows unreachable. This is the within-tenant rule,
 * kept pure so it is one tested place rather than a check re-derived in each
 * service:
 *
 * | Who | Lead | Task / meeting: open, comment, status, checklist | Edit / delete |
 * | --- | --- | --- | --- |
 * | Organizer | every lead | everything | everything |
 * | Creator | their leads | theirs | theirs |
 * | Assignee / attendee | leads assigned to them | theirs | status only (tasks); reschedule (meetings) |
 * | Owner of the linked lead | — | work on their lead | — |
 */

type IdLike = { toString(): string } | string;

/** A populated reference is a document; an unpopulated one is an id. Both compare by id. */
function idOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && '_id' in (value as Record<string, unknown>)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

export interface Actor {
  userId: IdLike;
  isOrganizer: boolean;
}

export interface OwnedLead {
  assignedTo?: unknown;
  createdBy?: unknown;
}

export interface WorkItem {
  createdBy?: unknown;
  assignedTo?: unknown[] | null;
}

const isSelf = (value: unknown, actor: Actor) => idOf(value) === idOf(actor.userId);

export function canSeeLead(lead: OwnedLead, actor: Actor): boolean {
  return actor.isOrganizer || isSelf(lead.assignedTo, actor) || isSelf(lead.createdBy, actor);
}

export function isCreator(item: WorkItem, actor: Actor): boolean {
  return isSelf(item.createdBy, actor);
}

export function isAssignee(item: WorkItem, actor: Actor): boolean {
  return (item.assignedTo ?? []).some((id) => isSelf(id, actor));
}

/**
 * Open it, comment, move its status, tick its checklist. `leadVisible` is
 * whether the actor can see the lead it belongs to: the owner of a lead works
 * everything on it, whoever the task was given to.
 */
export function canWorkOn(item: WorkItem, actor: Actor, leadVisible = false): boolean {
  return actor.isOrganizer || isCreator(item, actor) || isAssignee(item, actor) || leadVisible;
}

/** Change what it is, or delete it. */
export function canManage(item: WorkItem, actor: Actor): boolean {
  return actor.isOrganizer || isCreator(item, actor);
}
