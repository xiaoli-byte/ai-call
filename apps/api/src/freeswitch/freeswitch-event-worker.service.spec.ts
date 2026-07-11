import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';
import type { EslFrame } from './esl-frame-parser.js';
import {
  FreeSwitchBridgeError,
} from './freeswitch-event-bridge.service.js';
import { FreeSwitchEventWorkerService } from './freeswitch-event-worker.service.js';

const ORIGINAL_ENV = { ...process.env };
const CALL_ID = '52ccf8b0-6b2c-4c77-95e3-d10685443db8';

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('FreeSwitchEventWorkerService', () => {
  it('becomes ready only after auth and subscription acknowledgements', () => {
    const writes: string[] = [];
    const worker = makeWorker();
    (worker as any).socket = {
      destroyed: false,
      write: (value: string) => writes.push(value),
    };
    (worker as any).state = 'auth-request';

    (worker as any).handleFrame(frame({
      'Content-Type': 'auth/request',
    }));
    assert.match(writes[0], /^auth /);
    assert.equal(worker.health().ready, false);

    (worker as any).handleFrame(frame({
      'Content-Type': 'command/reply',
      'Reply-Text': '+OK accepted',
    }));
    assert.match(writes[1], /^event plain HEARTBEAT /);
    assert.equal(worker.health().ready, false);

    (worker as any).handleFrame(frame({
      'Content-Type': 'command/reply',
      'Reply-Text': '+OK event listener enabled plain',
    }));
    assert.equal(worker.health().state, 'subscribed');
    assert.equal(worker.health().ready, true);
  });

  it('uses HEARTBEAT only for health and does not post it', async () => {
    const posted: ProviderCallEventDto[] = [];
    const worker = makeWorker({
      postProviderEvent: async (event) => {
        posted.push(event);
      },
    });
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = 0;

    (worker as any).handleFrame(plainEvent([
      'Event-Name: HEARTBEAT',
      'Core-UUID: core-1',
      'Event-Sequence: 1',
    ]));
    await wait(10);

    assert.equal(posted.length, 0);
    assert.equal(worker.health().ready, true);
    assert.ok(worker.health().lastHeartbeatAt);
  });

  it('retries a managed provider event with the same id in FIFO order', async () => {
    process.env.FREESWITCH_EVENT_DELIVERY_BASE_DELAY_MS = '10';
    let attempts = 0;
    const ids: string[] = [];
    const worker = makeWorker({
      postProviderEvent: async (event) => {
        attempts += 1;
        ids.push(event.providerEventId ?? '');
        if (attempts === 1) {
          throw new FreeSwitchBridgeError('provider-event', true, 500);
        }
      },
    });
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now();

    (worker as any).handleFrame(plainEvent([
      'Event-Name: CHANNEL_PROGRESS',
      'Core-UUID: core-1',
      'Event-Sequence: 2',
      'Unique-ID: ' + CALL_ID,
      'variable_attempt_id: ' + CALL_ID,
      'variable_ai_call_managed: true',
      'Event-Date-Timestamp: 1700000000000000',
    ]));
    await wait(80);

    assert.equal(attempts, 2);
    assert.equal(ids[0], ids[1]);
    assert.equal(worker.health().queueDepth, 0);
    assert.equal(worker.health().ready, true);
  });

  it('marks a stale heartbeat as not ready', () => {
    process.env.FREESWITCH_EVENT_HEARTBEAT_STALE_MS = '5000';
    const worker = makeWorker();
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now() - 6_000;

    assert.equal(worker.health().live, true);
    assert.equal(worker.health().ready, false);
  });

  it('dead-letters a schema-rejected (400) event instead of dropping it', async () => {
    const deadLetters: any[] = [];
    const worker = makeWorker({
      postProviderEvent: async () => {
        throw new FreeSwitchBridgeError('provider-event', false, 400, 'bad schema');
      },
    });
    (worker as any).appendDeadLetter = async (line: string) => {
      deadLetters.push(JSON.parse(line));
    };
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now();

    (worker as any).handleFrame(managedProgressEvent());
    await wait(30);

    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0].type, 'call.provider_event.dead_letter');
    assert.equal(deadLetters[0].reason, 'rejected');
    assert.equal(deadLetters[0].status, 400);
    assert.equal(deadLetters[0].event.providerCallId, CALL_ID);
    assert.equal(worker.health().queueDepth, 0);
    assert.equal(worker.health().deadLetterCount, 1);
  });

  it('dead-letters an event after exhausting retryable delivery attempts', async () => {
    process.env.FREESWITCH_EVENT_DELIVERY_MAX_ATTEMPTS = '1';
    process.env.FREESWITCH_EVENT_DELIVERY_BASE_DELAY_MS = '10';
    const deadLetters: any[] = [];
    const worker = makeWorker({
      postProviderEvent: async () => {
        throw new FreeSwitchBridgeError('provider-event', true, 503, 'upstream down');
      },
    });
    (worker as any).appendDeadLetter = async (line: string) => {
      deadLetters.push(JSON.parse(line));
    };
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now();

    (worker as any).handleFrame(managedProgressEvent());
    await wait(40);

    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0].reason, 'exhausted');
    assert.equal(deadLetters[0].status, 503);
    assert.equal(worker.health().queueDepth, 0);
    assert.equal(worker.health().deadLetterCount, 1);
  });

  it('creates the dead-letter parent directory on first write when it does not exist yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-call-dead-letter-'));
    const deadLetterPath = join(root, 'nested', 'deep', 'dead-letter.jsonl');
    try {
      process.env.FREESWITCH_EVENT_DEAD_LETTER_PATH = deadLetterPath;
      const worker = makeWorker({
        postProviderEvent: async () => {
          throw new FreeSwitchBridgeError('provider-event', false, 400, 'bad schema');
        },
      });
      // 不覆盖 appendDeadLetter，走真实的 mkdir + appendFile 路径。
      (worker as any).state = 'subscribed';
      (worker as any).lastHeartbeatAt = Date.now();

      (worker as any).handleFrame(managedProgressEvent());
      await wait(30);

      const content = await readFile(deadLetterPath, 'utf8');
      const record = JSON.parse(content.trim());
      assert.equal(record.reason, 'rejected');
      assert.equal(worker.health().deadLetterCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps ready true when a frame fails to parse (parse failure ≠ delivery health)', () => {
    const worker = makeWorker();
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now();

    // text/event-plain body with no header boundary → parsePlainEventPayload throws.
    (worker as any).handleFrame(frame(
      { 'Content-Type': 'text/event-plain' },
      'Event-Name: CHANNEL_PROGRESS\nno-terminating-blank-line',
    ));

    assert.equal(worker.health().parseFailureCount, 1);
    assert.ok(worker.health().lastParseErrorAt);
    assert.equal(worker.health().lastErrorCode, 'INVALID_EVENT_FRAME');
    // The malformed frame must NOT wedge readiness (#3 sticky-503 regression).
    assert.equal(worker.health().ready, true);
  });

  it('clears a stale delivery flag on a heartbeat when the queue is idle', () => {
    const worker = makeWorker();
    (worker as any).state = 'subscribed';
    (worker as any).lastHeartbeatAt = Date.now();
    // Simulate a prior delivery failure that left the worker unhealthy.
    (worker as any).deliveryHealthy = false;
    assert.equal(worker.health().ready, false);

    (worker as any).handleFrame(plainEvent([
      'Event-Name: HEARTBEAT',
      'Core-UUID: core-1',
      'Event-Sequence: 9',
    ]));

    assert.equal(worker.health().ready, true);
  });
});

function managedProgressEvent(): EslFrame {
  return plainEvent([
    'Event-Name: CHANNEL_PROGRESS',
    'Core-UUID: core-1',
    'Event-Sequence: 2',
    'Unique-ID: ' + CALL_ID,
    'variable_attempt_id: ' + CALL_ID,
    'variable_ai_call_managed: true',
    'Event-Date-Timestamp: 1700000000000000',
  ]);
}

function makeWorker(bridgeOverrides: {
  postProviderEvent?: (event: ProviderCallEventDto) => Promise<void>;
} = {}): FreeSwitchEventWorkerService {
  const bridge = {
    postProviderEvent:
      bridgeOverrides.postProviderEvent ?? (async () => undefined),
    postActiveSnapshot: async () => undefined,
  };
  const freeswitch = {
    listActiveChannelIds: async () => new Set<string>(),
  };
  return new FreeSwitchEventWorkerService(
    bridge as never,
    freeswitch as never,
  );
}

function frame(
  headers: Readonly<Record<string, string>>,
  body = '',
): EslFrame {
  return { headers, body: Buffer.from(body) };
}

function plainEvent(lines: string[]): EslFrame {
  return frame(
    { 'Content-Type': 'text/event-plain' },
    lines.join('\n') + '\n\n',
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
