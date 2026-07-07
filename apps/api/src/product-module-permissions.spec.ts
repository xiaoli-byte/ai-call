import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from '@ai-call/shared';
import { PERMISSIONS_KEY } from './auth/decorators/permissions.decorator.js';
import { HandoffsController } from './handoffs/handoffs.controller.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { ScenarioTestsController } from './scenario-tests/scenario-tests.controller.js';

function assertPermissions(target: object | Function, expected: unknown[]) {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, target), expected);
}

describe('product module permission metadata', () => {
  it('keeps integration endpoints under task permissions', () => {
    assertPermissions(IntegrationsController, [PERMISSIONS.TASK_READ]);
    assertPermissions(IntegrationsController.prototype.create, [PERMISSIONS.TASK_UPDATE]);
    assertPermissions(IntegrationsController.prototype.test, [PERMISSIONS.TASK_UPDATE]);
  });

  it('keeps handoff endpoints under call and task permissions', () => {
    assertPermissions(HandoffsController, [PERMISSIONS.CALL_READ]);
    assertPermissions(HandoffsController.prototype.createFromAnalysis, [PERMISSIONS.CALL_READ]);
    assertPermissions(HandoffsController.prototype.update, [PERMISSIONS.TASK_UPDATE]);
    assertPermissions(HandoffsController.prototype.createCallback, [PERMISSIONS.TASK_CREATE]);
  });

  it('keeps scenario test endpoints under flow permissions', () => {
    assertPermissions(ScenarioTestsController, [PERMISSIONS.FLOW_READ]);
    assertPermissions(ScenarioTestsController.prototype.run, [PERMISSIONS.FLOW_UPDATE]);
  });
});
