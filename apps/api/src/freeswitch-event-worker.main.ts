import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { FreeSwitchEventWorkerModule } from './freeswitch-event-worker.module.js';

config({ path: resolve(process.cwd(), '..', '..', '.env') });
process.env.FREESWITCH_EVENT_WORKER_ENABLED ??= 'true';
process.env.OUTBOX_WORKER_ENABLED ??= 'false';
process.env.TASK_SCHEDULER_ENABLED ??= 'false';
process.env.INTERNAL_API_BASE_URL ??=
  process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api';
process.env.API_BASE_URL ??= process.env.INTERNAL_API_BASE_URL;

async function bootstrap(): Promise<void> {
  if (
    process.env.NODE_ENV === 'production'
    && !process.env.SERVICE_API_TOKEN
  ) {
    throw new Error('SERVICE_API_TOKEN is required for the event worker');
  }

  const app = await NestFactory.create(FreeSwitchEventWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  const host = process.env.FREESWITCH_EVENT_HEALTH_HOST ?? '127.0.0.1';
  const port = Number(process.env.FREESWITCH_EVENT_HEALTH_PORT ?? 3012);
  await app.listen(port, host);
  new Logger('FreeSwitchEventWorker').log(
    'health server listening on http://' + host + ':' + port,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  new Logger('FreeSwitchEventWorker').error(
    'event worker bootstrap failed: ' + message,
  );
  process.exitCode = 1;
});
