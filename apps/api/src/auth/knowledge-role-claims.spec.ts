import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import {
  KNOWN_CROSS_SYSTEM_ROLES,
  resolveKnowledgeRoleClaims,
} from './knowledge-role-claims.js';

describe('resolveKnowledgeRoleClaims', () => {
  it('uses the shared mapping for ai-call operator → ai-knowledge editor', () => {
    assert.deepEqual(resolveKnowledgeRoleClaims(['operator', 'viewer']), ['editor']);
  });

  it('selects the highest mapped role', () => {
    assert.deepEqual(resolveKnowledgeRoleClaims(['viewer', 'tenant_admin']), ['admin']);
  });

  it('rejects unknown cross-system roles instead of silently downgrading', () => {
    assert.throws(
      () => resolveKnowledgeRoleClaims(['operator', 'auditor']),
      ForbiddenException,
    );
  });

  it('keeps the shared vocabulary observable for diagnostics', () => {
    assert.equal(KNOWN_CROSS_SYSTEM_ROLES.has('operator'), true);
    assert.equal(KNOWN_CROSS_SYSTEM_ROLES.has('editor'), true);
  });
});
