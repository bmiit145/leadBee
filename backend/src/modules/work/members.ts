import { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';

/**
 * The people a task or meeting is given to must be active members of this
 * organization. The lookup is tenant-scoped, so an id from another tenant is
 * simply not found — and a deactivated member would otherwise collect work
 * nobody sees.
 */
export async function assertActiveMembers(ids: string[]): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !Types.ObjectId.isValid(id))) {
    throw AppError.badRequest('Every assignee must be an active member of this organization');
  }
  const found = await User.countDocuments({ _id: { $in: unique }, isActive: true });
  if (found !== unique.length) {
    throw AppError.badRequest('Every assignee must be an active member of this organization');
  }
  return unique.map((id) => new Types.ObjectId(id));
}
