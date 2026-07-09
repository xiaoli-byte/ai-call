import type { Prisma } from '../generated/prisma/client.js';
import {
  isAclBypass,
  resourceGrantWhere,
  type AclSubject,
} from '../common/resource-acl.js';

/**
 * CALL-09：Campaign 的资源级 ACL，复用 CALL-05 的 `resource_grants` 表与判定原语
 * （`common/resource-acl.ts`），仅 resourceType 换成 'campaign'。语义与 call_task 同构：
 * 「创建者 + 显式授权 + admin/super_admin 全见」；ownerId 为空（历史/系统创建）对租户内
 * campaign:read 持有者公开。见 docs/authz-implementation-backlog.md CALL-09。
 */
export const CAMPAIGN_RESOURCE_TYPE = 'campaign';

export type CampaignAclSubject = AclSubject;

/** 当前主体在 campaign 资源类型下持有的显式授权所需 where。 */
export function campaignGrantWhere(subject: CampaignAclSubject): Prisma.ResourceGrantWhereInput {
  return resourceGrantWhere(CAMPAIGN_RESOURCE_TYPE, subject);
}

/**
 * 活动列表查询的可见性 where 片段（与 taskVisibilityWhere 同构）：
 * - 无 userId / admin / super_admin：不加限制（租户内全见）。
 * - 其余：ownerId 为空 OR ownerId 是自己 OR 命中显式授权（grantedCampaignIds）。
 */
export function campaignVisibilityWhere(
  subject: CampaignAclSubject,
  grantedCampaignIds: readonly string[],
): Prisma.CampaignWhereInput {
  if (!subject.userId || isAclBypass(subject.roles)) return {};
  return {
    OR: [
      { ownerId: null },
      { ownerId: subject.userId },
      ...(grantedCampaignIds.length > 0 ? [{ id: { in: [...grantedCampaignIds] } }] : []),
    ],
  };
}
