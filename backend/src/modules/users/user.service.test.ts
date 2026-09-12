import { describe, expect, it } from 'vitest';
import { roleRank, userPolicy, type UserManager } from './user.service.js';

const actor = (role: string, permissions: string[] = ['users.manage']): UserManager => ({
  userId: 'actor',
  role,
  permissions,
});

function denies(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode === 403;
  }
}

describe('userPolicy.assertCanManage', () => {
  it('lets a manager manage users at or below their own rank', () => {
    for (const role of ['user', 'partner', 'manager']) {
      expect(denies(() => userPolicy.assertCanManage(actor('manager'), { role }))).toBe(false);
    }
  });

  it('refuses a manager acting on an admin or owner', () => {
    expect(denies(() => userPolicy.assertCanManage(actor('manager'), { role: 'admin' }))).toBe(true);
    expect(denies(() => userPolicy.assertCanManage(actor('manager'), { role: 'owner' }))).toBe(true);
  });

  it('refuses an admin acting on the owner, even holding every permission', () => {
    expect(denies(() => userPolicy.assertCanManage(actor('admin', ['*']), { role: 'owner' }))).toBe(true);
  });

  it('lets an owner manage another owner', () => {
    expect(denies(() => userPolicy.assertCanManage(actor('owner', ['*']), { role: 'owner' }))).toBe(false);
  });

  it('fails closed for a caller whose role is not recognised', () => {
    expect(roleRank('site_head')).toBe(-1);
    expect(denies(() => userPolicy.assertCanManage(actor('site_head'), { role: 'user' }))).toBe(true);
  });
});

describe('userPolicy.assertCanAssignRole', () => {
  it('allows a role up to the caller’s own', () => {
    expect(denies(() => userPolicy.assertCanAssignRole(actor('manager'), 'manager'))).toBe(false);
  });

  it('refuses promotion above the caller', () => {
    expect(denies(() => userPolicy.assertCanAssignRole(actor('manager'), 'admin'))).toBe(true);
    expect(denies(() => userPolicy.assertCanAssignRole(actor('admin', ['*']), 'owner'))).toBe(true);
  });

  it('refuses a role that does not exist', () => {
    expect(denies(() => userPolicy.assertCanAssignRole(actor('owner', ['*']), 'superadmin'))).toBe(true);
  });
});

describe('userPolicy.assertCanGrant', () => {
  it('lets a holder of * grant anything', () => {
    expect(denies(() => userPolicy.assertCanGrant(actor('admin', ['*']), ['*', 'roles.manage']))).toBe(false);
  });

  it('lets a caller hand on permissions they hold', () => {
    const manager = actor('manager', ['users.manage', 'leads.view']);
    expect(denies(() => userPolicy.assertCanGrant(manager, ['leads.view']))).toBe(false);
  });

  it('refuses granting * or anything the caller lacks', () => {
    const manager = actor('manager', ['users.manage', 'leads.view']);
    expect(denies(() => userPolicy.assertCanGrant(manager, ['*']))).toBe(true);
    expect(denies(() => userPolicy.assertCanGrant(manager, ['leads.view', 'roles.manage']))).toBe(true);
  });
});

describe('userPolicy.assertNotSelf', () => {
  it('refuses the caller’s own account and allows anyone else', () => {
    const owner = actor('owner', ['*']);
    expect(denies(() => userPolicy.assertNotSelf(owner, 'actor', 'reset the password of'))).toBe(true);
    expect(denies(() => userPolicy.assertNotSelf(owner, 'someone-else', 'reset the password of'))).toBe(false);
  });
});
