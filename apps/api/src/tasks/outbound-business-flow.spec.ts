import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallOutcome, Scenario, TaskStatus } from '@ai-call/shared';
import { OutboxWorker } from './outbox.worker.js';
import { TasksService } from './tasks.service.js';

const now = new Date('2026-07-03T08:00:00.000Z');

const flowVersion = {
  id: 'version-1',
  flowId: 'flow-1',
  version: 1,
  name: 'Smoke flow',
  description: '',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'end',
      type: 'end',
      position: { x: 100, y: 0 },
      data: { mode: 'complete', farewell: 'bye' },
    },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
  createdAt: now,
};

describe('outbound call business flow smoke', () => {
  it('runs task creation, scheduled dispatch, outbox delivery, in-call updates and hangup', async () => {
    const prisma = new InMemoryPrisma();
    const freeswitch = new FakeFreeSwitch();
    const taskFlows = {
      resolvePublishedVersion: async () => ({
        ...flowVersion,
        createdAt: flowVersion.createdAt.toISOString(),
      }),
    };
    const scenarios = {
      resolveConfig: async () => undefined,
      get: async () => undefined,
      mergeDefaultVariables: (_config: unknown, variables: Record<string, string>) => variables,
      toDomain: (record: unknown) => record,
    };
    const tasks = new TasksService(prisma as never, taskFlows as never, scenarios as never, freeswitch as never);
    const worker = new OutboxWorker(prisma as never, freeswitch as never, {} as never);

    const created = await tasks.create({
      to: '1001',
      scenario: Scenario.ECOMMERCE,
      flowId: 'flow-1',
      scheduledAt: '2026-07-03T08:00:00.000Z',
      variables: { company: 'Acme' },
    });
    assert.equal(created.status, TaskStatus.PENDING);
    assert.equal(created.flowVersionId, 'version-1');

    assert.deepEqual(await tasks.dispatchDuePending(), { scanned: 1, dispatched: 1 });
    const attemptId = prisma.attempts[0].id;
    assert.equal((await tasks.get(created.id)).status, TaskStatus.CALLING);
    assert.equal(prisma.outboxEvents[0].type, 'call.dispatch_requested');

    await worker.processBatch();
    assert.deepEqual(freeswitch.originates, [{ to: '1001', callId: attemptId }]);
    assert.equal(prisma.outboxEvents[0].status, 'processed');
    assert.equal(prisma.events.at(-1)?.type, 'call.dispatch_accepted');

    const context = await tasks.getContext(attemptId);
    assert.equal(context.id, created.id);
    assert.equal(context.flowVersion?.id, 'version-1');

    await tasks.updateStatus(attemptId, TaskStatus.IN_CALL);
    await tasks.appendTranscript(
      attemptId,
      { role: 'caller', content: 'please transfer me', timestamp: 1 },
      'turn-1',
    );
    await tasks.transferToHuman(created.id, '1001');
    await tasks.hangup(created.id, {
      outcome: CallOutcome.ESCALATED,
      tags: ['manual-transfer'],
    });

    const finalTask = await tasks.get(created.id);
    assert.equal(finalTask.status, TaskStatus.COMPLETED);
    assert.equal(finalTask.outcome, CallOutcome.ESCALATED);
    assert.equal(finalTask.attempts?.[0].status, TaskStatus.COMPLETED);
    assert.equal(finalTask.transcript?.[0].content, 'please transfer me');
    assert.deepEqual(freeswitch.transfers, [{ callId: attemptId, extension: '1001' }]);
    assert.deepEqual(freeswitch.hangups, [attemptId]);
    assert.deepEqual(
      prisma.events.map((event) => event.type),
      [
        'task.created',
        'call.dispatch_requested',
        'call.dispatch_accepted',
        'task.status_changed',
        'transcript.appended',
        'call.transferred',
        'call.hung_up',
      ],
    );
  });
});

class FakeFreeSwitch {
  readonly originates: Array<{ to: string; callId: string }> = [];
  readonly transfers: Array<{ callId: string; extension: string }> = [];
  readonly hangups: string[] = [];

  async originate(to: string, callId: string): Promise<string> {
    this.originates.push({ to, callId });
    return '+OK';
  }

  async transfer(callId: string, extension: string): Promise<string> {
    this.transfers.push({ callId, extension });
    return '+OK';
  }

  async hangup(callId: string): Promise<string> {
    this.hangups.push(callId);
    return '+OK';
  }
}

class InMemoryPrisma {
  readonly tasks: TaskRecord[] = [];
  readonly attempts: AttemptRecord[] = [];
  readonly transcripts: TranscriptRecord[] = [];
  readonly events: EventRecord[] = [];
  readonly outboxEvents: OutboxRecord[] = [];
  private taskSeq = 0;
  private eventSeq = 0;
  private transcriptSeq = 0;
  private outboxSeq = 0;

