import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import {
  FreeSwitchBridgeError,
  FreeSwitchEventBridgeService,
} from './freeswitch-event-bridge.service.js';

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

describe('FreeSwitchEventBridgeService', () => {
  it('posts provider events to INTERNAL_API_BASE_URL with the service token', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000/';
    process.env.API_BASE_URL = 'http://public-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    delete process.env.SERVICE_API_REQUIRE_SIGNATURE;
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 202);

    await new FreeSwitchEventBridgeService().postProviderEvent({
      provider: 'freeswitch',
      providerEventId: 'event-answer',
      eventType: 'CHANNEL_ANSWER',
      providerCallId: 'uuid-answer',
    });

    assert.equal(calls[0].url, 'http://internal-api:3000/tasks/provider-events');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].init.headers, {
      'Content-Type': 'application/json',
      'x-service-token': 'service-token',
    });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      provider: 'freeswitch',
      providerEventId: 'event-answer',
      eventType: 'CHANNEL_ANSWER',
      providerCallId: 'uuid-answer',
    });
  });

  it('falls back to API_BASE_URL when INTERNAL_API_BASE_URL is not configured', async () => {
    delete process.env.INTERNAL_API_BASE_URL;
    process.env.API_BASE_URL = 'http://public-api:3000/base/';
    process.env.SERVICE_API_TOKEN = 'service-token';
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 200);

    await new FreeSwitchEventBridgeService().postProviderEvent({
      providerEventId: 'event-hangup',
      eventType: 'CHANNEL_HANGUP_COMPLETE',
      providerCallId: 'uuid-hangup',
    });

    assert.equal(calls[0].url, 'http://public-api:3000/base/tasks/provider-events');
  });

  it('adds the service signature headers when signature enforcement is enabled', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    process.env.SERVICE_API_SIGNING_SECRET = 'signing-secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 200);

    await new FreeSwitchEventBridgeService().postProviderEvent({
      providerEventId: 'event-record',
      eventType: 'RECORD_STOP',
      providerCallId: 'uuid-record',
      recordingPath: '/recordings/call.wav',
    });

    const headers = calls[0].init.headers as Record<string, string>;
    const timestamp = headers['x-service-timestamp'];
    assert.match(timestamp, /^\d+$/);
    assert.equal(
      headers['x-service-signature'],
      createHmac('sha256', 'signing-secret')
        .update(`${timestamp}.service-token`)
        .digest('hex'),
    );
  });

  it('falls back to the service token when the signing secret override is empty', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    process.env.SERVICE_API_SIGNING_SECRET = '';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 200);

    await new FreeSwitchEventBridgeService().postProviderEvent({
      providerEventId: 'event-answer',
      eventType: 'CHANNEL_ANSWER',
      providerCallId: 'uuid-answer',
    });

    const headers = calls[0].init.headers as Record<string, string>;
    const timestamp = headers['x-service-timestamp'];
    assert.equal(
      headers['x-service-signature'],
      createHmac('sha256', 'service-token')
        .update(`${timestamp}.service-token`)
        .digest('hex'),
    );
  });

  it('parses FreeSWITCH headers before posting them', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 200);

    await new FreeSwitchEventBridgeService().postFreeSwitchHeaders({
      'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
      'Unique-ID': 'uuid-from-headers',
      'Hangup-Cause': 'NO_ANSWER',
    });

    const posted = JSON.parse(String(calls[0].init.body));
    assert.equal(posted.provider, 'freeswitch');
    assert.match(posted.providerEventId, /^[0-9a-f]{64}$/);
    assert.equal(posted.eventType, 'CHANNEL_HANGUP_COMPLETE');
    assert.equal(posted.providerCallId, 'uuid-from-headers');
    assert.equal(posted.hangupCause, 'NO_ANSWER');
    assert.equal(posted.raw['Event-Name'], 'CHANNEL_HANGUP_COMPLETE');
  });

  it('throws when the provider event endpoint rejects the event', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    globalThis.fetch = fakeFetch([], 500, 'database unavailable');

    await assert.rejects(
      () => new FreeSwitchEventBridgeService().postProviderEvent({
        providerEventId: 'event-answer',
        eventType: 'CHANNEL_ANSWER',
        providerCallId: 'uuid-answer',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FreeSwitchBridgeError);
        assert.equal(error.status, 500);
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, /database unavailable/);
        return true;
      },
    );
  });

  it('posts active channel snapshots to the service-auth endpoint', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://internal-api:3000';
    process.env.SERVICE_API_TOKEN = 'service-token';
    const calls: FetchCall[] = [];
    globalThis.fetch = fakeFetch(calls, 200);

    await new FreeSwitchEventBridgeService().postActiveSnapshot({
      provider: 'freeswitch',
      snapshotId: 'snapshot-1',
      observedAt: '2026-07-10T07:00:00.000Z',
      activeChannelIds: ['52ccf8b0-6b2c-4c77-95e3-d10685443db8'],
    });

    assert.equal(
      calls[0].url,
      'http://internal-api:3000/tasks/provider-active-snapshots',
    );
  });
});

type FetchCall = {
  url: string;
  init: RequestInit;
};

function fakeFetch(
  calls: FetchCall[],
  status: number,
  body = '{}',
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
}
