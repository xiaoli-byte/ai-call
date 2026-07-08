import { ForbiddenException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { Prisma } from '../generated/prisma/client.js';
import { TENANT_CLS_KEY, SYSTEM_BYPASS_CLS_KEY } from './system-context.js';

/**
 * 需要强制租户隔离的业务模型（CALL-02 已给它们加了 tenant_id 列）。
 * 名称为 Prisma 模型名（PascalCase），与 `$allOperations` 回调里的 `model` 对齐。
 */
export const TENANT_MODELS = new Set<string>([
  'OutboundScenario',
  'TaskFlow',
  'TaskFlowVersion',
  'OutboundTask',
  'CallAttempt',
  'Campaign',
  'KnowledgeDocument',
  'TranscriptTurn',
  'CallEvent',
  'CallAnalysis',
  'HandoffTicket',
  'CampaignLead',
  'LeadImportBatch',
  'ContactAttemptHistory',
  'ScenarioTestRun',
  // CALL-05：资源级 ACL 授权表，同样按租户强制过滤/注入。
  'ResourceGrant',
]);

/** 仅写入 data、无 where 的操作 */
const CREATE_OPS = new Set(['create']);
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
};

/**
 * 把 tenantId 强制注入到操作参数里：
 * - create：补 data.tenantId
 * - createMany：每行补 tenantId
 * - upsert：where 加 tenantId（依赖 Prisma 7 的 extendedWhereUnique GA）+ create 补 tenantId
 * - 其余含 where 的读/写（find 系列 / update / delete / updateMany / deleteMany /
 *   count / aggregate / groupBy）：where 合并 { tenantId }
 */
export function injectTenant(operation: string, rawArgs: unknown, tenantId: string): AnyArgs {
  const args: AnyArgs = { ...((rawArgs as AnyArgs) ?? {}) };

  if (CREATE_OPS.has(operation)) {
    const data = { ...((args.data as Record<string, unknown>) ?? {}) };
    if (data.tenantId == null) data.tenantId = tenantId;
    args.data = data;
    return args;
  }

  if (CREATE_MANY_OPS.has(operation)) {
    const rows = Array.isArray(args.data) ? args.data : args.data ? [args.data] : [];
    args.data = rows.map((r) => {
      const row = { ...(r as Record<string, unknown>) };
      if (row.tenantId == null) row.tenantId = tenantId;
      return row;
    });
    return args;
  }

  if (operation === 'upsert') {
    args.where = { ...(args.where ?? {}), tenantId };
    const create = { ...((args.create as Record<string, unknown>) ?? {}) };
    if (create.tenantId == null) create.tenantId = tenantId;
    args.create = create;
    return args;
  }

  // find*/update/delete/updateMany/deleteMany/count/aggregate/groupBy —— 全部合并到 where
  args.where = { ...(args.where ?? {}), tenantId };
  return args;
}

/** `$allOperations` 回调的入参（Prisma 未导出该泛型，这里取用到的字段）。 */
export interface TenantScopeParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => unknown;
}

/** 只读取 tenantId / bypass 标记的最小 CLS 契约（便于单测注入假实现）。 */
export interface TenantScopeCls {
  get<T = unknown>(key: string): T | undefined;
}

/**
 * 租户作用域决策核心（与 Prisma 解耦，便于单测）：
 *
 * - 非租户模型：放行。
 * - 系统上下文（runAsSystem 打了 bypass 标记）：放行。
 * - 有 tenantId：注入后放行。
 * - 无 tenantId 且非系统上下文：**抛错（fail-closed）**，避免静默跨租户访问。
 */
export function applyTenantScope(cls: TenantScopeCls, params: TenantScopeParams): unknown {
  const { model, operation, args, query } = params;
  if (!model || !TENANT_MODELS.has(model)) {
    return query(args);
  }
  if (cls.get(SYSTEM_BYPASS_CLS_KEY) === true) {
    return query(args);
  }
  const tenantId = cls.get<string | undefined>(TENANT_CLS_KEY);
  if (!tenantId) {
    throw new ForbiddenException(
      `缺少租户上下文，拒绝访问 ${model}.${operation}（CALL-03 fail-closed）`,
    );
  }
  return query(injectTenant(operation, args, tenantId));
}

/**
 * Prisma Client Extension：对 TENANT_MODELS 的所有操作强制注入 tenantId 过滤/赋值。
 */
export function createTenantExtension(cls: ClsService) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $allOperations(params: any) {
          // Prisma 的 query() 返回 Promise；applyTenantScope 直接透传其返回值。
          return applyTenantScope(cls, params) as Promise<unknown>;
        },
      },
    },
  });
}
