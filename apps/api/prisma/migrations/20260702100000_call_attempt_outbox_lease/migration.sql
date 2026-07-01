ALTER TABLE "outbound_tasks"
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "call_attempts" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "provider_call_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'calling',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ringing_at" TIMESTAMP(3),
  "answered_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration" INTEGER,
  "hangup_cause" TEXT,
  "recording_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_attempts_provider_call_id_key" ON "call_attempts"("provider_call_id");
CREATE UNIQUE INDEX IF NOT EXISTS "call_attempts_task_id_attempt_no_key" ON "call_attempts"("task_id", "attempt_no");
CREATE INDEX IF NOT EXISTS "call_attempts_task_id_created_at_idx" ON "call_attempts"("task_id", "created_at");
CREATE INDEX IF NOT EXISTS "call_attempts_status_started_at_idx" ON "call_attempts"("status", "started_at");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_attempts_task_id_fkey') THEN
    ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_task_id_fkey"
      FOREIGN KEY ("task_id") REFERENCES "outbound_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "transcript_turns" ADD COLUMN IF NOT EXISTS "attempt_id" UUID;
CREATE INDEX IF NOT EXISTS "transcript_turns_attempt_id_created_at_idx" ON "transcript_turns"("attempt_id", "created_at");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcript_turns_attempt_id_fkey') THEN
    ALTER TABLE "transcript_turns" ADD CONSTRAINT "transcript_turns_attempt_id_fkey"
      FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "call_events" ADD COLUMN IF NOT EXISTS "attempt_id" UUID;
CREATE INDEX IF NOT EXISTS "call_events_attempt_id_created_at_idx" ON "call_events"("attempt_id", "created_at");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_events_attempt_id_fkey') THEN
    ALTER TABLE "call_events" ADD CONSTRAINT "call_events_attempt_id_fkey"
      FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "locked_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deduplication_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_deduplication_key_key" ON "outbox_events"("deduplication_key");
CREATE INDEX IF NOT EXISTS "outbox_events_locked_at_idx" ON "outbox_events"("locked_at");
CREATE INDEX IF NOT EXISTS "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");
