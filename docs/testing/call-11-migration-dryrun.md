# CALL-11 · P2 迁移真库演练 运行手册

> 工单见 `docs/authz-implementation-backlog.md` 的 **CALL-11**（上线阻塞项）。
> 驱动脚本：`scripts/call-11-migration-dryrun.ps1`（PowerShell + psql + pnpm/prisma）。
> 数据库运维总纲见 `docs/testing/operations-loop-regression.md`。

> ✅ **首次演练通过**（2026-07-10）。目标：一次性可弃库 `ai_call_migration_dryrun`（建在 `ai-call-postgres` 服务器内、独立空库，跑完 `DROP DATABASE`；开发库 `ai_call` 未受影响）。结果：`prisma migrate deploy` 顺序应用 **17 条迁移**（含 CALL-02/05/09）无误 → 结构/回填/索引校验 DO 块全绿（`tenant_demo` 由迁移自建，15 张表 `tenant_id` NOT NULL+默认+索引、无 NULL 残留；`outbound_tasks`/`campaigns` 的 `owner_id`；`resource_grants` 表 + 复合索引；无未完成/回滚迁移）→ seed 幂等（两次 `permissions` 38、`roles` 3、`outbound_scenarios` 3 不变，第二次全 `[跳过]`）。
> 本机因主机无 `psql`/`pwsh`，是把脚本的三步（重置空库→`migrate deploy`→verify SQL→seed×2）用 `docker exec … psql` + `pnpm --filter @ai-call/api …` 等价手工执行；生产/有 psql 环境按下方「运行」章节直接跑 `.ps1` 即可。

## 目的

CALL-02（15 张业务表补 `tenant_id`，三步走）与 CALL-05（`outbound_tasks.owner_id` + `resource_grants`）的迁移脚本已手写，但**从未在真实 Postgres 上跑过 `migrate deploy`**（本机开发期无常驻 Postgres）。上线前必须在一次性可弃库上演练生产部署路径，确认迁移可顺序应用、结构与回填正确、seed 幂等。

> ⚠️ 生产用 `prisma migrate deploy`（**绝不** `migrate dev`）。`migrate reset` / `DROP SCHEMA` 只能对一次性可弃库执行。本脚本默认 DryRun，真跑需 `-ConfirmRun`，且拒绝指向当前 `DATABASE_URL`。

## 前置条件

1. **psql** 在 PATH（或用 `-PsqlPath` 指定）。
2. **pnpm** + 已安装依赖（脚本用 `pnpm --filter @ai-call/api exec prisma migrate deploy` 与 `prisma:seed`）。
3. 一个**一次性可弃**的空 Postgres（本地 Docker 或临时实例），例如：
   ```bash
   docker run -d --name pg-dryrun -e POSTGRES_PASSWORD=dryrun -p 5433:5432 postgres:16
   # DATABASE URL: postgresql://postgres:dryrun@localhost:5433/postgres
   ```

## 脚本校验项

`migrate deploy` 后，脚本对目标库断言（任一不满足即 psql `RAISE EXCEPTION` → 退出非 0）：

- **CALL-02**：`tenant_demo` 租户行存在；15 张业务表每张的 `tenant_id`：非空 + 默认 `tenant_demo` + `<table>_tenant_id_idx` 索引存在 + 无 `tenant_id IS NULL` 残留。
- **CALL-05**：`outbound_tasks.owner_id` 为可空 `uuid`；`resource_grants` 表存在 + 复合索引 `resource_grants_tenant_id_resource_type_resource_id_idx` 存在。
- **CALL-09**：`campaigns.owner_id` 为可空 `uuid` + `campaigns_owner_id_idx` 索引存在。
- **迁移状态**：`_prisma_migrations` 无未完成（`finished_at IS NULL`）或已回滚（`rolled_back_at IS NOT NULL`）的行。
- **seed 幂等**：连跑两次 `prisma:seed` 均成功，且 `permissions` / `roles` / `outbound_scenarios` 行数两次一致（无重复插入）。

## 运行

```powershell
# 1) 先看计划（不连库、不改动）
pwsh scripts/call-11-migration-dryrun.ps1 -DryRun

# 2) 真跑（可弃库；会 DROP SCHEMA public 重置后 deploy）
pwsh scripts/call-11-migration-dryrun.ps1 `
  -TargetDatabaseUrl "postgresql://postgres:dryrun@localhost:5433/postgres" -ConfirmRun

# 库已保证为空、想跳过重置：加 -SkipReset
# 只验迁移结构、不跑 seed：加 -SkipSeed
```

退出码：全部通过 → `0`；任一断言/命令失败 → `1`。

## 校验边界（重要）

脚本在**空库**上跑 `migrate deploy`，因此：
- ✅ 充分验证：迁移可顺序应用、列/约束/索引/新表结构、`tenant_id` 的 **DEFAULT**（决定新行回填）、seed 幂等。
- ⚠️ 不覆盖：**历史旧数据的 UPDATE 回填**（空库里 `UPDATE ... WHERE tenant_id IS NULL` 命中 0 行）。DEFAULT 已保证新行，但若要验证「迁移前已存在、无 tenant_id 的旧行被回填为 tenant_demo」，见下节可选演练。

## 可选：真实旧数据回填演练（分批 deploy）

用「临时移出 P2 迁移目录 → 灌旧数据 → 移回再 deploy」的方式，验证 CALL-02 的历史回填：

```bash
cd apps/api/prisma/migrations
# 1) 把 P2 两个迁移移出，先 deploy 到 CALL-02 之前
mkdir -p /tmp/hold && mv 20260709000000_call02_business_tenant_id 20260709120000_call05_resource_grant_task_owner /tmp/hold/
DATABASE_URL=<可弃库> pnpm --filter @ai-call/api exec prisma migrate deploy   # 应用到 tenant_platform_foundation 为止

# 2) 用 psql 向某张目标表插入一行“旧数据”（此时该表还没有 tenant_id 列）
psql --dbname=<可弃库> -c "INSERT INTO campaigns (id, name, status, created_at, updated_at) VALUES ('legacy-1','Legacy','draft', now(), now());"
#   注意：按该表实际 NOT NULL 列补齐；不同表列不同，campaigns 仅示意。

# 3) 移回 P2 迁移，再 deploy → 触发 CALL-02 的三步回填
mv /tmp/hold/* . && DATABASE_URL=<可弃库> pnpm --filter @ai-call/api exec prisma migrate deploy

# 4) 断言旧行已被回填
psql --dbname=<可弃库> -c "SELECT tenant_id FROM campaigns WHERE id='legacy-1';"   # 期望 tenant_demo
```

## 产出与回填

- 全部通过 → 在 CALL-11 工单「状态」记录：日期、目标库版本（如 postgres:16）、`migrate deploy` 与校验结果；上线阻塞解除。
- 若某迁移在真库失败（如索引名冲突、类型不符）→ 回到对应 `migration.sql` 修复，重跑本演练。
- 迁移变更后按 `docs/testing/operations-loop-regression.md` 走回归。

## 脚本编码说明

`.ps1` 存为 **UTF-8 with BOM**（脚本含中文注释，Windows PowerShell 5.1 需 BOM 才能正确解析）。若用编辑器/工具改动后中文变乱码或解析报错，重新以 UTF-8 BOM 保存即可。
