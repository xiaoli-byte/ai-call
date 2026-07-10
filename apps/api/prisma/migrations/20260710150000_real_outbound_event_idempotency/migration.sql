-- Persist the dispatch channel and provider identities used by real outbound calls.
-- Nullable provider identifiers preserve compatibility with historical rows.
ALTER TABLE "call_attempts"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'freeswitch',
  ADD COLUMN "provider_job_id" TEXT,
  ADD COLUMN "last_provider_event_at" TIMESTAMP(3),
  ADD COLUMN "last_provider_snapshot_id" TEXT,
  ADD COLUMN "last_provider_snapshot_at" TIMESTAMP(3),
  ADD COLUMN "missing_provider_snapshot_count" INTEGER NOT NULL DEFAULT 0;

-- Browser calls were historically identified by their dispatch event payload.
UPDATE "call_attempts" AS attempt
SET "channel" = 'web'
FROM "call_events" AS event
WHERE event."attempt_id" = attempt."id"
  AND event."type" = 'call.dispatch_accepted'
  AND event."payload" ->> 'channel' = 'web';

CREATE UNIQUE INDEX "call_attempts_provider_job_id_key"
  ON "call_attempts"("provider_job_id");

ALTER TABLE "call_events"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "provider_event_id" TEXT;

CREATE UNIQUE INDEX "call_events_provider_provider_event_id_key"
  ON "call_events"("provider", "provider_event_id");
