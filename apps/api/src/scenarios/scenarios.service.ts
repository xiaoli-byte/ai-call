import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FlowStatus,
  SCENARIO_CONFIGS,
  ScenarioStatus,
  type CreateScenarioDto as SharedCreateScenarioDto,
  type ScenarioConfig,
  type TtsVoiceConfig,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../common/prisma-json.js';

type ScenarioRecord = {
  id: string;
  scenario: string;
  name: string;
  description: string;
  status: string;
  ttsConfig: unknown;
  agentIdentity: string;
  communicationStyle: string;
  communicationStylePrompt: string;
  businessGoal: string;
  llmConstraints: unknown;
  systemPrompt: string;
  greeting: string;
  knowledgeBaseId: string;
  allowedTools: unknown;
  escalationRules: unknown;
  defaultFlowId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScenarioUpdateInput = Partial<Omit<SharedCreateScenarioDto, 'defaultFlowId'>> & {
  defaultFlowId?: string | null;
};

@Injectable()
export class ScenariosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ScenarioConfig[]> {
    const records = await this.prisma.outboundScenario.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const byScenario = new Map(records.map((record) => [record.scenario, this.toDomain(record)]));
    for (const config of Object.values(SCENARIO_CONFIGS)) {
      if (!byScenario.has(config.scenario)) {
        byScenario.set(config.scenario, this.withEffectivePrompt(config));
      }
    }
    return [...byScenario.values()].sort((a, b) => {
      const statusRank = (a.status ?? ScenarioStatus.ACTIVE) === ScenarioStatus.ACTIVE ? 0 : 1;
      const otherRank = (b.status ?? ScenarioStatus.ACTIVE) === ScenarioStatus.ACTIVE ? 0 : 1;
      return statusRank - otherRank || a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  async get(identifier: string): Promise<ScenarioConfig> {
    const record = await this.findRecord(identifier);
    if (record) return this.toDomain(record);
    const builtin = this.findBuiltin(identifier);
    if (builtin) return this.withEffectivePrompt(builtin);
    throw new NotFoundException(`Scenario ${identifier} not found`);
  }

  async create(dto: SharedCreateScenarioDto): Promise<ScenarioConfig> {
    const existing = await this.prisma.outboundScenario.findUnique({
      where: { scenario: dto.scenario },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(`Scenario key ${dto.scenario} already exists`);
    }
    await this.assertSelectablePublishedFlow(dto.defaultFlowId);
    const record = await this.prisma.outboundScenario.create({
      data: this.toCreateData(dto) as any,
    });
    return this.toDomain(record);
  }

  async update(identifier: string, dto: ScenarioUpdateInput): Promise<ScenarioConfig> {
    await this.assertSelectablePublishedFlow(dto.defaultFlowId);
    const record = await this.findRecord(identifier);
    const target = record ?? await this.materializeBuiltin(identifier);
    const updated = await this.prisma.outboundScenario.update({
      where: { id: target.id },
      data: this.toUpdateData(dto),
    });
    return this.toDomain(updated);
  }

  async deactivate(identifier: string): Promise<ScenarioConfig> {
    const record = await this.findRecord(identifier);
    if (!record) throw new NotFoundException(`Scenario ${identifier} not found`);
    const updated = await this.prisma.outboundScenario.update({
      where: { id: record.id },
      data: { status: ScenarioStatus.INACTIVE },
    });
    return this.toDomain(updated);
  }

  async resolveConfig(identifier: string | undefined): Promise<ScenarioConfig | undefined> {
    if (!identifier) return undefined;
    try {
      return await this.get(identifier);
    } catch (err) {
      if (err instanceof NotFoundException) return undefined;
      throw err;
    }
  }

  toDomain(record: ScenarioRecord): ScenarioConfig {
    return this.withEffectivePrompt({
      id: record.id,
      scenario: record.scenario,
      name: record.name,
      description: record.description,
      status: record.status as ScenarioConfig['status'],
      ttsConfig: asTtsConfig(record.ttsConfig),
      agentIdentity: record.agentIdentity,
      communicationStyle: record.communicationStyle,
      communicationStylePrompt: record.communicationStylePrompt,
      businessGoal: record.businessGoal,
      llmConstraints: asStringArray(record.llmConstraints),
      systemPrompt: record.systemPrompt,
      greeting: record.greeting,
      knowledgeBaseId: record.knowledgeBaseId,
      allowedTools: asStringArray(record.allowedTools),
      escalationRules: Array.isArray(record.escalationRules)
        ? record.escalationRules as ScenarioConfig['escalationRules']
        : [],
      defaultFlowId: record.defaultFlowId ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  }

  private async findRecord(identifier: string): Promise<ScenarioRecord | null> {
    return await this.prisma.outboundScenario.findFirst({
      where: { OR: [{ id: identifier }, { scenario: identifier }] },
    });
  }

  private findBuiltin(identifier: string): ScenarioConfig | undefined {
    return Object.values(SCENARIO_CONFIGS).find(
      (config) => config.scenario === identifier || config.id === identifier,
    );
  }

  private async materializeBuiltin(identifier: string): Promise<ScenarioRecord> {
    const builtin = this.findBuiltin(identifier);
    if (!builtin) throw new NotFoundException(`Scenario ${identifier} not found`);
    return await this.prisma.outboundScenario.create({
      data: this.toCreateData(builtin) as any,
    });
  }

  private async assertSelectablePublishedFlow(flowId: string | null | undefined): Promise<void> {
    if (!flowId) return;
    const flow = await this.prisma.taskFlow.findUnique({
      where: { id: flowId },
      select: { status: true, version: true },
    });
    const hasPublishedVersion = Boolean(
      flow
      && flow.status !== FlowStatus.ARCHIVED
      && (flow.status === FlowStatus.PUBLISHED || flow.version > 0),
    );
    if (!hasPublishedVersion) {
      throw new BadRequestException('外呼流程只能绑定已发布且未归档的版本');
    }
  }

  private toCreateData(dto: SharedCreateScenarioDto): Record<string, unknown> {
    return {
      scenario: dto.scenario,
      name: dto.name,
      description: dto.description ?? '',
      status: dto.status ?? ScenarioStatus.ACTIVE,
      ttsConfig: toPrismaJson(dto.ttsConfig ?? {}),
      agentIdentity: dto.agentIdentity ?? '',
      communicationStyle: dto.communicationStyle ?? '',
      communicationStylePrompt: dto.communicationStylePrompt ?? '',
      businessGoal: dto.businessGoal ?? '',
      llmConstraints: toPrismaJson(dto.llmConstraints ?? []),
      systemPrompt: dto.systemPrompt ?? '',
      greeting: dto.greeting ?? '',
      knowledgeBaseId: dto.knowledgeBaseId ?? '',
      allowedTools: toPrismaJson(dto.allowedTools ?? []),
      escalationRules: toPrismaJson(dto.escalationRules ?? []),
      defaultFlowId: dto.defaultFlowId || null,
    };
  }

  private toUpdateData(dto: ScenarioUpdateInput): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (dto.scenario !== undefined) data.scenario = dto.scenario;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.ttsConfig !== undefined) data.ttsConfig = toPrismaJson(dto.ttsConfig);
    if (dto.agentIdentity !== undefined) data.agentIdentity = dto.agentIdentity;
    if (dto.communicationStyle !== undefined) data.communicationStyle = dto.communicationStyle;
    if (dto.communicationStylePrompt !== undefined) {
      data.communicationStylePrompt = dto.communicationStylePrompt;
    }
    if (dto.businessGoal !== undefined) data.businessGoal = dto.businessGoal;
    if (dto.llmConstraints !== undefined) data.llmConstraints = toPrismaJson(dto.llmConstraints);
    if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
    if (dto.greeting !== undefined) data.greeting = dto.greeting;
    if (dto.knowledgeBaseId !== undefined) data.knowledgeBaseId = dto.knowledgeBaseId;
    if (dto.allowedTools !== undefined) data.allowedTools = toPrismaJson(dto.allowedTools);
    if (dto.escalationRules !== undefined) data.escalationRules = toPrismaJson(dto.escalationRules);
    if (dto.defaultFlowId !== undefined) data.defaultFlowId = dto.defaultFlowId || null;
    return data;
  }

  private withEffectivePrompt(config: ScenarioConfig): ScenarioConfig {
    const sections: string[] = [];
    if (config.agentIdentity) sections.push(`【当前身份】${config.agentIdentity}`);
    if (config.communicationStylePrompt) {
      sections.push(`【沟通风格】${config.communicationStylePrompt}`);
    } else if (config.communicationStyle) {
      sections.push(`【沟通风格】${config.communicationStyle}`);
    }
    if (config.businessGoal) sections.push(`【业务目标】${config.businessGoal}`);
    if (config.llmConstraints?.length) {
      sections.push(`【生成约束】\n${config.llmConstraints.map((item) => `- ${item}`).join('\n')}`);
    }
    const effective = [config.systemPrompt, ...sections]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
    return {
      ...config,
      status: config.status ?? ScenarioStatus.ACTIVE,
      systemPrompt: effective,
    };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asTtsConfig(value: unknown): TtsVoiceConfig {
  const source = asObject(value);
  return {
    voice: typeof source.voice === 'string' ? source.voice : undefined,
    voiceCloneId: typeof source.voiceCloneId === 'string' ? source.voiceCloneId : undefined,
    provider: typeof source.provider === 'string' ? source.provider : undefined,
    age: typeof source.age === 'string' ? source.age : undefined,
    gender: typeof source.gender === 'string' ? source.gender : undefined,
    speakingRate: typeof source.speakingRate === 'number' ? source.speakingRate : undefined,
    pitch: typeof source.pitch === 'number' ? source.pitch : undefined,
    stylePrompt: typeof source.stylePrompt === 'string' ? source.stylePrompt : undefined,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
