import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { IS_PUBLIC_KEY } from './auth/decorators/public.decorator.js';
import { ServiceAuthGuard } from './common/service-auth.guard.js';
import { KnowledgeBaseController } from './knowledge-base/knowledge-base.controller.js';
import { ToolsController } from './tools/tools.controller.js';

function guardList(target: object | Function): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
}

describe('internal service endpoints', () => {
  it('keeps tool endpoints public to user JWT while requiring service token auth', () => {
    assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, ToolsController), true);
    assert.ok(guardList(ToolsController).includes(ServiceAuthGuard));
  });

  it('keeps knowledge retrieval public to user JWT while requiring service token auth', () => {
    const retrieveHandler = KnowledgeBaseController.prototype.retrieve;

    assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, retrieveHandler), true);
    assert.ok(guardList(retrieveHandler).includes(ServiceAuthGuard));
  });
});
