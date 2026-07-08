-- CALL-05: 接入 ResourceGrant 数据级 ACL（docs/authz-implementation-backlog.md）
-- 纯增量迁移：新增可空列 + 新表，不改动既有列的非空约束，无需三步走。
-- outbound_tasks.owner_id 为 null 时视为「历史/系统创建」，对租户内 task:read
-- 持有者可见，与本次接入 ACL 之前的行为保持一致；仅新建任务的 owner 收紧可见范围。

-- outbound_tasks: 记录创建该任务的用户
ALTER TABLE "outbound_tasks" ADD COLUMN "owner_id" UUID;
CREATE INDEX "outbound_tasks_owner_id_idx" ON "outbound_tasks" ("owner_id");

-- resource_grants: 通用资源级显式授权表（对齐 @xiaoli-byte/authz 的 acl/ 模块）
CREATE TABLE "resource_grants" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL DEFAULT 'tenant_demo',
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "perms" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resource_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resource_grants_tenant_id_resource_type_resource_id_idx" ON "resource_grants" ("tenant_id", "resource_type", "resource_id");
CREATE INDEX "resource_grants_tenant_id_idx" ON "resource_grants" ("tenant_id");
