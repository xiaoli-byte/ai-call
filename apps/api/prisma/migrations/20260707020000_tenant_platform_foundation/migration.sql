CREATE TABLE "tenants" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_provider_configs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider_type" TEXT NOT NULL,
  "provider_name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "secret_ref" TEXT,
  "config_encrypted" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_provider_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_quota_policies" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "quota_limit" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_quota_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL DEFAULT 'day',
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_aggregates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_aggregates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_accounts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'trial',
  "provider_customer_ref" TEXT,
  "billing_email" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_status_updated_at_idx" ON "tenants"("status", "updated_at");

CREATE UNIQUE INDEX "tenant_provider_configs_tenant_id_provider_type_provider_name_key" ON "tenant_provider_configs"("tenant_id", "provider_type", "provider_name");
CREATE INDEX "tenant_provider_configs_provider_type_provider_name_idx" ON "tenant_provider_configs"("provider_type", "provider_name");

CREATE UNIQUE INDEX "tenant_quota_policies_tenant_id_metric_period_key" ON "tenant_quota_policies"("tenant_id", "metric", "period");
CREATE INDEX "tenant_quota_policies_metric_period_idx" ON "tenant_quota_policies"("metric", "period");

CREATE UNIQUE INDEX "usage_events_tenant_id_idempotency_key_key" ON "usage_events"("tenant_id", "idempotency_key");
CREATE INDEX "usage_events_tenant_id_metric_period_event_at_idx" ON "usage_events"("tenant_id", "metric", "period", "event_at");

CREATE UNIQUE INDEX "usage_aggregates_tenant_id_metric_period_bucket_start_key" ON "usage_aggregates"("tenant_id", "metric", "period", "bucket_start");
CREATE INDEX "usage_aggregates_tenant_id_period_bucket_start_idx" ON "usage_aggregates"("tenant_id", "period", "bucket_start");

CREATE UNIQUE INDEX "billing_accounts_tenant_id_key" ON "billing_accounts"("tenant_id");
CREATE INDEX "billing_accounts_status_idx" ON "billing_accounts"("status");

ALTER TABLE "tenant_provider_configs" ADD CONSTRAINT "tenant_provider_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_quota_policies" ADD CONSTRAINT "tenant_quota_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_aggregates" ADD CONSTRAINT "usage_aggregates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "tenants" ("id", "slug", "name", "status", "metadata", "updated_at")
VALUES (
  'default',
  'default',
  'Default Tenant',
  'active',
  '{"migration":"tenant-platform-foundation","strategy":"legacy rows remain unscoped until each domain is migrated"}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "billing_accounts" ("id", "tenant_id", "status", "metadata", "updated_at")
VALUES (
  'billing-default',
  'default',
  'trial',
  '{"migration":"tenant-platform-foundation"}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("tenant_id") DO NOTHING;
