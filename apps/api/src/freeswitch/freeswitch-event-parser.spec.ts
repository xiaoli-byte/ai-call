import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFreeSwitchEventHeaders } from './freeswitch-event-parser.js';

describe('parseFreeSwitchEventHeaders', () => {
  it('maps CHANNEL_ANSWER headers to a provider call event', () => {
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_ANSWER',
      'Unique-ID': 'uuid-answer',
      'Event-Date-Timestamp': '1700000000123456',
      'variable_task_id': 'task-1',
      'variable_attempt_id': 'attempt-1',
    });

    assert.deepEqual(event, {
      provider: 'freeswitch',
      eventType: 'CHANNEL_ANSWER',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      providerCallId: 'uuid-answer',
      occurredAt: '2023-11-14T22:13:20.123Z',
      raw: {
        'Event-Name': 'CHANNEL_ANSWER',
        'Unique-ID': 'uuid-answer',
        'Event-Date-Timestamp': '1700000000123456',
        'variable_task_id': 'task-1',
        'variable_attempt_id': 'attempt-1',
      },
    });
  });

  it('maps CHANNEL_HANGUP_COMPLETE headers with hangup cause', () => {
    const event = parseFreeSwitchEventHeaders({
      'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
      'Channel-Call-UUID': 'uuid-hangup',
      'Hangup-Cause': 'NORMAL_CLEARING',
      'Event-Date-GMT': 'Tue, 14 Nov 2023 22:13:21 GMT',
    });

    assert.deepEqual(event, {
      provider: 'freeswitch',
      eventType: 'CHANNEL_HANGUP_COMPLETE',
      providerCallId: 'uuid-hangup',
      hangupCause: 'NORMAL_CLEARING',
      occurredAt: '2023-11-14T22:13:21.000Z',
      raw: {
        'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
        'Channel-Call-UUID': 'uuid-hangup',
        'Hangup-Cause': 'NORMAL_CLEARING',
        'Event-Date-GMT': 'Tue, 14 Nov 2023 22:13:21 GMT',
      },
    });
  });

  it('maps RECORD_STOP headers with recording path case-insensitively', () => {
    const event = parseFreeSwitchEventHeaders({
      'event-name': 'record_stop',
      'variable_uuid': 'uuid-record',
      'record-file-path': '/var/lib/freeswitch/recordings/call.wav',
      'event-date-timestamp': '1700000002000000',
    });

    assert.deepEqual(event, {
      provider: 'freeswitch',
      eventType: 'RECORD_STOP',
      providerCallId: 'uuid-record',
      recordingPath: '/var/lib/freeswitch/recordings/call.wav',
      occurredAt: '2023-11-14T22:13:22.000Z',
      raw: {
        'event-name': 'record_stop',
        'variable_uuid': 'uuid-record',
        'record-file-path': '/var/lib/freeswitch/recordings/call.wav',
        'event-date-timestamp': '1700000002000000',
      },
    });
  });

  it('rejects headers without an event name', () => {
    assert.throws(
      () => parseFreeSwitchEventHeaders({ 'Unique-ID': 'uuid-missing-event' }),
      /Event-Name/,
    );
  });
});
