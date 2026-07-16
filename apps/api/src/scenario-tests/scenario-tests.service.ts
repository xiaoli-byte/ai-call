import { Injectable } from '@nestjs/common';
import type {
  RunScenarioTestDto,
  ScenarioTestListPage,
  ScenarioTestRun,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScenariosService } from '../scenarios/scenarios.service.js';
import { TaskFlowsService } from '../task-flows/task-flows.service.js';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

@Injectable()
export class ScenarioTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scenarios: ScenariosService,
    private readonly flows: TaskFlowsService,
    private readonly knowledge: KnowledgeBaseService,
  ) {}

  async run(scenarioKey: string, dto: RunScenarioTestDto): Promise<ScenarioTestRun> {
    const scenario = await this.scenarios.get(scenarioKey);
    const flowResult = dto.flowId
      ? await this.flows.testFlow(dto.flowId, dto.input)
      : {
          flowId: undefined,
          flowName: scenario.name,
          nodeCount: 0,
          edgeCount: 0,
          entryNode: undefined,
          aiDialogNode: undefined,
          input: dto.input,
          reply: scenario.greeting,
        };
    const knowledgeBaseIds = scenario.knowledgeBaseIds?.length
      ? scenario.knowledgeBaseIds
      : scenario.knowledgeBaseId ? [scenario.knowledgeBaseId] : [];
    const knowledgeHits = knowledgeBaseIds.length > 0
      ? await this.knowledge.retrieveMany(knowledgeBaseIds, dto.input, 3)
      : [];
    const nodePath = [
      flowResult.entryNode,
      flowResult.aiDialogNode?.nodeId,
    ].filter((item): item is string => Boolean(item));
    const riskItems = buildRiskItems({
      input: dto.input,
      reply: flowResult.reply,
      expectedOutcome: dto.expectedOutcome,
      knowledgeHits,
      requiresKnowledge: knowledgeBaseIds.length > 0,
      scenario,
    });
    const score = Math.max(0, Math.min(100, 100 - riskItems.length * 25));
    const result = riskItems.some((item) => item.includes('未命中预期'))
      ? 'fail'
      : riskItems.length > 0
        ? 'warning'
        : 'pass';
    const record = await (this.prisma as any).scenarioTestRun.create({
      data: {
        scenarioKey: scenario.scenario,
        flowId: dto.flowId,
        flowVersionId: dto.flowVersionId,
        input: dto.input,
        expectedOutcome: dto.expectedOutcome,
        modelOutput: flowResult.reply,
        nodePath: toPrismaJson(nodePath),
        knowledgeHits: toPrismaJson(knowledgeHits),
        result,
        score,
        riskItems: toPrismaJson(riskItems),
        golden: dto.golden ?? false,
      },
    });
    return this.toDomain(record);
  }

  async list(scenarioKey: string): Promise<ScenarioTestListPage> {
    const records = await (this.prisma as any).scenarioTestRun.findMany({
      where: { scenarioKey },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const items: ScenarioTestRun[] = records.map((record: any) => this.toDomain(record));
    const passRate = items.length
      ? Math.round((items.filter((item) => item.result === 'pass').length / items.length) * 1000) / 10
      : 0;
    const golden = items.filter((item) => item.golden);
    const goldenCoverage = golden.length
      ? Math.round((golden.filter((item) => item.result === 'pass').length / golden.length) * 1000) / 10
      : 0;
    return {
      items,
      passRate,
      goldenCoverage,
      highRiskItems: [...new Set(items.flatMap((item: ScenarioTestRun) => item.riskItems))].slice(0, 8),
    };
  }

  private toDomain(record: any): ScenarioTestRun {
    return {
      id: record.id,
      scenarioKey: record.scenarioKey,
      flowId: record.flowId ?? undefined,
      flowVersionId: record.flowVersionId ?? undefined,
      input: record.input,
      expectedOutcome: record.expectedOutcome ?? undefined,
      modelOutput: record.modelOutput,
      nodePath: Array.isArray(record.nodePath) ? record.nodePath.map(String) : [],
      knowledgeHits: Array.isArray(record.knowledgeHits)
        ? record.knowledgeHits.map((item: any) => ({
            id: String(item.id),
            documentId: item.documentId,
            content: String(item.content ?? ''),
            source: String(item.source ?? ''),
            score: Number(item.score ?? 0),
          }))
        : [],
      result: record.result,
      score: Number(record.score ?? 0),
      riskItems: Array.isArray(record.riskItems) ? record.riskItems.map(String) : [],
      golden: Boolean(record.golden),
      createdAt: record.createdAt.toISOString(),
    };
  }
}

function buildRiskItems(input: {
  input: string;
  reply: string;
  expectedOutcome?: string;
  knowledgeHits: Array<{ score?: number }>;
  requiresKnowledge?: boolean;
  scenario: { escalationRules?: Array<{ keywords?: string[] }> };
}): string[] {
  const risks: string[] = [];
  const reply = input.reply.toLowerCase();
  if (input.expectedOutcome === 'handoff' && !/人工|专员|转接|跟进/.test(reply)) {
    risks.push('未命中预期转人工结果');
  }
  const topScore = Number(input.knowledgeHits[0]?.score ?? 0);
  if (input.requiresKnowledge && (input.knowledgeHits.length === 0 || topScore < 0.35)) {
    risks.push('知识库检索置信度低');
  }
  const shouldEscalate = input.scenario.escalationRules?.some((rule) =>
    rule.keywords?.some((keyword) => input.input.includes(keyword)),
  );
  if (shouldEscalate && !/人工|专员|转接|跟进/.test(reply)) {
    risks.push('命中转人工规则但回复未提示人工承接');
  }
  return risks;
}
