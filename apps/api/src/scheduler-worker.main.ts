import { config } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SchedulerWorkerModule } from './scheduler-worker.module.js';

config({ path: resolve(process.cwd(), '..', '..', '.env') });
process.env.TASK_SCHEDULER_ENABLED ??= 'true';
process.env.OUTBOX_WORKER_ENABLED ??= 'false';

async function bootstrap() {
  await NestFactory.createApplicationContext(SchedulerWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
}

void bootstrap();
