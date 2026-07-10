import type { TaskStatus, TranscriptTurn } from '@ai-call/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { toPrismaJson } from '../common/prisma-json.js';

export { toPrismaJson } from '../common/prisma-json.js';

export type FlowActionType = 'sms' | 'api' | 'crm';
export type FlowActionEventType =
  | `action.${FlowActionType}`
  | `action.${FlowActionType}.requested`
  | `action.${FlowActionType}.delivered`
  | `action.${FlowActionType}.retrying`
  | `action.${FlowActionType}.failed`;

export type CallEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'transcript.appended'
  | 'call.outcome_set'
  | 'call.hung_up'
  | 'call.provider_event'
  | 'call.dispatch_requested'
  | 'call.dispatch_accepted'
  | 'call.dispatch_requested.retrying'
  | 'call.dispatch_requested.failed'
  | 'call.policy_blocked'
  | 'call.transferred'
  | FlowActionEventType;

export type CallEventPayloadFor<T extends CallEventType> =
  T extends 'task.created' ? { flowVersionId?: string } :
  T extends 'task.status_changed' ? { from: TaskStatus; to: TaskStatus } :
  T extends 'transcript.appended' ? { role: TranscriptTurn['role'] } :
  T extends 'call.outcome_set' ? { outcome: string; tags?: string[] } :
  T extends 'call.hung_up' ? { outcome?: string; duration?: number; channelId?: string; hangupError?: string } :
  T extends 'call.provider_event' ? ProviderCallEventPayload :
  T extends 'call.dispatch_requested' | `action.${FlowActionType}.delivered` ? Record<string, never> :
  T extends 'call.dispatch_accepted' ? { channel?: 'web' } :
  T extends 'call.policy_blocked' ? { code: string; message: string; details?: Record<string, unknown> } :
  T extends 'call.transferred' ? { extension: string; channelId: string } :
  T extends `action.${FlowActionType}.requested` ? { outboxEventId: string } :
  T extends 'call.dispatch_requested.retrying' | 'call.dispatch_requested.failed' | `action.${FlowActionType}.retrying` | `action.${FlowActionType}.failed` ? { attempts: number; error: string } :
  Record<string, never>;

export type ProviderCallEventPayload = {
  provider: string;
  eventType: string;
  taskId: string;
  attemptId?: string;
  providerCallId?: string;
  occurredAt: string;
  hangupCause?: string;
  recordingPath?: string;
  recordingUrl?: string;
  raw?: Record<string, unknown>;
};

export type CallDispatchRequestedPayload = {
  taskId: string;
  attemptId: string;
  to: string;
  from: string;
};

export type FlowActionPayload = {
  taskId: string;
  attemptId?: string;
  to?: string;
  config: Record<string, unknown>;
};

export type OutboxEventType = 'call.dispatch_requested' | `action.${FlowActionType}`;
export type OutboxFailureCallEventType =
  | 'call.dispatch_requested.retrying'
  | 'call.dispatch_requested.failed'
  | `action.${FlowActionType}.retrying`
  | `action.${FlowActionType}.failed`;

export type OutboxPayloadFor<T extends OutboxEventType> =
  T extends 'call.dispatch_requested' ? CallDispatchRequestedPayload :
  T extends `action.${FlowActionType}` ? FlowActionPayload :
  never;

export function callEventPayload<T extends CallEventType>(
  _type: T,
  payload: CallEventPayloadFor<T>,
): Prisma.InputJsonValue {
  return toPrismaJson(payload);
}

export function outboxPayload<T extends OutboxEventType>(
  _type: T,
  payload: OutboxPayloadFor<T>,
): Prisma.InputJsonValue {
  return toPrismaJson(payload);
}

export function outboxFailureCallEventType(
  type: OutboxEventType,
  terminal: boolean,
): OutboxFailureCallEventType {
  return `${type}.${terminal ? 'failed' : 'retrying'}` as OutboxFailureCallEventType;
}

export function parseOutboxPayload<T extends OutboxEventType>(
  type: T,
  payload: unknown,
): OutboxPayloadFor<T> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Invalid ${type} payload`);
  }
  const value = payload as Record<string, unknown>;
  if (type === 'call.dispatch_requested') {
    if (
      typeof value.taskId !== 'string' ||
      typeof value.attemptId !== 'string' ||
      typeof value.to !== 'string' ||
      typeof value.from !== 'string'
    ) {
      throw new Error('Invalid call.dispatch_requested payload');
    }
    return {
      taskId: value.taskId,
      attemptId: value.attemptId,
      to: value.to,
      from: value.from,
    } as OutboxPayloadFor<T>;
  }
  if (type === 'action.sms' || type === 'action.api' || type === 'action.crm') {
    if (typeof value.taskId !== 'string') {
      throw new Error(`Invalid ${type} payload`);
    }
    return {
      taskId: value.taskId,
      attemptId: typeof value.attemptId === 'string' ? value.attemptId : undefined,
      to: typeof value.to === 'string' ? value.to : undefined,
      config: isPlainObject(value.config) ? value.config : {},
    } as OutboxPayloadFor<T>;
  }
  throw new Error(`Unsupported outbox event: ${type}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
