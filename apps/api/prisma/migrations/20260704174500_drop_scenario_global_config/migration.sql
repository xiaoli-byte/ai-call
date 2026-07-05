WITH scenario_variables AS (
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) AS items
  FROM (
    SELECT DISTINCT ON (item.value ->> 'key') item.value
    FROM "outbound_scenarios",
      jsonb_array_elements("global_variables") AS item(value)
    WHERE item.value ->> 'key' IS NOT NULL
    ORDER BY item.value ->> 'key'
  ) AS deduped
),
scenario_plugins AS (
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) AS items
  FROM (
    SELECT DISTINCT ON (COALESCE(item.value ->> 'id', item.value ->> 'name')) item.value
    FROM "outbound_scenarios",
      jsonb_array_elements("api_plugins") AS item(value)
    WHERE COALESCE(item.value ->> 'id', item.value ->> 'name') IS NOT NULL
    ORDER BY COALESCE(item.value ->> 'id', item.value ->> 'name')
  ) AS deduped
)
INSERT INTO "global_configs" ("id", "global_variables", "api_plugins", "created_at", "updated_at")
SELECT 'default', scenario_variables.items, scenario_plugins.items, NOW(), NOW()
FROM scenario_variables, scenario_plugins
ON CONFLICT ("id") DO UPDATE SET
  "global_variables" = CASE
    WHEN jsonb_array_length("global_configs"."global_variables") = 0
      THEN EXCLUDED."global_variables"
    ELSE "global_configs"."global_variables"
  END,
  "api_plugins" = CASE
    WHEN jsonb_array_length("global_configs"."api_plugins") = 0
      THEN EXCLUDED."api_plugins"
    ELSE "global_configs"."api_plugins"
  END,
  "updated_at" = NOW();

ALTER TABLE "outbound_scenarios" DROP COLUMN "global_variables";
ALTER TABLE "outbound_scenarios" DROP COLUMN "api_plugins";
