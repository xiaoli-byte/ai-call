import { createHash } from 'node:crypto';
import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';

export type FreeSwitchEventHeaderValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[];

export type FreeSwitchEventHeaders = Readonly<
  Record<string, FreeSwitchEventHeaderValue>
>;

export type FreeSwitchPlainEvent = {
  headers: FreeSwitchEventHeaders;
  body?: string | Buffer;
};

const PROVIDER = 'freeswitch';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_RAW_HEADERS = new Set([
  'event-name',
  'event-uuid',
  'core-uuid',
  'event-sequence',
  'event-date-timestamp',
  'event-date-gmt',
  'event-date-local',
  'unique-id',
  'channel-call-uuid',
  'job-uuid',
  'job-command',
  'hangup-cause',
  'answer-state',
  // Answer evidence: at CHANNEL_HANGUP_COMPLETE answer-state is usually "hangup",
  // so terminal classification also reads billsec/answer-epoch to avoid marking
  // an answered NORMAL_CLEARING call as NO_ANSWER when CHANNEL_ANSWER was lost.
  'variable_billsec',
  'variable_answer_epoch',
  'variable_task_id',
  'variable_attempt_id',
  'record-file-path',
  'record-file-name',
  'recording-file-path',
  'variable_record_file_path',
  'variable_record_file_name',
]);

/**
 * Convert a decoded FreeSWITCH plain event into the internal provider event.
 *
 * The body is accepted separately because BACKGROUND_JOB puts the eventual
 * command result there. Job-Command-Arg is inspected only in memory and is
 * deliberately excluded from raw.
 */
export function parseFreeSwitchEvent(
  input: FreeSwitchPlainEvent,
): ProviderCallEventDto {
  const body = Buffer.isBuffer(input.body)
    ? input.body.toString('utf8')
    : input.body;
  return parseFreeSwitchEventHeaders(input.headers, body);
}

export function parseFreeSwitchEventHeaders(
  headers: FreeSwitchEventHeaders,
  body = '',
): ProviderCallEventDto {
  const eventName = headerString(headers, ['Event-Name']);
  if (!eventName) {
    throw new Error('FreeSWITCH event headers are missing Event-Name');
  }

  const eventType = normalizeEventType(eventName);
  const providerCallId = headerString(headers, [
    'Unique-ID',
    'Channel-Call-UUID',
    'variable_uuid',
    'variable_channel_uuid',
  ]);
  const jobId = headerString(headers, ['Job-UUID']);
  const event: ProviderCallEventDto = {
    provider: PROVIDER,
    providerEventId: providerEventId(headers, eventType, providerCallId, jobId, body),
    eventType,
    raw: rawHeaders(headers),
  };

  assignIfPresent(event, 'taskId', headerString(headers, [
    'variable_task_id',
    'Task-ID',
    'Task-Id',
  ]));
  assignIfPresent(event, 'attemptId', headerString(headers, [
    'variable_attempt_id',
    'Attempt-ID',
    'Attempt-Id',
  ]) ?? attemptIdFromJobCommand(headers));
  assignIfPresent(event, 'providerCallId', providerCallId);
  assignIfPresent(event, 'jobId', jobId);
  assignIfPresent(event, 'hangupCause', headerString(headers, [
    'Hangup-Cause',
    'variable_hangup_cause',
    'hangup_cause',
  ]));
  assignIfPresent(event, 'recordingPath', headerString(headers, [
    'Record-File-Path',
    'Record-File-Name',
    'Recording-File-Path',
    'variable_record_file_path',
    'variable_record_file_name',
    'record_file_path',
    'record_file_name',
  ]));
  assignIfPresent(event, 'occurredAt', occurredAt(headers));

  if (eventType === 'BACKGROUND_JOB') {
    event.backgroundJobResult = safeBackgroundJobResult(body);
  }

  return event;
}

function assignIfPresent<K extends keyof ProviderCallEventDto>(
  event: ProviderCallEventDto,
  key: K,
  value: ProviderCallEventDto[K] | undefined,
): void {
  if (value !== undefined) event[key] = value;
}

function normalizeEventType(value: string): string {
  return value.trim().replace(/[\s.-]+/g, '_').toUpperCase();
}

function occurredAt(headers: FreeSwitchEventHeaders): string | undefined {
  const timestamp = headerString(headers, ['Event-Date-Timestamp']);
  const timestampDate = timestamp ? parseFreeSwitchTimestamp(timestamp) : undefined;
  if (timestampDate) return timestampDate.toISOString();

  const dateText = headerString(headers, [
    'Event-Date-GMT',
    'Event-Date-Local',
  ]);
  const date = dateText ? new Date(dateText) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function parseFreeSwitchTimestamp(value: string): Date | undefined {
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return undefined;

  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return undefined;

  const milliseconds = digits.length >= 16
    ? Math.floor(numeric / 1000)
    : digits.length <= 10
      ? numeric * 1000
      : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function attemptIdFromJobCommand(
  headers: FreeSwitchEventHeaders,
): string | undefined {
  const commandArg = headerString(headers, ['Job-Command-Arg']);
  if (!commandArg) return undefined;
  const match = commandArg.match(
    /(?:^|[,{])\s*origination_uuid=([0-9a-f-]{36})(?=[,}])/i,
  );
  const attemptId = match?.[1];
  return attemptId && UUID_PATTERN.test(attemptId) ? attemptId : undefined;
}

function providerEventId(
  headers: FreeSwitchEventHeaders,
  eventType: string,
  providerCallId: string | undefined,
  jobId: string | undefined,
  body: string,
): string {
  const eventUuid = headerString(headers, ['Event-UUID']);
  if (eventUuid) return eventUuid;

  const identity = [
    headerString(headers, ['Core-UUID']) ?? '',
    headerString(headers, ['Event-Sequence']) ?? '',
    eventType,
    jobId ?? '',
    providerCallId ?? '',
    headerString(headers, ['Event-Date-Timestamp']) ?? '',
    body,
  ];
  return createHash('sha256').update(identity.join('\0')).digest('hex');
}

function safeBackgroundJobResult(body: string): string {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'UNKNOWN';

  if (/^\+OK\b/i.test(firstLine)) {
    const uuid = firstLine.match(/[0-9a-f-]{36}/i)?.[0];
    return uuid && UUID_PATTERN.test(uuid) ? '+OK ' + uuid : '+OK';
  }
  if (/^-ERR\b/i.test(firstLine)) {
    const cause = firstLine
      .slice(4)
      .toUpperCase()
      .match(/[A-Z][A-Z0-9_]{2,}/)?.[0];
    return '-ERR ' + (cause ?? 'UNKNOWN');
  }
  return 'UNKNOWN';
}

function headerString(
  headers: FreeSwitchEventHeaders,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const exact = cleanHeaderValue(headers[key]);
    if (exact) return exact;
  }

  const entries = Object.entries(headers);
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const match = entries.find(([candidate]) => candidate.toLowerCase() === lowerKey);
    const value = cleanHeaderValue(match?.[1]);
    if (value) return value;
  }
  return undefined;
}

function cleanHeaderValue(value: FreeSwitchEventHeaderValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === null || first === undefined) return undefined;
  const text = String(first).trim();
  return text ? text : undefined;
}

function rawHeaders(headers: FreeSwitchEventHeaders): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => (
        value !== undefined && SAFE_RAW_HEADERS.has(key.toLowerCase())
      ))
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return [key, value.map((item) => String(item))];
        }
        return [key, value];
      }),
  );
}
