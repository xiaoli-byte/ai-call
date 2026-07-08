-- CALL-02: 核心业务表补 tenant_id（docs/authz-implementation-backlog.md）
-- 高风险迁移，严格「加列(nullable) → 回填 → 设非空+默认」三步走，纯增量、不加外键
-- （对齐 KB-01 的降风险决定）。tenant_id 默认值 'tenant_demo' 为临时桥接，
-- 待 CALL-03 CLS 注入 tenantId 后可去除。

-- 0) 确保共享默认租户存在（对齐 ai-knowledge BOOTSTRAP_TENANT_ID=tenant_demo）
INSERT INTO "tenants" ("id", "slug", "name", "status", "metadata", "created_at", "updated_at")
VALUES ('tenant_demo', 'demo', 'Demo 租户', 'active', '{}', now(), now())
ON CONFLICT ("id") DO NOTHING;

-- 每张目标表：加列(nullable) → 回填 → 设非空+默认 → 建索引

-- outbound_scenarios
ALTER TABLE "outbound_scenarios" ADD COLUMN "tenant_id" TEXT;
UPDATE "outbound_scenarios" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "outbound_scenarios" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "outbound_scenarios_tenant_id_idx" ON "outbound_scenarios" ("tenant_id");

-- task_flows
ALTER TABLE "task_flows" ADD COLUMN "tenant_id" TEXT;
UPDATE "task_flows" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "task_flows" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "task_flows_tenant_id_idx" ON "task_flows" ("tenant_id");

-- task_flow_versions
ALTER TABLE "task_flow_versions" ADD COLUMN "tenant_id" TEXT;
UPDATE "task_flow_versions" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "task_flow_versions" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "task_flow_versions_tenant_id_idx" ON "task_flow_versions" ("tenant_id");

-- outbound_tasks
ALTER TABLE "outbound_tasks" ADD COLUMN "tenant_id" TEXT;
UPDATE "outbound_tasks" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "outbound_tasks" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "outbound_tasks_tenant_id_idx" ON "outbound_tasks" ("tenant_id");

-- call_attempts
ALTER TABLE "call_attempts" ADD COLUMN "tenant_id" TEXT;
UPDATE "call_attempts" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "call_attempts" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "call_attempts_tenant_id_idx" ON "call_attempts" ("tenant_id");

-- campaigns
ALTER TABLE "campaigns" ADD COLUMN "tenant_id" TEXT;
UPDATE "campaigns" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "campaigns" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "campaigns_tenant_id_idx" ON "campaigns" ("tenant_id");

-- knowledge_documents
ALTER TABLE "knowledge_documents" ADD COLUMN "tenant_id" TEXT;
UPDATE "knowledge_documents" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "knowledge_documents" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "knowledge_documents_tenant_id_idx" ON "knowledge_documents" ("tenant_id");

-- transcript_turns
ALTER TABLE "transcript_turns" ADD COLUMN "tenant_id" TEXT;
UPDATE "transcript_turns" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "transcript_turns" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "transcript_turns_tenant_id_idx" ON "transcript_turns" ("tenant_id");

-- call_events
ALTER TABLE "call_events" ADD COLUMN "tenant_id" TEXT;
UPDATE "call_events" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "call_events" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "call_events_tenant_id_idx" ON "call_events" ("tenant_id");

-- call_analyses
ALTER TABLE "call_analyses" ADD COLUMN "tenant_id" TEXT;
UPDATE "call_analyses" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "call_analyses" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "call_analyses_tenant_id_idx" ON "call_analyses" ("tenant_id");

-- handoff_tickets
ALTER TABLE "handoff_tickets" ADD COLUMN "tenant_id" TEXT;
UPDATE "handoff_tickets" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "handoff_tickets" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "handoff_tickets_tenant_id_idx" ON "handoff_tickets" ("tenant_id");

-- campaign_leads
ALTER TABLE "campaign_leads" ADD COLUMN "tenant_id" TEXT;
UPDATE "campaign_leads" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "campaign_leads" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "campaign_leads_tenant_id_idx" ON "campaign_leads" ("tenant_id");

-- lead_import_batches
ALTER TABLE "lead_import_batches" ADD COLUMN "tenant_id" TEXT;
UPDATE "lead_import_batches" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "lead_import_batches" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "lead_import_batches_tenant_id_idx" ON "lead_import_batches" ("tenant_id");

-- contact_attempt_history
ALTER TABLE "contact_attempt_history" ADD COLUMN "tenant_id" TEXT;
UPDATE "contact_attempt_history" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "contact_attempt_history" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "contact_attempt_history_tenant_id_idx" ON "contact_attempt_history" ("tenant_id");

-- scenario_test_runs
ALTER TABLE "scenario_test_runs" ADD COLUMN "tenant_id" TEXT;
UPDATE "scenario_test_runs" SET "tenant_id" = 'tenant_demo' WHERE "tenant_id" IS NULL;
ALTER TABLE "scenario_test_runs" ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "tenant_id" SET DEFAULT 'tenant_demo';
CREATE INDEX "scenario_test_runs_tenant_id_idx" ON "scenario_test_runs" ("tenant_id");
