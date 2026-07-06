CREATE TABLE "campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "scenario" TEXT NOT NULL,
  "scenario_id" TEXT,
  "flow_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scheduled_at" TIMESTAMP(3),
  "concurrency_limit" INTEGER NOT NULL DEFAULT 3,
  "retry_policy" JSONB NOT NULL DEFAULT '{}',
  "end_condition" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_import_batches" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "filename" TEXT,
  "total_rows" INTEGER NOT NULL,
  "valid_rows" INTEGER NOT NULL,
  "invalid_rows" INTEGER NOT NULL,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaign_leads" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "row_number" INTEGER NOT NULL,
  "phone_number" TEXT NOT NULL,
  "display_name" TEXT,
  "variables" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'imported',
  "validation_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "call_analyses" (
  "id" TEXT NOT NULL,
  "call_attempt_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "outcome" TEXT,
  "refusal_reason" TEXT,
  "next_action" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL DEFAULT 'low',
  "compliance_flags" JSONB NOT NULL DEFAULT '[]',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "corrected_at" TIMESTAMP(3),
  "corrected_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "call_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_audit_logs" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "subject_type" TEXT,
  "subject_id" TEXT,
  "actor_id" TEXT,
  "actor_name" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "outbound_tasks" ADD COLUMN "campaign_id" TEXT;
ALTER TABLE "outbound_tasks" ADD COLUMN "campaign_lead_id" TEXT;

CREATE UNIQUE INDEX "campaign_leads_campaign_id_row_number_key" ON "campaign_leads"("campaign_id", "row_number");
CREATE UNIQUE INDEX "call_analyses_call_attempt_id_key" ON "call_analyses"("call_attempt_id");

CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");
CREATE INDEX "campaigns_scenario_created_at_idx" ON "campaigns"("scenario", "created_at");
CREATE INDEX "lead_import_batches_campaign_id_created_at_idx" ON "lead_import_batches"("campaign_id", "created_at");
CREATE INDEX "campaign_leads_campaign_id_status_idx" ON "campaign_leads"("campaign_id", "status");
CREATE INDEX "campaign_leads_batch_id_idx" ON "campaign_leads"("batch_id");
CREATE INDEX "call_analyses_task_id_idx" ON "call_analyses"("task_id");
CREATE INDEX "call_analyses_risk_level_created_at_idx" ON "call_analyses"("risk_level", "created_at");
CREATE INDEX "compliance_audit_logs_action_created_at_idx" ON "compliance_audit_logs"("action", "created_at");
CREATE INDEX "compliance_audit_logs_subject_type_subject_id_idx" ON "compliance_audit_logs"("subject_type", "subject_id");
CREATE INDEX "outbound_tasks_campaign_id_status_idx" ON "outbound_tasks"("campaign_id", "status");
CREATE INDEX "outbound_tasks_campaign_lead_id_idx" ON "outbound_tasks"("campaign_lead_id");

ALTER TABLE "lead_import_batches" ADD CONSTRAINT "lead_import_batches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "lead_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "call_analyses" ADD CONSTRAINT "call_analyses_call_attempt_id_fkey" FOREIGN KEY ("call_attempt_id") REFERENCES "call_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_analyses" ADD CONSTRAINT "call_analyses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_campaign_lead_id_fkey" FOREIGN KEY ("campaign_lead_id") REFERENCES "campaign_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
