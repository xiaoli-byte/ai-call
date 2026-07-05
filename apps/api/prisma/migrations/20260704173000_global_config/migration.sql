CREATE TABLE "global_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "global_variables" JSONB NOT NULL DEFAULT '[]',
  "api_plugins" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "global_configs_pkey" PRIMARY KEY ("id")
);
