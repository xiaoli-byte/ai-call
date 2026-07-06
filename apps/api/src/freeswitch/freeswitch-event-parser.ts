import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';

export type FreeSwitchEventHeaderValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[];

export type FreeSwitchEventHeaders = Record<string, FreeSwitchEventHeaderValue>;

const PROVIDER = 'freeswitch';

export function parseFreeSwitchEventHeaders(
  headers: FreeSwitchEventHeaders,
): ProviderCallEventDto {
  const eventName = headerString(headers, ['Event-Name']);
  if (!eventName) {
    throw new Error('FreeSWITCH event headers are missing Event-Name');
  }

  const event: ProviderCallEventDto = {
    provider: PROVIDER,
    eventType: normalizeEventType(eventName),
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
  ]));
  assignIfPresent(event, 'providerCallId', headerString(headers, [
    'Unique-ID',
    'Channel-Call-UUID',
    'variable_uuid',
    'variable_channel_uuid',
  ]));
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
    Object.entries(headers).filter(([, value]) => value !== undefined),
  );
}
