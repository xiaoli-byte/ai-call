import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAMPAIGN_RESOURCE_TYPE,
  campaignGrantWhere,
  campaignVisibilityWhere,
} from './campaign-acl.js';

describe('campaignGrantWhere', () => {
  it('matches USER and ROLE subject types for the campaign resource', () => {
    const where = campaignGrantWhere({ userId: 'u1', roles: ['operator', 'viewer'] });
    assert.equal(where.resourceType, CAMPAIGN_RESOURCE_TYPE);
    assert.deepEqual(where.OR, [
      { subjectType: 'USER', subjectId: 'u1' },
      { subjectType: 'ROLE', subjectId: { in: ['operator', 'viewer'] } },
    ]);
  });

  it('falls back to an unmatchable clause when neither userId nor roles are present', () => {
    const where = campaignGrantWhere({ roles: [] });
    assert.deepEqual(where.OR, [{ subjectId: '__none__' }]);
  });
});

describe('campaignVisibilityWhere', () => {
  it('admin/super_admin get no restriction', () => {
    assert.deepEqual(campaignVisibilityWhere({ userId: 'u1', roles: ['admin'] }, []), {});
    assert.deepEqual(campaignVisibilityWhere({ userId: 'u1', roles: ['super_admin'] }, []), {});
  });

  it('no userId (unauthenticated/system) gets no restriction', () => {
    assert.deepEqual(campaignVisibilityWhere({ roles: [] }, []), {});
  });

  it('regular user sees legacy(null owner) + own + granted campaign ids', () => {
    const where = campaignVisibilityWhere({ userId: 'u1', roles: ['operator'] }, ['c1', 'c2']);
    assert.deepEqual(where, {
      OR: [
        { ownerId: null },
        { ownerId: 'u1' },
        { id: { in: ['c1', 'c2'] } },
      ],
    });
  });

  it('omits the granted-ids clause when there are no grants', () => {
    const where = campaignVisibilityWhere({ userId: 'u1', roles: ['operator'] }, []);
    assert.deepEqual(where, {
      OR: [{ ownerId: null }, { ownerId: 'u1' }],
    });
  });
});
