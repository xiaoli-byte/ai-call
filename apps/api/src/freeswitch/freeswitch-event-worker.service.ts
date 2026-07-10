import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';
import { MetricsService } from '../metrics/metrics.service.js';
import {
  EslFrameParser,
  getEslHeader,
  parsePlainEventPayload,
  type EslFrame,
} from './esl-frame-parser.js';
import {
  FreeSwitchBridgeError,
  FreeSwitchEventBridgeService,
} from './freeswitch-event-bridge.service.js';
import { parseFreeSwitchEvent } from './freeswitch-event-parser.js';
import { FreeSwitchService } from './freeswitch.service.js';

type WorkerState =
  | 'idle'
  | 'disabled'
  | 'connecting'
  | 'auth-request'
  | 'auth-reply'
  | 'subscribe-reply'
  | 'subscribed'
  | 'stopped';

type QueuedEvent = {
  event: ProviderCallEventDto;
  attempts: number;
};

export type FreeSwitchEventWorkerHealth = {
  live: boolean;
  ready: boolean;
  state: WorkerState;
  queueDepth: number;
  reconnectCount: number;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  lastErrorCode?: string;
};

const SUBSCRIPTIONS = [
  'HEARTBEAT',
  'BACKGROUND_JOB',
  'CHANNEL_PROGRESS',
  'CHANNEL_PROGRESS_MEDIA',
  'CHANNEL_ANSWER',
  'CHANNEL_HANGUP_COMPLETE',
  'RECORD_STOP',
] as const;

