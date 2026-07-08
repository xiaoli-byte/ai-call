import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TASK_ACL_BYPASS_ROLES,
  TASK_RESOURCE_TYPE,
  hasViewPerm,
  isTaskAclBypass,
  taskGrantWhere,
  taskVisibilityWhere,
} from './task-acl.js';

describe('isTaskAclBypass', () => {
  it('bypasses for admin', () => {
    assert.equal(isTaskAclBypass(['operator', 'admin']), true);
  });

  it('bypasses for super_admin', () => {
    assert.equal(isTaskAclBypass(['super_admin']), true);
  });

  it('does not bypass for operator/viewer', () => {
    assert.equal(isTaskAclBypass(['operator']), false);
    assert.equal(isTaskAclBypass(['viewer']), false);
    assert.equal(isTaskAclBypass([]), false);
  });

  it('bypass role list is exactly admin + super_admin', () => {
    assert.deepEqual([...TASK_ACL_BYPASS_ROLES].sort(), ['admin', 'super_admin']);
  });
});

describe('hasViewPerm', () => {
  it('detects VIEW bit (1) set alone or combined', () => {
    assert.equal(hasViewPerm(1), true); // VIEW only
    assert.equal(hasViewPerm(1 | 4), true); // VIEW + EDIT
    assert.equal(hasViewPerm(4), false); // EDIT only, no VIEW
    assert.equal(hasViewPerm(0), false);
  });
});

describe('taskGrantWhere', () => {
  it('matches USER and ROLE subject types for the call_task resource', () => {
    const where = taskGrantWhere({ userId: 'u1', roles: ['operator', 'viewer'] });
    assert.equal(where.resourceType, TASK_RESOURCE_TYPE);
    assert.deepEqual(where.OR, [
      { subjectType: 'USER', subjectId: 'u1' },
      { subjectType: 'ROLE', subjectId: { in: ['operator', 'viewer'] } },
    ]);
  });

  it('omits the ROLE clause when roles is empty', () => {
    const where = taskGrantWhere({ userId: 'u1', roles: [] });
    assert.deepEqual(where.OR, [{ subjectType: 'USER', subjectId: 'u1' }]);
  });

  it('falls back to an unmatchable clause when neither userId nor roles are present', () => {
    const where = taskGrantWhere({ roles: [] });
    assert.deepEqual(where.OR, [{ subjectId: '__none__' }]);
  });
});

describe('taskVisibilityWhere', () => {
  it('admin/super_admin get no restriction', () => {
    assert.deepEqual(taskVisibilityWhere({ userId: 'u1', roles: ['admin'] }, []), {});
    assert.deepEqual(taskVisibilityWhere({ userId: 'u1', roles: ['super_admin'] }, []), {});
  });

  it('no userId (unauthenticated/system) gets no restriction', () => {
    assert.deepEqual(taskVisibilityWhere({ roles: [] }, []), {});
  });

  it('regular user sees legacy(null owner) + own + granted task ids', () => {
    const where = taskVisibilityWhere({ userId: 'u1', roles: ['operator'] }, ['t1', 't2']);
    assert.deepEqual(where, {
      OR: [
        { ownerId: null },
        { ownerId: 'u1' },
        { id: { in: ['t1', 't2'] } },
      ],
    });
  });

  it('omits the granted-ids clause when there are no grants', () => {
    const where = taskVisibilityWhere({ userId: 'u1', roles: ['operator'] }, []);
    assert.deepEqual(where, {
      OR: [{ ownerId: null }, { ownerId: 'u1' }],
    });
  });
});
