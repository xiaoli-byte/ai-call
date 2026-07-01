-- RBAC 用户认证相关表
CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

CREATE TABLE IF NOT EXISTS "roles" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "roles"("name");

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_key" ON "permissions"("code");

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE IF NOT EXISTS "user_roles" (
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_fkey') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_fkey') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
      FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_fkey') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_fkey') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_user_id_fkey') THEN
    ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
