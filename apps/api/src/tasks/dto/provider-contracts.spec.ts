import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MAX_PROVIDER_ACTIVE_CHANNELS,
  ProviderActiveSnapshotDto,
} from './provider-active-snapshot.dto.js';
import { ProviderCallEventDto } from './provider-call-event.dto.js';

describe('provider call event contract', () => {
  it('accepts each supported attempt correlation identifier', async () => {
    for (const identifier of [
      { attemptId: 'attempt-1' },
      { providerCallId: 'channel-1' },
      { jobId: 'job-1' },
    ]) {
      const errors = await validate(plainToInstance(ProviderCallEventDto, {
        provider: 'freeswitch',
        providerEventId: 'event-1',
        eventType: 'CHANNEL_ANSWER',
        ...identifier,
      }));
      assert.equal(errors.length, 0);
    }
  });

  it('rejects taskId as the only correlation identifier', async () => {
    const errors = await validate(plainToInstance(ProviderCallEventDto, {
      provider: 'freeswitch',
      providerEventId: 'event-1',
      eventType: 'CHANNEL_ANSWER',
      taskId: 'task-1',
    }));

    assert.ok(errors.some((error) => error.property === 'attemptId'));
  });

  it('rejects null or blank correlation identifiers', async () => {
    for (const identifier of [
      { providerCallId: null },
      { providerCallId: '   ' },
      { jobId: '' },
      { attemptId: '\t' },
    ]) {
      const errors = await validate(plainToInstance(ProviderCallEventDto, {
        eventType: 'CHANNEL_ANSWER',
        ...identifier,
      }));
      assert.ok(errors.length > 0);
    }
  });

  it('bounds provider event identity and background result fields', async () => {
    const errors = await validate(plainToInstance(ProviderCallEventDto, {
      provider: 'p'.repeat(65),
      providerEventId: 'e'.repeat(257),
      eventType: 'x'.repeat(129),
      jobId: 'j'.repeat(129),
      backgroundJobResult: 'r'.repeat(4_097),
    }));

    assert.deepEqual(
      new Set(errors.map((error) => error.property)),
      new Set(['provider', 'providerEventId', 'eventType', 'jobId', 'backgroundJobResult']),
    );
  });
});

describe('provider active snapshot contract', () => {
  const channelId = '58f332a4-4a2f-4f70-bce9-901a5d2b3f84';

  it('accepts an empty or UUID-only active channel list', async () => {
    for (const activeChannelIds of [[], [channelId]]) {
      const errors = await validate(plainToInstance(ProviderActiveSnapshotDto, {
        provider: 'freeswitch',
        snapshotId: 'snapshot-1',
        observedAt: '2026-07-10T15:00:00.000Z',
        activeChannelIds,
      }));
      assert.equal(errors.length, 0);
    }
  });

  it('rejects non-UUID channels and oversized snapshots', async () => {
    const invalidChannelErrors = await validate(plainToInstance(ProviderActiveSnapshotDto, {
      provider: 'freeswitch',
      snapshotId: 'snapshot-1',
      observedAt: '2026-07-10T15:00:00.000Z',
      activeChannelIds: ['not-a-uuid'],
    }));
    assert.ok(invalidChannelErrors.some((error) => error.property === 'activeChannelIds'));

    const oversizedErrors = await validate(plainToInstance(ProviderActiveSnapshotDto, {
      provider: 'freeswitch',
      snapshotId: 'snapshot-2',
      observedAt: '2026-07-10T15:00:00.000Z',
      activeChannelIds: Array.from({ length: MAX_PROVIDER_ACTIVE_CHANNELS + 1 }, () => channelId),
    }));
    assert.ok(oversizedErrors.some((error) => error.property === 'activeChannelIds'));
  });
});
