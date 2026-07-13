import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scenario, TaskStatus } from '@ai-call/shared';
import { TasksService } from './tasks.service.js';

// 回归测试：已发布 flow 上的任务，音色（ttsConfig.voice/voicePersona）与人设
// （agentIdentity/communicationStyle/communicationStylePrompt）应跟随「实时场景」，
// 而非冻结在 TaskFlowVersion.scenarioSnapshot 里的旧快照值。
// 只有当实时场景被删除（scenarioConfig 关联为空）时，才回落到快照兜底。

const now = new Date('2026-07-13T00:00:00.000Z');

// scenarios.toDomain 用恒等映射：真实实现只是把 record 字段搬进领域对象，
// 这里直接透传，便于断言 toDomain 选取的是哪一份 scenarioConfig。
const scenarios = {
  resolveConfig: async () => undefined,
  get: async () => undefined,
  toDomain: (record: unknown) => record,
};

// 实时场景行（发布 flow 之后被改过音色 / 人设）——这是「新值」。
const liveScenarioRow = {
  id: 'scn-1',
  scenario: Scenario.ECOMMERCE,
  name: '电商',
  systemPrompt: 'sys',
  ttsConfig: { provider: 'qwen', voice: 'new-voice', voicePersona: 'new-persona' },
  agentIdentity: 'new-identity',
  communicationStyle: 'new-style',
  communicationStylePrompt: 'new-style-prompt',
};

// 冻结在 flow 版本里的旧快照——带 id、带 scenario/systemPrompt（isScenarioConfig 需要）。
const staleSnapshot = {
  id: 'scn-1',
  scenario: Scenario.ECOMMERCE,
  systemPrompt: 'sys',
  ttsConfig: { provider: 'qwen', voice: 'old-voice', voicePersona: 'old-persona' },
  agentIdentity: 'old-identity',
  communicationStyle: 'old-style',
  communicationStylePrompt: 'old-style-prompt',
};

function taskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    to: '+1001',
    from: '+1000',
    scenario: Scenario.ECOMMERCE,
    scenarioId: 'scn-1',
    variables: {},
    status: TaskStatus.PENDING,
    scheduledAt: now,
    calledAt: null,
    endedAt: null,
    duration: null,
    outcome: null,
    recordingUrl: null,
    intentTags: [],
    attemptCount: 0,
    flowId: 'flow-1',
    flowVersionId: 'fv-1',
    flowVersion: {
      id: 'fv-1',
      flowId: 'flow-1',
      version: 1,
      name: 'flow',
      description: '',
      scenarioId: 'scn-1',
      scenarioSnapshot: staleSnapshot,
      nodes: [],
      edges: [],
      createdAt: now,
    },
    transcripts: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('flow 任务的音色/人设跟随实时场景', () => {
  it('getContext 返回实时场景的 ttsConfig/agentIdentity，而非 flow 快照旧值', async () => {
    const prisma = {
      outboundTask: {
        findUnique: async () => taskRecord({ scenarioConfig: liveScenarioRow }),
      },
      callAttempt: {
        // getContext → resolveContext：任务存在即直接返回，不查 attempt。
        findFirst: async () => null,
      },
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const task = await service.getContext('task-1');
    const tts = task.scenarioConfig?.ttsConfig as { voice?: string; voicePersona?: string };

    assert.equal(tts?.voice, 'new-voice');
    assert.equal(tts?.voicePersona, 'new-persona');
    assert.equal(task.scenarioConfig?.agentIdentity, 'new-identity');
    assert.equal(task.scenarioConfig?.communicationStyle, 'new-style');
    assert.equal(task.scenarioConfig?.communicationStylePrompt, 'new-style-prompt');
    // 快照仍作为 flowVersion 上的独立字段保留（流程逻辑冻结），但不用于音色/人设。
    assert.equal(
      (task.flowVersion?.scenarioConfig as { agentIdentity?: string } | undefined)?.agentIdentity,
      'old-identity',
    );
  });

  it('实时场景被删除时回落到 flow 快照（scenarioConfig 关联为空）', async () => {
    const prisma = {
      outboundTask: {
        findUnique: async () => taskRecord({ scenarioId: null, scenarioConfig: null }),
      },
      callAttempt: { findFirst: async () => null },
    };
    const service = new TasksService(prisma as never, {} as never, scenarios as never, {} as never);

    const task = await service.getContext('task-1');
    const tts = task.scenarioConfig?.ttsConfig as { voice?: string };

    assert.equal(tts?.voice, 'old-voice');
    assert.equal(task.scenarioConfig?.agentIdentity, 'old-identity');
  });

  it('create：flow 任务把 scenarioId 绑定到快照里的实时场景 id，从而后续读取拿到实时值', async () => {
    let createdData: any;
    const prisma = {
      outboundTask: {
        create: async (args: any) => {
          createdData = args.data;
          // 模拟 Prisma：include.scenarioConfig 按 scenarioId 关联出「实时」场景行。
          return taskRecord({ scenarioId: args.data.scenarioId, scenarioConfig: liveScenarioRow });
        },
      },
    };
    const taskFlows = {
      resolvePublishedVersion: async () => ({
        id: 'fv-1',
        flowId: 'flow-1',
        version: 1,
        name: 'flow',
        description: '',
        scenarioId: 'scn-1',
        // resolveCreateScenario 优先用版本上的 scenarioConfig（快照，带 id）。
        scenarioConfig: staleSnapshot,
        nodes: [],
        edges: [],
        createdAt: now.toISOString(),
      }),
    };
    const service = new TasksService(prisma as never, taskFlows as never, scenarios as never, {} as never);

    const task = await service.create({ to: '+1001', flowId: 'flow-1' } as never);

    // 关键：任务被绑到实时场景 id，而不是仅存快照 → 后续 get 会读到实时音色/人设。
    assert.equal(createdData.scenarioId, 'scn-1');
    assert.equal((task.scenarioConfig?.ttsConfig as { voice?: string })?.voice, 'new-voice');
    assert.equal(task.scenarioConfig?.agentIdentity, 'new-identity');
  });

  it('create：旧版本快照不带 id 时，仍通过 flowVersion.scenarioId 绑定实时场景', async () => {
    // 覆盖「id-in-snapshot 机制之前发布的 flow」：快照里没有 id，
    // 但 publish 会写 version.scenarioId(=flow.scenarioId)，create 用 ?? 兜底。
    let createdData: any;
    const { id: _drop, ...snapshotWithoutId } = staleSnapshot;
    const prisma = {
      outboundTask: {
        create: async (args: any) => {
          createdData = args.data;
          return taskRecord({ scenarioId: args.data.scenarioId, scenarioConfig: liveScenarioRow });
        },
      },
    };
    const taskFlows = {
      resolvePublishedVersion: async () => ({
        id: 'fv-1',
        flowId: 'flow-1',
        version: 1,
        name: 'flow',
        description: '',
        scenarioId: 'scn-1',
        scenarioConfig: snapshotWithoutId,
        nodes: [],
        edges: [],
        createdAt: now.toISOString(),
      }),
    };
    const service = new TasksService(prisma as never, taskFlows as never, scenarios as never, {} as never);

    await service.create({ to: '+1001', flowId: 'flow-1' } as never);

    assert.equal(createdData.scenarioId, 'scn-1');
  });
});