  readonly outboundTask = {
    create: async (args: any) => this.createTask(args),
    findUnique: async (args: any) => this.findTask(args),
    findUniqueOrThrow: async (args: any) => {
      const task = this.findTask(args);
      if (!task) throw new Error(`Task not found: ${args.where.id}`);
      return task;
    },
    findMany: async (args: any) => this.findTasks(args),
    update: async (args: any) => this.updateTask(args),
    updateMany: async (args: any) => this.updateManyTasks(args),
    delete: async (_args: any) => undefined,
  };

  readonly callAttempt = {
    create: async (args: any) => this.createAttempt(args),
    findFirst: async (args: any) => this.findAttempt(args),
    findUniqueOrThrow: async (args: any) => {
      const attempt = this.attempts.find((item) => item.id === args.where.id);
      if (!attempt) throw new Error(`Attempt not found: ${args.where.id}`);
      return this.cloneAttempt(attempt);
    },
    update: async (args: any) => this.updateAttempt(args),
  };

  readonly transcriptTurn = {
    findUnique: async (args: any) => {
      const key = args.where.taskId_externalId;
      return this.transcripts.find(
        (item) => item.taskId === key.taskId && item.externalId === key.externalId,
      ) ?? null;
    },
    create: async (args: any) => this.createTranscript(args),
  };

  readonly callEvent = {
    create: async (args: any) => this.createEvent(args),
  };

  readonly outboxEvent = {
    create: async (args: any) => this.createOutbox(args),
    findUnique: async (args: any) => this.outboxEvents.find(
      (item) => item.deduplicationKey === args.where.deduplicationKey,
    ) ?? null,
    findMany: async (args: any) => this.findOutbox(args),
    updateMany: async (args: any) => this.updateManyOutbox(args),
    update: async (args: any) => this.updateOutbox(args),
  };

  async $transaction<T>(input: Promise<T>[] | ((tx: this) => Promise<T>)): Promise<T | T[]> {
    if (typeof input === 'function') return input(this);
    return Promise.all(input);
  }

