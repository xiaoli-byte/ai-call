import assert from 'node:assert/strict';
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
});

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
