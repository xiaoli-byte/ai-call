-- Immutable published flow snapshots
ALTER TABLE "task_flows" ALTER COLUMN "version" SET DEFAULT 0;

CREATE TABLE "task_flow_versions" (
  "id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "nodes" JSONB NOT NULL,
  "edges" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_flow_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_flow_versions_flow_id_version_key" ON "task_flow_versions"("flow_id", "version");
CREATE INDEX "task_flow_versions_flow_id_created_at_idx" ON "task_flow_versions"("flow_id", "created_at");
ALTER TABLE "task_flow_versions" ADD CONSTRAINT "task_flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "task_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "outbound_tasks" (
  "id" UUID NOT NULL,
  "to" TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "called_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration" INTEGER,
  "outcome" TEXT,
  "recording_url" TEXT,
  "intent_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "flow_id" UUID,
  "flow_version_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbound_tasks_status_scheduled_at_idx" ON "outbound_tasks"("status", "scheduled_at");
CREATE INDEX "outbound_tasks_flow_version_id_idx" ON "outbound_tasks"("flow_version_id");
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "task_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_flow_version_id_fkey" FOREIGN KEY ("flow_version_id") REFERENCES "task_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transcript_turns" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "timestamp" DOUBLE PRECISION NOT NULL,
  "emotion" TEXT,
  "external_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcript_turns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transcript_turns_task_id_created_at_idx" ON "transcript_turns"("task_id", "created_at");
CREATE UNIQUE INDEX "transcript_turns_task_id_external_id_key" ON "transcript_turns"("task_id", "external_id");
ALTER TABLE "transcript_turns" ADD CONSTRAINT "transcript_turns_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "call_events" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "call_events_task_id_created_at_idx" ON "call_events"("task_id", "created_at");
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");
