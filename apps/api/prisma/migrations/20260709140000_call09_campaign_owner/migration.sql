-- CALL-09: Campaign 复用 ResourceGrant 数据级 ACL（对齐 CALL-05 的 OutboundTask）。
-- 纯增量：加可空 owner_id + 索引，不改既有列。owner_id 为 null 视为「历史/系统创建」，
-- 对租户内 campaign:read 持有者可见，与接入 ACL 之前的行为一致；仅新建活动的创建者收紧。

ALTER TABLE "campaigns" ADD COLUMN "owner_id" UUID;
CREATE INDEX "campaigns_owner_id_idx" ON "campaigns" ("owner_id");