  private createTask(args: any): TaskRecord {
    const id = `task-${++this.taskSeq}`;
    const task: TaskRecord = {
      id,
      to: args.data.to,
      from: args.data.from,
      scenario: args.data.scenario,
      variables: args.data.variables ?? {},
      status: args.data.status,
      scheduledAt: args.data.scheduledAt,
      calledAt: null,
      endedAt: null,
      duration: null,
      outcome: null,
      recordingUrl: null,
      intentTags: [],
      attemptCount: 0,
      flowId: args.data.flowId ?? null,
      flowVersionId: args.data.flowVersionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    if (args.data.events?.create) {
      this.createEvent({
        data: {
          taskId: id,
          attemptId: undefined,
          type: args.data.events.create.type,
          payload: args.data.events.create.payload,
        },
      });
    }
    return this.cloneTask(task);
  }

  private findTask(args: any): any {
    const task = this.tasks.find((item) => item.id === args.where.id);
    if (!task) return null;
    if (args.select) {
      return Object.fromEntries(
        Object.keys(args.select).map((key) => [key, (task as Record<string, unknown>)[key]]),
      );
    }
    return this.cloneTask(task);
  }

  private findTasks(args: any): Array<{ id: string }> {
    const status = args.where?.status;
    const latest = args.where?.scheduledAt?.lte as Date | undefined;
    return this.tasks
      .filter((task) => (!status || task.status === status) && (!latest || task.scheduledAt <= latest))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .slice(0, args.take ?? this.tasks.length)
      .map((task) => ({ id: task.id }));
  }

  private updateTask(args: any): TaskRecord {
    const task = this.tasks.find((item) => item.id === args.where.id);
    if (!task) throw new Error(`Task not found: ${args.where.id}`);
    applyData(task, args.data);
    return this.cloneTask(task);
  }

  private updateManyTasks(args: any): { count: number } {
    let count = 0;
    for (const task of this.tasks) {
      if (args.where?.id && task.id !== args.where.id) continue;
      if (args.where?.status && task.status !== args.where.status) continue;
      applyData(task, args.data);
      count += 1;
    }
    return { count };
  }

  private createAttempt(args: any): AttemptRecord {
    const attempt: AttemptRecord = {
      id: args.data.id,
      taskId: args.data.taskId,
      attemptNo: args.data.attemptNo,
      providerCallId: args.data.providerCallId ?? null,
      status: args.data.status,
      startedAt: now,
      ringingAt: null,
      answeredAt: null,
      endedAt: null,
      duration: null,
      hangupCause: null,
      recordingUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    this.attempts.push(attempt);
    return this.cloneAttempt(attempt);
  }

  private findAttempt(args: any): AttemptRecord | null {
    if (args.where?.taskId) {
      const attempts = this.attempts
        .filter((attempt) => attempt.taskId === args.where.taskId)
        .sort((a, b) => b.attemptNo - a.attemptNo);
      return attempts[0] ? this.cloneAttempt(attempts[0]) : null;
    }
    if (args.where?.OR) {
      const values = args.where.OR.flatMap((entry: any) => [entry.id, entry.providerCallId]).filter(Boolean);
      const attempt = this.attempts.find(
        (item) => values.includes(item.id) || values.includes(item.providerCallId),
      );
      return attempt ? this.cloneAttempt(attempt) : null;
    }
    return null;
  }

  private updateAttempt(args: any): AttemptRecord {
    const attempt = this.attempts.find((item) => item.id === args.where.id);
    if (!attempt) throw new Error(`Attempt not found: ${args.where.id}`);
    applyData(attempt, args.data);
    return this.cloneAttempt(attempt);
  }

  private createTranscript(args: any): TranscriptRecord {
    const transcript = {
      id: `transcript-${++this.transcriptSeq}`,
      taskId: args.data.taskId,
      attemptId: args.data.attemptId ?? null,
      role: args.data.role,
      content: args.data.content,
      timestamp: args.data.timestamp,
      emotion: args.data.emotion ?? null,
      externalId: args.data.externalId ?? null,
      createdAt: now,
    };
    this.transcripts.push(transcript);
    return transcript;
  }

  private createEvent(args: any): EventRecord {
    const event = {
      id: `event-${++this.eventSeq}`,
      taskId: args.data.taskId,
      attemptId: args.data.attemptId ?? null,
      type: args.data.type,
      payload: args.data.payload ?? {},
      createdAt: now,
    };
    this.events.push(event);
    return event;
  }

  private createOutbox(args: any): OutboxRecord {
    const event = {
      id: `outbox-${++this.outboxSeq}`,
      aggregateType: args.data.aggregateType,
      aggregateId: args.data.aggregateId,
      type: args.data.type,
      payload: args.data.payload ?? {},
      status: 'pending',
      attempts: 0,
      availableAt: now,
      processedAt: null,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      deduplicationKey: args.data.deduplicationKey ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.outboxEvents.push(event);
    return event;
  }

  private findOutbox(args: any): OutboxRecord[] {
    const status = args.where?.status;
    const availableAt = args.where?.availableAt?.lte as Date | undefined;
    return this.outboxEvents
      .filter((event) => (!status || event.status === status) && (!availableAt || event.availableAt <= availableAt))
      .slice(0, args.take ?? this.outboxEvents.length);
  }

  private updateManyOutbox(args: any): { count: number } {
    let count = 0;
    for (const event of this.outboxEvents) {
      if (args.where?.id && event.id !== args.where.id) continue;
      if (args.where?.status && event.status !== args.where.status) continue;
      applyData(event, args.data);
      count += 1;
    }
    return { count };
  }

  private updateOutbox(args: any): OutboxRecord {
    const event = this.outboxEvents.find((item) => item.id === args.where.id);
    if (!event) throw new Error(`Outbox event not found: ${args.where.id}`);
    applyData(event, args.data);
    return event;
  }

  private cloneTask(task: TaskRecord): any {
    const transcripts = this.transcripts.filter((item) => item.taskId === task.id);
    const attempts = this.attempts.filter((item) => item.taskId === task.id);
    return {
      ...task,
      flowVersion: task.flowVersionId ? flowVersion : null,
      transcripts,
      attempts,
      _count: { transcripts: transcripts.length },
    };
  }

  private cloneAttempt(attempt: AttemptRecord): AttemptRecord {
    return { ...attempt };
  }
}

function applyData(target: Record<string, any>, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (isIncrement(value)) {
      target[key] = (target[key] ?? 0) + value.increment;
      continue;
    }
    target[key] = value;
  }
}

function isIncrement(value: unknown): value is { increment: number } {
  return value !== null && typeof value === 'object' && 'increment' in value;
}

type TaskRecord = {
  id: string;
  to: string;
  from: string;
  scenario: string;
  variables: Record<string, unknown>;
  status: string;
  scheduledAt: Date;
  calledAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  outcome: string | null;
  recordingUrl: string | null;
  intentTags: string[];
  attemptCount: number;
  flowId: string | null;
  flowVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AttemptRecord = {
  id: string;
  taskId: string;
  attemptNo: number;
  providerCallId: string | null;
  status: string;
  startedAt: Date;
  ringingAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  hangupCause: string | null;
  recordingUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TranscriptRecord = {
  id: string;
  taskId: string;
  attemptId: string | null;
  role: string;
  content: string;
  timestamp: number;
  emotion: string | null;
  externalId: string | null;
  createdAt: Date;
};

type EventRecord = {
  id: string;
  taskId: string;
  attemptId: string | null;
  type: string;
  payload: unknown;
  createdAt: Date;
};

type OutboxRecord = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  availableAt: Date;
  processedAt: Date | null;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  deduplicationKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};
