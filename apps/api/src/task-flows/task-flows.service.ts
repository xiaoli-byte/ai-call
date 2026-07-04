import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FlowStatus, validateFlowDefinition } from '@ai-call/shared';
import type {
  ChatMessage,
  FlowEdge,
  FlowNode,
  TaskFlow,
  TaskFlowVersion,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { toPrismaJson } from '../common/prisma-json.js';
import type { CreateTaskFlowDto } from './dto/create-task-flow.dto.js';
import type { UpdateTaskFlowDto } from './dto/update-task-flow.dto.js';

/**
 * 外呼任务流程 Service
 *
 * 持久化 TaskFlow 到 PostgreSQL，由 Prisma 负责数据访问。
 * nodes/edges 以 JSONB 存储，读出时 cast 为 FlowNode[]/FlowEdge[]。
 */
@Injectable()
export class TaskFlowsService {
  private readonly logger = new Logger(TaskFlowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async create(dto: CreateTaskFlowDto): Promise<TaskFlow> {
    const record = await this.prisma.taskFlow.create({
      data: {
        name: dto.name,
        description: dto.description ?? '',
        status: FlowStatus.DRAFT,
        nodes: toPrismaJson(dto.nodes ?? []),
        edges: toPrismaJson(dto.edges ?? []),
      },
    });
    this.logger.log(`created task-flow id=${record.id} name=${record.name}`);
    return this.toDomain(record);
  }

  async list(filter: { status?: FlowStatus } = {}): Promise<TaskFlow[]> {
    const records = await this.prisma.taskFlow.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async get(id: string): Promise<TaskFlow> {
    const record = await this.prisma.taskFlow.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`TaskFlow ${id} not found`);
    return this.toDomain(record);
  }

  async update(id: string, dto: UpdateTaskFlowDto): Promise<TaskFlow> {
    const current = await this.get(id);
    if (current.status === FlowStatus.ARCHIVED) {
      throw new BadRequestException('Archived flows cannot be edited');
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.nodes !== undefined) data.nodes = toPrismaJson(dto.nodes);
    if (dto.edges !== undefined) data.edges = toPrismaJson(dto.edges);
    if (
      current.status === FlowStatus.PUBLISHED &&
      (dto.name !== undefined || dto.description !== undefined || dto.nodes !== undefined || dto.edges !== undefined)
    ) {
      data.status = FlowStatus.DRAFT;
    }

    const record = await this.prisma.taskFlow.update({
      where: { id },
      data,
    });
    this.logger.log(`updated task-flow id=${id}`);
    return this.toDomain(record);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.taskFlow.delete({ where: { id } });
    this.logger.log(`deleted task-flow id=${id}`);
  }

  /** 发布流程：校验草稿并创建不可变快照。 */
  async publish(id: string): Promise<TaskFlow> {
    const source = await this.get(id);
    const issues = validateFlowDefinition(source);
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Flow validation failed',
        issues,
      });
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.taskFlow.update({
        where: { id },
        data: { status: FlowStatus.PUBLISHED, version: { increment: 1 } },
      });
      await tx.taskFlowVersion.create({
        data: {
          flowId: id,
          version: updated.version,
          name: updated.name,
          description: updated.description,
          nodes: toPrismaJson(updated.nodes),
          edges: toPrismaJson(updated.edges),
        },
      });
      return updated;
    });
    this.logger.log(
      `published task-flow id=${id} version=${record.version}`,
    );
    return this.toDomain(record);
  }

  async getVersion(id: string): Promise<TaskFlowVersion> {
    const record = await this.prisma.taskFlowVersion.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`TaskFlowVersion ${id} not found`);
    return this.toVersionDomain(record);
  }

  async listVersions(flowId: string): Promise<TaskFlowVersion[]> {
    await this.get(flowId);
    const records = await this.prisma.taskFlowVersion.findMany({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
    return records.map((record) => this.toVersionDomain(record));
  }

  async resolvePublishedVersion(flowId: string): Promise<TaskFlowVersion> {
    const record = await this.prisma.taskFlowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
    if (!record) {
      throw new BadRequestException(`TaskFlow ${flowId} has no published version`);
    }
    return this.toVersionDomain(record);
  }

  /** 归档流程：status → archived */
  async archive(id: string): Promise<TaskFlow> {
    await this.get(id);
    const record = await this.prisma.taskFlow.update({
      where: { id },
      data: { status: FlowStatus.ARCHIVED },
    });
    this.logger.log(`archived task-flow id=${id}`);
    return this.toDomain(record);
  }

  /** 复制流程（基于现有流程创建新草稿） */
  async duplicate(id: string): Promise<TaskFlow> {
    const source = await this.get(id);
    const record = await this.prisma.taskFlow.create({
      data: {
        name: `${source.name} (副本)`,
        description: source.description,
        status: FlowStatus.DRAFT,
        nodes: toPrismaJson(source.nodes),
        edges: toPrismaJson(source.edges),
      },
    });
    this.logger.log(`duplicated task-flow from=${id} to=${record.id}`);
    return this.toDomain(record);
  }

  /**
   * 旧版 AI 节点预览：找到首个 AI 对话节点，用其 systemPrompt 调 LLM 生成回复。
   *
   * 完整流程模拟由 Voice Agent 的 /text-test 执行，确保按节点和连线推进。
   * 此端点仅保留用于兼容旧的单节点 AI 预览。
   */
  async testFlow(
    id: string,
    input: string,
  ): Promise<{
    flowId: string;
    flowName: string;
    nodeCount: number;
    edgeCount: number;
    entryNode?: string;
    aiDialogNode?: { nodeId: string; systemPrompt?: string; prompt?: string };
    input: string;
    reply: string;
  }> {
    const flow = await this.get(id);
    const entry = flow.nodes.find((n) => n.type === 'start');
    const aiNode = flow.nodes.find(
      (n) =>
        n.type === 'dialog' &&
        (n.data as { mode?: string }).mode === 'ai',
    );

    const aiData = aiNode?.data as
      | { systemPrompt?: string; prompt?: string; temperature?: number }
      | undefined;

    let reply = '';
    if (!aiNode) {
      reply = `流程"${flow.name}"未包含 AI 对话节点，无法生成回复。`;
    } else if (!input.trim()) {
      reply = `已定位到 AI 对话节点 #${aiNode.id}，请输入文本以测试回复。`;
    } else {
      const messages: ChatMessage[] = [
        { role: 'user', content: input },
      ];
      const systemPrompt = aiData?.systemPrompt
        ? String(aiData.systemPrompt)
        : undefined;
      try {
        reply = await this.llm.chat(messages, {
          systemPrompt,
          temperature: aiData?.temperature,
        });
      } catch (err) {
        this.logger.error(
          `testFlow LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        reply = `LLM 调用失败：${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return {
      flowId: flow.id,
      flowName: flow.name,
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      entryNode: entry?.id,
      aiDialogNode: aiNode
        ? {
            nodeId: aiNode.id,
            systemPrompt: aiData?.systemPrompt,
            prompt: aiData?.prompt,
          }
        : undefined,
      input,
      reply,
    };
  }

  /** Prisma 记录 → 领域模型 */
  private toDomain(record: {
    id: string;
    name: string;
    description: string;
    status: string;
    nodes: unknown;
    edges: unknown;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): TaskFlow {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      status: record.status as FlowStatus,
      nodes: (record.nodes ?? []) as FlowNode[],
      edges: (record.edges ?? []) as FlowEdge[],
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toVersionDomain(record: {
    id: string;
    flowId: string;
    version: number;
    name: string;
    description: string;
    nodes: unknown;
    edges: unknown;
    createdAt: Date;
  }): TaskFlowVersion {
    return {
      id: record.id,
      flowId: record.flowId,
      version: record.version,
      name: record.name,
      description: record.description,
      nodes: (record.nodes ?? []) as FlowNode[],
      edges: (record.edges ?? []) as FlowEdge[],
      createdAt: record.createdAt.toISOString(),
    };
  }
}
