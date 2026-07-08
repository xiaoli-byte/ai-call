import { AclPerm } from '@xiaoli-byte/authz/acl';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * CALL-05：OutboundTask 的资源级 ACL（在 CALL-03 租户强制过滤之上再收紧一层）。
 *
 * 范围收窄自 backlog 原始描述「坐席仅见自己或本部门任务」——当前 User 无部门字段，
 * 故只做「创建者 + 显式 ResourceGrant 授权 + admin/super_admin 全见」，不做 DEPARTMENT
 * 主体。见 docs/authz-implementation-backlog.md CALL-05、@xiaoli-byte/authz 的 acl/ 模块。
 */
export const TASK_RESOURCE_TYPE = 'call_task';

/** 绕过任务 ACL、可见租户内全部任务的角色。admin 是 ai-call 当前实际的最高业务角色；
 * super_admin 是 @xiaoli-byte/authz 固定的跨系统超管角色名（ai-call 尚未指派给任何用户，
 * 为与 authz 包语义保持一致而预留）。 */
export const TASK_ACL_BYPASS_ROLES = ['admin', 'super_admin'];

export interface TaskAclSubject {
  userId?: string;
  roles: string[];
}

export function isTaskAclBypass(roles: readonly string[]): boolean {
  return roles.some((role) => TASK_ACL_BYPASS_ROLES.includes(role));
}

export function hasViewPerm(perms: number): boolean {
  return (perms & AclPerm.VIEW) === AclPerm.VIEW;
}

/** 查询当前主体（按 userId / roles）在 call_task 资源类型下持有的显式授权所需 where。 */
export function taskGrantWhere(subject: TaskAclSubject): Prisma.ResourceGrantWhereInput {
  const or: Prisma.ResourceGrantWhereInput[] = [];
  if (subject.userId) or.push({ subjectType: 'USER', subjectId: subject.userId });
  if (subject.roles.length > 0) or.push({ subjectType: 'ROLE', subjectId: { in: subject.roles } });
  return {
    resourceType: TASK_RESOURCE_TYPE,
    // 无 userId 也无 roles 时不应匹配任何授权行。
    OR: or.length > 0 ? or : [{ subjectId: '__none__' }],
  };
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
  if (!subject.userId || isTaskAclBypass(subject.roles)) return {};
  return {
    OR: [
      { ownerId: null },
      { ownerId: subject.userId },
      ...(grantedTaskIds.length > 0 ? [{ id: { in: [...grantedTaskIds] } }] : []),
    ],
  };
}
