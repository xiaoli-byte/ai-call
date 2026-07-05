CREATE TABLE "outbound_scenarios" (
  "id" UUID NOT NULL,
  "scenario" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "tts_config" JSONB NOT NULL DEFAULT '{}',
  "agent_identity" TEXT NOT NULL DEFAULT '',
  "communication_style" TEXT NOT NULL DEFAULT '',
  "communication_style_prompt" TEXT NOT NULL DEFAULT '',
  "business_goal" TEXT NOT NULL DEFAULT '',
  "llm_constraints" JSONB NOT NULL DEFAULT '[]',
  "system_prompt" TEXT NOT NULL DEFAULT '',
  "greeting" TEXT NOT NULL DEFAULT '',
  "knowledge_base_id" TEXT NOT NULL DEFAULT '',
  "allowed_tools" JSONB NOT NULL DEFAULT '[]',
  "escalation_rules" JSONB NOT NULL DEFAULT '[]',
  "global_variables" JSONB NOT NULL DEFAULT '[]',
  "api_plugins" JSONB NOT NULL DEFAULT '[]',
  "default_flow_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbound_scenarios_scenario_key" ON "outbound_scenarios"("scenario");
CREATE INDEX "outbound_scenarios_status_updated_at_idx" ON "outbound_scenarios"("status", "updated_at");

ALTER TABLE "task_flows" ADD COLUMN "scenario_id" UUID;
ALTER TABLE "task_flow_versions" ADD COLUMN "scenario_id" UUID;
ALTER TABLE "task_flow_versions" ADD COLUMN "scenario_snapshot" JSONB;
ALTER TABLE "outbound_tasks" ADD COLUMN "scenario_id" UUID;

CREATE INDEX "outbound_tasks_scenario_id_idx" ON "outbound_tasks"("scenario_id");

ALTER TABLE "outbound_scenarios"
  ADD CONSTRAINT "outbound_scenarios_default_flow_id_fkey"
  FOREIGN KEY ("default_flow_id") REFERENCES "task_flows"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_flows"
  ADD CONSTRAINT "task_flows_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "outbound_scenarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_flow_versions"
  ADD CONSTRAINT "task_flow_versions_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "outbound_scenarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outbound_tasks"
  ADD CONSTRAINT "outbound_tasks_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "outbound_scenarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
