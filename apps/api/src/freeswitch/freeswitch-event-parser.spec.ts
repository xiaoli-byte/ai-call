import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseFreeSwitchEvent,
  parseFreeSwitchEventHeaders,
} from './freeswitch-event-parser.js';

const ANSWER_EVENT_ID = '52ccf8b0-6b2c-4c77-95e3-d10685443db8';
const ANSWER_CALL_ID = 'e14e9244-e98f-42a8-a3c5-510e06dd89a5';

describe('parseFreeSwitchEventHeaders', () => {
  it('maps CHANNEL_ANSWER headers to a provider call event', () => {
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_ANSWER',
      'Event-UUID': ANSWER_EVENT_ID,
      'Unique-ID': ANSWER_CALL_ID,
      'Event-Date-Timestamp': '1700000000123456',
      'variable_task_id': 'task-1',
      'variable_attempt_id': ANSWER_CALL_ID,
    });

    assert.equal(event.provider, 'freeswitch');
    assert.equal(event.providerEventId, ANSWER_EVENT_ID);
    assert.equal(event.eventType, 'CHANNEL_ANSWER');
    assert.equal(event.taskId, 'task-1');
    assert.equal(event.attemptId, ANSWER_CALL_ID);
    assert.equal(event.providerCallId, ANSWER_CALL_ID);
    assert.equal(event.occurredAt, '2023-11-14T22:13:20.123Z');
  });

  it('maps CHANNEL_HANGUP_COMPLETE headers with hangup cause', () => {
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
      'Core-UUID': 'core-1',
      'Event-Sequence': '42',
      'Channel-Call-UUID': ANSWER_CALL_ID,
      'Hangup-Cause': 'NORMAL_CLEARING',
      'Event-Date-GMT': 'Tue, 14 Nov 2023 22:13:21 GMT',
    });

    assert.equal(event.eventType, 'CHANNEL_HANGUP_COMPLETE');
    assert.equal(event.providerCallId, ANSWER_CALL_ID);
    assert.equal(event.hangupCause, 'NORMAL_CLEARING');
    assert.equal(event.occurredAt, '2023-11-14T22:13:21.000Z');
    assert.match(event.providerEventId ?? '', /^[0-9a-f]{64}$/);
  });

  it('maps RECORD_STOP headers with recording path case-insensitively', () => {
    const event = parseFreeSwitchEventHeaders({
      'event-name': 'record_stop',
      'core-uuid': 'core-record',
      'event-sequence': '9',
      'variable_uuid': ANSWER_CALL_ID,
      'record-file-path': '/var/lib/freeswitch/recordings/call.wav',
      'event-date-timestamp': '1700000002000000',
    });

    assert.equal(event.eventType, 'RECORD_STOP');
    assert.equal(event.providerCallId, ANSWER_CALL_ID);
    assert.equal(
      event.recordingPath,
      '/var/lib/freeswitch/recordings/call.wav',
    );
    assert.equal(event.occurredAt, '2023-11-14T22:13:22.000Z');
  });

  it('parses a BACKGROUND_JOB body and extracts a validated originate attempt', () => {
    const attemptId = '82eec169-8f9e-47bf-a927-47e1efdb2412';
    const event = parseFreeSwitchEvent({
      headers: {
        'Event-Name': 'BACKGROUND_JOB',
        'Core-UUID': 'core-job',
        'Event-Sequence': '101',
        'Job-UUID': '37f4142e-9ad3-43b2-9335-560f3cbf1778',
        'Job-Command': 'originate',
        'Job-Command-Arg': '{origination_uuid=' + attemptId + ',variable_api_on_answer=secret}user/1001 &park()',
      },
      body: '-ERR USER_NOT_REGISTERED\n',
    });

    assert.equal(event.eventType, 'BACKGROUND_JOB');
    assert.equal(event.attemptId, attemptId);
    assert.equal(event.jobId, '37f4142e-9ad3-43b2-9335-560f3cbf1778');
    assert.equal(event.backgroundJobResult, '-ERR USER_NOT_REGISTERED');
    assert.equal(event.raw?.['Job-Command-Arg'], undefined);
  });

  it('uses Core-UUID and Event-Sequence for stable fallback ids', () => {
    const base = {
      'Event-Name': 'CHANNEL_PROGRESS',
      'Core-UUID': 'core-fallback',
      'Event-Sequence': '100',
      'Unique-ID': ANSWER_CALL_ID,
      'Event-Date-Timestamp': '1700000003000000',
    };
    const first = parseFreeSwitchEventHeaders(base);
    const retry = parseFreeSwitchEventHeaders(base);
    const next = parseFreeSwitchEventHeaders({
      ...base,
      'Event-Sequence': '101',
    });

    assert.equal(first.providerEventId, retry.providerEventId);
    assert.notEqual(first.providerEventId, next.providerEventId);
  });

  it('does not persist sensitive channel variables or their metadata', () => {
    const secret = 'top-secret-ws-token';
    const encodedMetadata = Buffer.from(JSON.stringify({ token: secret }))
      .toString('base64');
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_ANSWER',
      'Core-UUID': 'core-safe',
      'Event-Sequence': '12',
      'Unique-ID': ANSWER_CALL_ID,
      'variable_attempt_id': ANSWER_CALL_ID,
      'variable_api_on_answer': 'uuid_audio_fork base64:' + encodedMetadata,
      'variable_sip_authorization': 'Digest sensitive',
    });

    const serialized = JSON.stringify(event.raw);
    assert.doesNotMatch(serialized, /api_on_answer/i);
    assert.doesNotMatch(serialized, /authorization/i);
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, new RegExp(encodedMetadata));
  });

  it('keeps malformed percent values without throwing', () => {
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_PROGRESS',
      'Core-UUID': 'core-percent',
      'Event-Sequence': '2',
      'Unique-ID': ANSWER_CALL_ID,
      'Answer-State': 'ringing%ZZ',
    });
    assert.equal(event.raw?.['Answer-State'], 'ringing%ZZ');
  });

  it('rejects headers without an event name', () => {
    assert.throws(
      () => parseFreeSwitchEventHeaders({ 'Unique-ID': ANSWER_CALL_ID }),
      /Event-Name/,
    );
  });
});
