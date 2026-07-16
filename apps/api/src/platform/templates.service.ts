import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FlowStatus,
  ScenarioStatus,
  type CloneTemplateDto,
  type CloneTemplateResult,
  type IndustryTemplate,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrismaJson } from '../common/prisma-json.js';
import { INDUSTRY_TEMPLATES, templateDefaultGreeting } from './industry-templates.js';
import {
  envProvider,
  normalizeScenarioKey,
} from './platform-utils.js';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates(): IndustryTemplate[] {
    return INDUSTRY_TEMPLATES;
  }

  async cloneTemplate(id: string, dto: CloneTemplateDto = {}): Promise<CloneTemplateResult> {
    const template = INDUSTRY_TEMPLATES.find((item) => item.id === id);
    if (!template) throw new BadRequestException(`Template ${id} not found`);

    const name = (dto.name?.trim() || template.name).slice(0, 80);
    const scenarioKey = await this.nextScenarioKey(dto.scenarioKey || template.scenarioKey);
    const publish = dto.publish ?? true;

    return this.prisma.$transaction(async (tx: any) => {
      const scenario = await tx.outboundScenario.create({
        data: {
          scenario: scenarioKey,
          name,
          description: template.description,
          status: ScenarioStatus.ACTIVE,
          ttsConfig: toPrismaJson({ provider: envProvider('TTS_PROVIDER', 'mock') }),
          agentIdentity: 'AI outbound assistant',
          communicationStyle: 'professional',
          communicationStylePrompt: 'Professional, concise, and transparent about AI identity.',
          businessGoal: template.successMetrics.join('\n'),
          llmConstraints: toPrismaJson([
            'Disclose AI identity at the beginning of the call.',
            'Stop persuasion when the user clearly refuses further contact.',
            ...template.complianceNotes,
          ]),
          systemPrompt: `${template.name}\n${template.description}`,
          greeting: templateDefaultGreeting(template),
          knowledgeBaseId: '',
          knowledgeBaseIds: [],
          allowedTools: toPrismaJson(['crm', 'sms', 'api', 'transfer']),
          escalationRules: toPrismaJson(template.qualityRules.map((rule) => ({ condition: rule, action: 'handoff' }))),
        },
      });
      const flow = await tx.taskFlow.create({
        data: {
          name: `${name} Flow`,
          description: `${template.industry} template cloned from Template Center`,
          scenarioId: scenario.id,
          status: publish ? FlowStatus.PUBLISHED : FlowStatus.DRAFT,
          version: publish ? 1 : 0,
          nodes: toPrismaJson(template.nodes),
          edges: toPrismaJson(template.edges),
        },
      });
      const versionId = publish
        ? await createPublishedVersion(tx, scenario, flow, template)
        : undefined;
      await tx.outboundScenario.update({
        where: { id: scenario.id },
        data: { defaultFlowId: flow.id },
      });
      return {
        templateId: template.id,
        scenarioId: scenario.id,
        scenarioKey: scenario.scenario,
        flowId: flow.id,
        flowVersionId: versionId,
      };
    });
  }

  private async nextScenarioKey(input: string): Promise<string> {
    const base = normalizeScenarioKey(input);
    for (let i = 0; i < 100; i += 1) {
      const candidate = i === 0 ? base : `${base}_${i + 1}`;
      const existing = await this.prisma.outboundScenario.findUnique({
        where: { scenario: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    return `${base}_${Date.now()}`;
  }
}

async function createPublishedVersion(
  tx: any,
  scenario: any,
  flow: any,
  template: IndustryTemplate,
): Promise<string> {
  const version = await tx.taskFlowVersion.create({
    data: {
      flowId: flow.id,
      version: 1,
      name: flow.name,
      description: flow.description,
      scenarioId: scenario.id,
      scenarioSnapshot: toPrismaJson({
        id: scenario.id,
        scenario: scenario.scenario,
        name: scenario.name,
        description: scenario.description,
        status: scenario.status,
        systemPrompt: scenario.systemPrompt,
        greeting: scenario.greeting,
        knowledgeBaseId: scenario.knowledgeBaseId,
        knowledgeBaseIds: scenario.knowledgeBaseIds,
        allowedTools: ['crm', 'sms', 'api', 'transfer'],
        escalationRules: template.qualityRules.map((rule) => ({ condition: rule, action: 'handoff' })),
      }),
      nodes: toPrismaJson(template.nodes),
      edges: toPrismaJson(template.edges),
    },
  });
  return version.id;
}
