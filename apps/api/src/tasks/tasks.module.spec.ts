import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { OutboxWorkerModule } from '../outbox-worker.module.js';
import { OutboxModule } from './outbox.module.js';
import { TaskSchedulerService } from './task-scheduler.service.js';
import { TasksModule } from './tasks.module.js';
import { TasksService } from './tasks.service.js';

function moduleMetadata<T>(key: string, target: Function): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('task runtime module wiring', () => {
  it('does not start outbox or scheduler loops from the API TasksModule', () => {
    const imports = moduleMetadata<Function>(MODULE_METADATA.IMPORTS, TasksModule);
    const providers = moduleMetadata<Function>(MODULE_METADATA.PROVIDERS, TasksModule);

    assert.equal(imports.includes(OutboxModule), false);
    assert.equal(providers.includes(TaskSchedulerService), false);
  });

  it('exports TasksService for the standalone worker scheduler', () => {
    const exports = moduleMetadata<Function>(MODULE_METADATA.EXPORTS, TasksModule);

    assert.ok(exports.includes(TasksService));
  });

  it('runs both outbox delivery and scheduled dispatch from the standalone worker module', () => {
    const imports = moduleMetadata<Function>(MODULE_METADATA.IMPORTS, OutboxWorkerModule);
    const providers = moduleMetadata<Function>(MODULE_METADATA.PROVIDERS, OutboxWorkerModule);

    assert.ok(imports.includes(OutboxModule));
    assert.ok(imports.includes(TasksModule));
    assert.ok(providers.includes(TaskSchedulerService));
  });
});