@Injectable()
export class FreeSwitchEventWorkerService
implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FreeSwitchEventWorkerService.name);
  private readonly host = process.env.FREESWITCH_ESL_HOST ?? 'localhost';
  private readonly port = boundedInt(
    process.env.FREESWITCH_ESL_PORT,
    8021,
    1,
    65_535,
  );
  private readonly password = process.env.FREESWITCH_ESL_PASSWORD ?? 'ClueCon';
  private readonly enabled =
    process.env.FREESWITCH_EVENT_WORKER_ENABLED !== 'false';
  private readonly heartbeatStaleMs = boundedInt(
    process.env.FREESWITCH_EVENT_HEARTBEAT_STALE_MS,
    60_000,
    5_000,
    300_000,
  );
  private readonly reconnectMinMs = boundedInt(
    process.env.FREESWITCH_EVENT_RECONNECT_MIN_MS,
    500,
    100,
    60_000,
  );
  private readonly reconnectMaxMs = boundedInt(
    process.env.FREESWITCH_EVENT_RECONNECT_MAX_MS,
    30_000,
    this.reconnectMinMs,
    300_000,
  );
  private readonly deliveryMaxAttempts = boundedInt(
    process.env.FREESWITCH_EVENT_DELIVERY_MAX_ATTEMPTS,
    8,
    1,
    100,
  );
  private readonly deliveryBaseDelayMs = boundedInt(
    process.env.FREESWITCH_EVENT_DELIVERY_BASE_DELAY_MS,
    250,
    10,
    60_000,
  );
  private readonly maxQueueSize = boundedInt(
    process.env.FREESWITCH_EVENT_QUEUE_SIZE,
    1_000,
    1,
    100_000,
  );
  private readonly snapshotIntervalMs = boundedInt(
    process.env.FREESWITCH_ACTIVE_SNAPSHOT_INTERVAL_MS,
    10_000,
    1_000,
    300_000,
  );

  private state: WorkerState = 'idle';
  private socket?: Socket;
  private parser?: EslFrameParser;
  private reconnectTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectCount = 0;
  private lastHeartbeatAt?: number;
  private lastEventAt?: number;
  private lastErrorCode?: string;
  private deliveryHealthy = true;
  private queue: QueuedEvent[] = [];
  private draining = false;

  constructor(
    private readonly bridge: FreeSwitchEventBridgeService,
    private readonly freeswitch: FreeSwitchService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.state = 'disabled';
      return;
    }
    this.connect();
    this.snapshotTimer = setInterval(
      () => void this.publishActiveSnapshot(),
      this.snapshotIntervalMs,
    );
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.state = 'stopped';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.reconnectTimer = undefined;
    this.snapshotTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
  }

  health(): FreeSwitchEventWorkerHealth {
    const now = Date.now();
    const heartbeatFresh = this.lastHeartbeatAt !== undefined
      && now - this.lastHeartbeatAt <= this.heartbeatStaleMs;
    return {
      live: !this.stopped,
      ready:
        this.enabled
        && this.state === 'subscribed'
        && heartbeatFresh
        && this.deliveryHealthy,
      state: this.state,
      queueDepth: this.queue.length,
      reconnectCount: this.reconnectCount,
      lastHeartbeatAt: toIso(this.lastHeartbeatAt),
      lastEventAt: toIso(this.lastEventAt),
      lastErrorCode: this.lastErrorCode,
    };
  }

  private connect(): void {
    if (this.stopped || !this.enabled || this.socket) return;
    this.state = 'connecting';
    const socket = new Socket();
    const parser = new EslFrameParser();
    this.socket = socket;
    this.parser = parser;

    socket.on('connect', () => {
      if (socket !== this.socket) return;
      this.state = 'auth-request';
      this.lastErrorCode = undefined;
    });
    socket.on('data', (chunk: Buffer) => {
      if (socket !== this.socket) return;
      try {
        for (const frame of parser.push(chunk)) this.handleFrame(frame);
      } catch {
        this.disconnect('PROTOCOL_ERROR');
      }
    });
    socket.on('error', () => this.disconnect('CONNECTION_ERROR'));
    socket.on('end', () => this.disconnect('CONNECTION_CLOSED'));
    socket.on('close', () => this.disconnect('CONNECTION_CLOSED'));

    try {
      socket.connect(this.port, this.host);
    } catch {
      this.disconnect('CONNECTION_ERROR');
    }
  }

  private handleFrame(frame: EslFrame): void {
    const contentType = getEslHeader(frame.headers, 'Content-Type')
      ?.trim()
      .toLowerCase();

    if (this.state === 'auth-request') {
      if (contentType !== 'auth/request') {
        this.disconnect('EXPECTED_AUTH_REQUEST');
        return;
      }
      this.state = 'auth-reply';
      this.write('auth ' + this.password + '\n\n');
      return;
    }

    if (this.state === 'auth-reply') {
      if (
        contentType !== 'command/reply'
        || !isOkReply(frame)
      ) {
        this.disconnect('AUTH_FAILED');
        return;
      }
      this.state = 'subscribe-reply';
      this.write('event plain ' + SUBSCRIPTIONS.join(' ') + '\n\n');
      return;
    }

    if (this.state === 'subscribe-reply') {
      if (
        contentType !== 'command/reply'
        || !isOkReply(frame)
      ) {
        this.disconnect('SUBSCRIBE_FAILED');
        return;
      }
      this.state = 'subscribed';
      this.reconnectAttempt = 0;
      this.lastHeartbeatAt = Date.now();
      this.metrics?.setGauge('freeswitch.event_worker.ready', 1);
      this.logger.log('FreeSWITCH ESL events subscribed');
      return;
    }

    if (this.state !== 'subscribed') return;
    if (contentType === 'text/disconnect-notice') {
      this.disconnect('DISCONNECT_NOTICE');
      return;
    }
    if (contentType !== 'text/event-plain') return;

    let plain;
    try {
      plain = parsePlainEventPayload(frame.body);
    } catch {
      this.lastErrorCode = 'INVALID_EVENT_FRAME';
      this.deliveryHealthy = false;
      this.metrics?.incrementCounter('freeswitch.event.invalid');
      return;
    }
    const eventName = getEslHeader(plain.headers, 'Event-Name')?.toUpperCase();
    this.lastEventAt = Date.now();
    if (eventName === 'HEARTBEAT') {
      this.lastHeartbeatAt = this.lastEventAt;
      this.metrics?.incrementCounter('freeswitch.event.heartbeat');
      return;
    }
    if (!eventName || !this.isManagedEvent(eventName, plain.headers)) return;

    try {
      const event = parseFreeSwitchEvent({
        headers: plain.headers,
        body: plain.body,
      });
      this.enqueue(event);
      this.metrics?.incrementCounter('freeswitch.event.received');
    } catch {
      this.lastErrorCode = 'EVENT_PARSE_FAILED';
      this.deliveryHealthy = false;
      this.metrics?.incrementCounter('freeswitch.event.invalid');
    }
  }

  private isManagedEvent(
    eventName: string,
    headers: Readonly<Record<string, string | readonly string[]>>,
  ): boolean {
    if (eventName === 'BACKGROUND_JOB') {
      const command = getEslHeader(headers, 'Job-Command')?.toLowerCase();
      const commandArg = getEslHeader(headers, 'Job-Command-Arg') ?? '';
      return command === 'originate'
        && /(?:^|[,{])\s*origination_uuid=[0-9a-f-]{36}(?=[,}])/i
          .test(commandArg);
    }
    return getEslHeader(headers, 'variable_ai_call_managed') === 'true'
      || Boolean(getEslHeader(headers, 'variable_attempt_id'));
  }

  private enqueue(event: ProviderCallEventDto): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.deliveryHealthy = false;
      this.lastErrorCode = 'QUEUE_OVERFLOW';
      this.metrics?.incrementCounter('freeswitch.event.queue_overflow');
      this.logger.error('FreeSWITCH event delivery queue is full');
      return;
    }
    this.queue.push({ event, attempts: 0 });
    this.metrics?.setGauge('freeswitch.event.queue_depth', this.queue.length);
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const item = this.queue[0];
        try {
          await this.bridge.postProviderEvent(item.event);
          this.queue.shift();
          this.deliveryHealthy = true;
          this.lastErrorCode = undefined;
          this.metrics?.incrementCounter('freeswitch.event.delivered');
          this.metrics?.setGauge(
            'freeswitch.event.queue_depth',
            this.queue.length,
          );
        } catch (error) {
          item.attempts += 1;
          const retryable = error instanceof FreeSwitchBridgeError
            && error.retryable;
          if (!retryable || item.attempts >= this.deliveryMaxAttempts) {
            this.queue.shift();
            this.deliveryHealthy = false;
            this.lastErrorCode = retryable
              ? 'DELIVERY_EXHAUSTED'
              : 'DELIVERY_REJECTED';
            this.metrics?.incrementCounter('freeswitch.event.delivery_failed');
            this.logger.error(
              'FreeSWITCH event delivery failed eventId='
              + (item.event.providerEventId ?? 'unknown'),
            );
            continue;
          }
          this.deliveryHealthy = false;
          this.lastErrorCode = 'DELIVERY_RETRYING';
          this.metrics?.incrementCounter('freeswitch.event.delivery_retry');
          await delay(Math.min(
            30_000,
            this.deliveryBaseDelayMs * 2 ** (item.attempts - 1),
          ));
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async publishActiveSnapshot(): Promise<void> {
    if (this.stopped || this.state !== 'subscribed') return;
    const snapshotId = randomUUID();
    const observedAt = new Date().toISOString();
    try {
      const activeChannelIds = [
        ...(await this.freeswitch.listActiveChannelIds()),
      ];
      await this.retrySnapshot({
        provider: 'freeswitch',
        snapshotId,
        observedAt,
        activeChannelIds,
      });
      this.metrics?.incrementCounter('freeswitch.snapshot.delivered');
    } catch {
      this.lastErrorCode = 'SNAPSHOT_FAILED';
      this.metrics?.incrementCounter('freeswitch.snapshot.failed');
    }
  }

  private async retrySnapshot(snapshot: {
    provider: string;
    snapshotId: string;
    observedAt: string;
    activeChannelIds: string[];
  }): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.bridge.postActiveSnapshot(snapshot);
        return;
      } catch (error) {
        if (
          !(error instanceof FreeSwitchBridgeError)
          || !error.retryable
          || attempt === 3
        ) {
          throw error;
        }
        await delay(this.deliveryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  private write(value: string): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      this.disconnect('CONNECTION_CLOSED');
      return;
    }
    try {
      socket.write(value);
    } catch {
      this.disconnect('CONNECTION_ERROR');
    }
  }

  private disconnect(code: string): void {
    if (this.stopped) return;
    this.lastErrorCode = code;
    this.metrics?.setGauge('freeswitch.event_worker.ready', 0);
    const socket = this.socket;
    this.socket = undefined;
    this.parser = undefined;
    if (socket && !socket.destroyed) socket.destroy();
    this.state = 'idle';
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.enabled) return;
    const exponential = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** this.reconnectAttempt,
    );
    const jitter = Math.floor(Math.random() * Math.max(1, exponential / 4));
    this.reconnectAttempt += 1;
    this.reconnectCount += 1;
    this.metrics?.incrementCounter('freeswitch.event.reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, exponential + jitter);
  }
}

function isOkReply(frame: EslFrame): boolean {
  const replyText = getEslHeader(frame.headers, 'Reply-Text');
  return Boolean(replyText && /^\+OK\b/i.test(replyText.trim()));
}

function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function toIso(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
