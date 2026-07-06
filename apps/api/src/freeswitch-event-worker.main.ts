import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { FreeSwitchEventWorkerModule } from './freeswitch-event-worker.module.js';

config({ path: resolve(process.cwd(), '..', '..', '.env') });
process.env.FREESWITCH_EVENT_WORKER_ENABLED ??= 'true';
process.env.OUTBOX_WORKER_ENABLED ??= 'false';
process.env.TASK_SCHEDULER_ENABLED ??= 'false';
process.env.INTERNAL_API_BASE_URL ??= process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
process.env.API_BASE_URL ??= process.env.INTERNAL_API_BASE_URL;

async function bootstrap() {
  await NestFactory.createApplicationContext(FreeSwitchEventWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const logger = new Logger('FreeSwitchEventWorker');
  logger.log('application context started; provider event bridge is ready');
  logger.warn('FreeSWITCH ESL event subscription is TODO and not running in this skeleton');
}

void bootstrap();
