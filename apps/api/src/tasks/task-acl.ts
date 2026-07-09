import type { Prisma } from '../generated/prisma/client.js';
import {
  ACL_BYPASS_ROLES,
  hasViewPerm,
  isAclBypass,
  resourceGrantWhere,
  type AclSubject,
} from '../common/resource-acl.js';

/**
 * CALL-05：OutboundTask 的资源级 ACL（在 CALL-03 租户强制过滤之上再收紧一层）。
 *
 * 范围收窄自 backlog 原始描述「坐席仅见自己或本部门任务」——当前 User 无部门字段，
 * 故只做「创建者 + 显式 ResourceGrant 授权 + admin/super_admin 全见」，不做 DEPARTMENT
 * 主体。通用判定原语见 `common/resource-acl.ts`（与 CALL-09 的 campaign 共用同一套）。
 */
export const TASK_RESOURCE_TYPE = 'call_task';

/** @deprecated 改用 `common/resource-acl.ts` 的 `ACL_BYPASS_ROLES`；此处为兼容旧引用保留别名。 */
export const TASK_ACL_BYPASS_ROLES = ACL_BYPASS_ROLES;

export type TaskAclSubject = AclSubject;

export function isTaskAclBypass(roles: readonly string[]): boolean {
  return isAclBypass(roles);
}

export { hasViewPerm };

/** 查询当前主体（按 userId / roles）在 call_task 资源类型下持有的显式授权所需 where。 */
export function taskGrantWhere(subject: TaskAclSubject): Prisma.ResourceGrantWhereInput {
  return resourceGrantWhere(TASK_RESOURCE_TYPE, subject);
}

/**
 * 构建任务列表查询的可见性 where 片段：
 * - 未认证（无 userId，理论上不会发生——本方法只在已登录端点调用）：不加限制。
 * - admin/super_admin：不加限制（租户内全见）。
 * - 其余：ownerId 为空（历史/系统创建，视为对租户内 task:read 持有者公开）
 *   OR ownerId 是自己 OR 命中显式授权（grantedTaskIds）。
 */
export function taskVisibilityWhere(
  subject: TaskAclSubject,
  grantedTaskIds: readonly string[],
): Prisma.OutboundTaskWhereInput {
  if (!subject.userId || isAclBypass(subject.roles)) return {};
  return {
    OR: [
      { ownerId: null },
      { ownerId: subject.userId },
      ...(grantedTaskIds.length > 0 ? [{ id: { in: [...grantedTaskIds] } }] : []),
    ],
  };
}
