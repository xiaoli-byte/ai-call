import {
  CANONICAL_ROLES,
  KB_ROLES,
  TO_KB_ROLE,
  resolveKbRole,
} from '@xiaoli-byte/authz/core';
import { ForbiddenException } from '@nestjs/common';

/**
 * ai-call 的数据库角色（含历史 `admin`）在调用 ai-knowledge 前统一投影为 KB 词表。
 *
 * 此处只消费共享包的词表与映射，禁止再维护一份 operator → editor 等别名逻辑。
 * 保留导出的可识别集合仅供诊断/测试使用；真正的判定以 resolveKbRole 为准。
 */
export const KNOWN_CROSS_SYSTEM_ROLES = new Set([
  ...CANONICAL_ROLES,
  ...KB_ROLES,
  ...Object.keys(TO_KB_ROLE),
]);

/**
 * 返回传给 ai-knowledge 的单一有效角色（最高权限优先）。
 *
 * 空数组代表系统任务/未携带用户角色，仍可按服务账号的租户公开语料执行检索；
 * 任何词表外角色则直接拒绝，避免把未知联合身份静默降级成 viewer。
 */
export function resolveKnowledgeRoleClaims(roles: readonly string[]): string[] {
  if (roles.length === 0) return [];
  const resolved = resolveKbRole(roles);
  if (resolved.unknown.length > 0) {
    throw new ForbiddenException(
      `跨系统角色无法识别：${resolved.unknown.join(', ')}`,
    );
  }
  return resolved.role ? [resolved.role] : [];
}
