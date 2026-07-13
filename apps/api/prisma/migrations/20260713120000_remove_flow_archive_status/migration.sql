-- 移除流程「归档 / archived」状态：archived 不再是合法的流程状态。
-- 历史上被归档的流程按是否留有版本快照归一化：
--   有已发布版本（version > 0）→ published，否则 → draft。
-- 与 backfill_published_flows 迁移使用同一「version > 0 即视为已发布」信号。
UPDATE "task_flows"
SET "status" = CASE WHEN "version" > 0 THEN 'published' ELSE 'draft' END
WHERE "status" = 'archived';
