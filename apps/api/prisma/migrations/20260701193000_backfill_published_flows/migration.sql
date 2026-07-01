INSERT INTO "task_flow_versions" (
  "id",
  "flow_id",
  "version",
  "name",
  "description",
  "nodes",
  "edges",
  "created_at"
)
SELECT
  gen_random_uuid(),
  "id",
  GREATEST("version", 1),
  "name",
  "description",
  "nodes",
  "edges",
  CURRENT_TIMESTAMP
FROM "task_flows"
WHERE "status" = 'published'
ON CONFLICT ("flow_id", "version") DO NOTHING;
