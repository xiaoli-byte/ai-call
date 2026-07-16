ALTER TABLE "outbound_scenarios"
ADD COLUMN IF NOT EXISTS "knowledge_base_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "outbound_scenarios"
SET "knowledge_base_ids" = ARRAY["knowledge_base_id"]
WHERE cardinality("knowledge_base_ids") = 0
  AND NULLIF("knowledge_base_id", '') IS NOT NULL;
