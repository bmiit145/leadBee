import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { changedFields } from './changedFields.js';

describe('changedFields', () => {
  it('reports only the fields that changed', () => {
    expect(
      changedFields(
        { name: 'Asha', role: 'user', designation: 'Sales' },
        { name: 'Asha', role: 'manager', designation: 'Sales' }
      )
    ).toEqual({ before: { role: 'user' }, after: { role: 'manager' } });
  });

  it('returns null when nothing changed', () => {
    expect(changedFields({ role: 'user', permissions: ['leads.view'] }, { role: 'user', permissions: ['leads.view'] })).toBeNull();
  });

  it('compares ObjectIds and arrays by content, not identity', () => {
    const id = '6aa3fa1254c286f3de41840a';
    expect(
      changedFields(
        { roleId: new Types.ObjectId(id), permissions: ['a', 'b'] },
        { roleId: new Types.ObjectId(id), permissions: ['a', 'b'] }
      )
    ).toBeNull();
  });

  it('treats a field present on one side only as a change to or from null', () => {
    expect(changedFields({ designation: 'Sales' }, {})).toEqual({
      before: { designation: 'Sales' },
      after: { designation: null },
    });
  });
});
