-- 外呼任务成为唯一拨号业务对象，移除活动、活动名单及其关联字段。
ALTER TABLE "outbound_tasks"
  DROP CONSTRAINT IF EXISTS "outbound_tasks_campaign_id_fkey",
  DROP CONSTRAINT IF EXISTS "outbound_tasks_campaign_lead_id_fkey";

ALTER TABLE "handoff_tickets"
  DROP CONSTRAINT IF EXISTS "handoff_tickets_campaign_id_fkey";

ALTER TABLE "contact_attempt_history"
  DROP CONSTRAINT IF EXISTS "contact_attempt_history_campaign_id_fkey",
  DROP CONSTRAINT IF EXISTS "contact_attempt_history_campaign_lead_id_fkey";

ALTER TABLE "outbound_tasks"
  DROP COLUMN IF EXISTS "campaign_id",
  DROP COLUMN IF EXISTS "campaign_lead_id";

ALTER TABLE "handoff_tickets"
  DROP COLUMN IF EXISTS "campaign_id";

ALTER TABLE "contact_attempt_history"
  DROP COLUMN IF EXISTS "campaign_id",
  DROP COLUMN IF EXISTS "campaign_lead_id";

DROP TABLE IF EXISTS "campaign_leads";
DROP TABLE IF EXISTS "lead_import_batches";
DROP TABLE IF EXISTS "campaigns";
