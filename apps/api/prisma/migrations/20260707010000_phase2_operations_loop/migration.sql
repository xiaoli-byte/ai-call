-- Phase 2: operational loop, integrations, handoff, and contact strategy.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "strategy_config" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT,
  "content" TEXT NOT NULL,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "index_status" TEXT NOT NULL DEFAULT 'uploaded',
  "index_error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "indexed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "knowledge_documents_knowledge_base_id_index_status_idx"
  ON "knowledge_documents"("knowledge_base_id", "index_status");
CREATE INDEX IF NOT EXISTS "knowledge_documents_knowledge_base_id_version_idx"
  ON "knowledge_documents"("knowledge_base_id", "version");

CREATE TABLE IF NOT EXISTS "knowledge_retrieval_logs" (
  "id" TEXT NOT NULL,
  "knowledge_base_id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "results" JSONB NOT NULL DEFAULT '[]',
  "top_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "low_confidence" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'dashboard',
  "task_id" TEXT,
  "scenario_test_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_retrieval_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "knowledge_retrieval_logs_knowledge_base_id_created_at_idx"
  ON "knowledge_retrieval_logs"("knowledge_base_id", "created_at");
CREATE INDEX IF NOT EXISTS "knowledge_retrieval_logs_low_confidence_created_at_idx"
  ON "knowledge_retrieval_logs"("low_confidence", "created_at");

CREATE TABLE IF NOT EXISTS "scenario_test_runs" (
  "id" TEXT NOT NULL,
  "scenario_key" TEXT NOT NULL,
  "flow_id" UUID,
  "flow_version_id" UUID,
  "input" TEXT NOT NULL,
  "expected_outcome" TEXT,
  "model_output" TEXT NOT NULL,
  "node_path" JSONB NOT NULL DEFAULT '[]',
  "knowledge_hits" JSONB NOT NULL DEFAULT '[]',
  "result" TEXT NOT NULL DEFAULT 'warning',
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "risk_items" JSONB NOT NULL DEFAULT '[]',
  "golden" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scenario_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scenario_test_runs_scenario_key_created_at_idx"
  ON "scenario_test_runs"("scenario_key", "created_at");
CREATE INDEX IF NOT EXISTS "scenario_test_runs_flow_id_golden_idx"
  ON "scenario_test_runs"("flow_id", "golden");

ALTER TABLE "scenario_test_runs"
  ADD CONSTRAINT "scenario_test_runs_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "task_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scenario_test_runs"
  ADD CONSTRAINT "scenario_test_runs_flow_version_id_fkey"
  FOREIGN KEY ("flow_version_id") REFERENCES "task_flow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "integration_connectors" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "auth_type" TEXT NOT NULL DEFAULT 'none',
  "auth_config" JSONB NOT NULL DEFAULT '{}',
  "request_template" JSONB NOT NULL DEFAULT '{}',
  "response_mapping" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_test_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_connectors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "integration_connectors_type_enabled_idx"
  ON "integration_connectors"("type", "enabled");

CREATE TABLE IF NOT EXISTS "tool_call_logs" (
  "id" TEXT NOT NULL,
  "connector_id" TEXT,
  "source_type" TEXT,
  "source_id" TEXT,
  "task_id" TEXT,
  "attempt_id" TEXT,
  "status" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "request" JSONB NOT NULL DEFAULT '{}',
  "response" JSONB,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tool_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tool_call_logs_connector_id_created_at_idx"
  ON "tool_call_logs"("connector_id", "created_at");
CREATE INDEX IF NOT EXISTS "tool_call_logs_task_id_created_at_idx"
  ON "tool_call_logs"("task_id", "created_at");
CREATE INDEX IF NOT EXISTS "tool_call_logs_status_created_at_idx"
  ON "tool_call_logs"("status", "created_at");

ALTER TABLE "tool_call_logs"
  ADD CONSTRAINT "tool_call_logs_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "integration_connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "handoff_tickets" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "task_id" UUID NOT NULL,
  "call_attempt_id" UUID,
  "call_analysis_id" TEXT,
  "campaign_id" TEXT,
  "phone_number" TEXT NOT NULL,
  "customer_name" TEXT,
  "summary" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "risk_tags" JSONB NOT NULL DEFAULT '[]',
  "recommended_action" TEXT NOT NULL,
  "disposition" TEXT,
  "notes" TEXT,
  "assigned_to" TEXT,
  "callback_task_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "handoff_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "handoff_tickets_call_analysis_id_key"
  ON "handoff_tickets"("call_analysis_id");
CREATE INDEX IF NOT EXISTS "handoff_tickets_status_created_at_idx"
  ON "handoff_tickets"("status", "created_at");
CREATE INDEX IF NOT EXISTS "handoff_tickets_campaign_id_created_at_idx"
  ON "handoff_tickets"("campaign_id", "created_at");
CREATE INDEX IF NOT EXISTS "handoff_tickets_task_id_idx"
  ON "handoff_tickets"("task_id");

ALTER TABLE "handoff_tickets"
  ADD CONSTRAINT "handoff_tickets_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_tickets"
  ADD CONSTRAINT "handoff_tickets_call_attempt_id_fkey"
  FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "handoff_tickets"
  ADD CONSTRAINT "handoff_tickets_call_analysis_id_fkey"
  FOREIGN KEY ("call_analysis_id") REFERENCES "call_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "handoff_tickets"
  ADD CONSTRAINT "handoff_tickets_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "contact_attempt_history" (
  "id" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "phone_hash" TEXT NOT NULL,
  "campaign_id" TEXT,
  "campaign_lead_id" TEXT,
  "task_id" UUID,
  "attempt_id" UUID,
  "status" TEXT,
  "outcome" TEXT,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_attempt_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contact_attempt_history_phone_hash_attempted_at_idx"
  ON "contact_attempt_history"("phone_hash", "attempted_at");
CREATE INDEX IF NOT EXISTS "contact_attempt_history_campaign_id_attempted_at_idx"
  ON "contact_attempt_history"("campaign_id", "attempted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_attempt_history_attempt_id_key"
  ON "contact_attempt_history"("attempt_id");

ALTER TABLE "contact_attempt_history"
  ADD CONSTRAINT "contact_attempt_history_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_attempt_history"
  ADD CONSTRAINT "contact_attempt_history_campaign_lead_id_fkey"
  FOREIGN KEY ("campaign_lead_id") REFERENCES "campaign_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_attempt_history"
  ADD CONSTRAINT "contact_attempt_history_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_attempt_history"
  ADD CONSTRAINT "contact_attempt_history_attempt_id_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
