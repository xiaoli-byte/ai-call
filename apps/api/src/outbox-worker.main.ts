import { config } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { OutboxWorkerModule } from './outbox-worker.module.js';

config({ path: resolve(process.cwd(), '..', '..', '.env') });
process.env.OUTBOX_WORKER_ENABLED = 'true';

async function bootstrap() {
  await NestFactory.createApplicationContext(OutboxWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
}

void bootstrap();
