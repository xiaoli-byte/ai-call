<#
.SYNOPSIS
  CALL-11 · P2 迁移真库演练（migrate deploy dry-run）

.DESCRIPTION
  在一次性可弃的 Postgres 上演练全部 P2 迁移的生产部署路径（prisma migrate deploy），
  并校验结构与回填结果：
    - tenant_demo 租户行存在
    - CALL-02 的 15 张业务表：tenant_id 非空 + 默认 'tenant_demo' + 索引 + 无 NULL 残留
    - CALL-05：outbound_tasks.owner_id（可空 uuid）+ resource_grants 表与索引
    - _prisma_migrations：全部 applied、无 rolled_back
    - seed 幂等：连跑两次 seed，permissions/roles/scenarios 行数不变

  破坏性：会对目标库执行 DROP SCHEMA public CASCADE（除非 -SkipReset）。仅可指向
  一次性可弃库。默认 DryRun 只打印计划；真跑需 -ConfirmRun。

  依赖：psql、pnpm（apps/api 的 prisma）。目标库由 -TargetDatabaseUrl 指定，脚本会把它
  注入 DATABASE_URL 供 prisma 使用。

.EXAMPLE
  # 先看计划（不连库、不改动）
  pwsh scripts/call-11-migration-dryrun.ps1 -DryRun

.EXAMPLE
  # 真跑（可弃库）
  pwsh scripts/call-11-migration-dryrun.ps1 `
    -TargetDatabaseUrl "postgresql://u:p@localhost:5432/ai_call_migration_dryrun" -ConfirmRun
#>
param(
  [string]$TargetDatabaseUrl = "",
  [string]$PsqlPath = "psql",
  [switch]$ConfirmRun,
  [switch]$SkipReset,
  [switch]$SkipSeed,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Hide-ConnectionSecret {
  param([string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { return $ConnectionString }
  return ($ConnectionString -replace '(^[a-zA-Z][a-zA-Z0-9+.-]*://[^:/@\s]+):([^@/\s]+)@', '$1:***@')
}

function Invoke-Psql {
  param([string]$Sql, [string]$Url)
  & $PsqlPath "--set=ON_ERROR_STOP=on" "--dbname=$Url" "--command=$Sql"
  if ($LASTEXITCODE -ne 0) { throw "psql 执行失败（exit $LASTEXITCODE）：$Sql" }
}

function Get-Scalar {
  param([string]$Sql, [string]$Url)
  $out = & $PsqlPath "-tA" "--set=ON_ERROR_STOP=on" "--dbname=$Url" "--command=$Sql"
  if ($LASTEXITCODE -ne 0) { throw "psql 标量查询失败（exit $LASTEXITCODE）：$Sql" }
  return ($out | Select-Object -First 1).Trim()
}

# CALL-02 的 15 张业务表
$tenantTables = @(
  'outbound_scenarios','task_flows','task_flow_versions','outbound_tasks','call_attempts',
  'campaigns','knowledge_documents','transcript_turns','call_events','call_analyses',
  'handoff_tickets','campaign_leads','lead_import_batches','contact_attempt_history','scenario_test_runs'
)
$tblArraySql = "ARRAY['" + ($tenantTables -join "','") + "']"

# 结构 + 回填校验：任一不满足即 RAISE EXCEPTION → psql 以 ON_ERROR_STOP 退出非 0
$verifySql = @"
DO `$`$
DECLARE t text; n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'tenant_demo') THEN
    RAISE EXCEPTION 'CALL-02: tenant_demo 行缺失';
  END IF;

  FOREACH t IN ARRAY $tblArraySql LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name=t AND column_name='tenant_id' AND is_nullable='NO') THEN
      RAISE EXCEPTION 'CALL-02: %.tenant_id 非 NOT NULL', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name=t AND column_name='tenant_id' AND column_default LIKE '%tenant_demo%') THEN
      RAISE EXCEPTION 'CALL-02: %.tenant_id 缺默认 tenant_demo', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename=t AND indexname=t||'_tenant_id_idx') THEN
      RAISE EXCEPTION 'CALL-02: %.tenant_id 索引缺失', t;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'CALL-02: % 仍有 % 行 tenant_id 为 NULL（回填不完整）', t, n;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='outbound_tasks' AND column_name='owner_id'
                   AND data_type='uuid' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'CALL-05: outbound_tasks.owner_id 缺失或类型/可空性不符';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='campaigns' AND column_name='owner_id'
                   AND data_type='uuid' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'CALL-09: campaigns.owner_id 缺失或类型/可空性不符';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='campaigns' AND indexname='campaigns_owner_id_idx') THEN
    RAISE EXCEPTION 'CALL-09: campaigns_owner_id_idx 索引缺失';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='resource_grants') THEN
    RAISE EXCEPTION 'CALL-05: resource_grants 表缺失';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='resource_grants'
                 AND indexname='resource_grants_tenant_id_resource_type_resource_id_idx') THEN
    RAISE EXCEPTION 'CALL-05: resource_grants 复合索引缺失';
  END IF;

  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) THEN
    RAISE EXCEPTION '存在未完成或已回滚的迁移';
  END IF;

  RAISE NOTICE 'CALL-11 结构与回填校验全部通过';
END
`$`$;
"@

try {
  $usingExampleTarget = $false
  if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
    if (-not $DryRun) { throw "请用 -TargetDatabaseUrl 指定一次性可弃库。" }
    $TargetDatabaseUrl = "postgresql://dryrun_user:example-password@localhost:5432/ai_call_migration_dryrun"
    $usingExampleTarget = $true
  }

  # 安全守卫：绝不对正在使用的库演练
  if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL) -and $TargetDatabaseUrl -eq $env:DATABASE_URL) {
    throw "拒绝执行：-TargetDatabaseUrl 与当前 DATABASE_URL 相同。请指向一次性可弃库。"
  }

  Write-Host "=== CALL-11 P2 迁移真库演练 ==="
  if ($usingExampleTarget) { Write-Host "DryRun：未提供 -TargetDatabaseUrl，使用示例 URL。" }
  Write-Host "目标库   : $(Hide-ConnectionSecret -ConnectionString $TargetDatabaseUrl)"
  Write-Host "重置库   : $([bool](-not $SkipReset))（DROP SCHEMA public CASCADE）"
  Write-Host "seed 幂等 : $([bool](-not $SkipSeed))"
  Write-Host "步骤     : [重置] → prisma migrate deploy → 结构/回填校验 → [seed×2 幂等]"

  if ($DryRun -or -not $ConfirmRun) {
    if (-not $DryRun) {
      Write-Host ""
      Write-Host "真跑被拒：请在确认目标为一次性可弃库后加 -ConfirmRun 重跑。" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "--- 将执行的校验 SQL ---"
    Write-Host $verifySql
    Write-Host ""
    Write-Host "DryRun：不连库、不改动。"
    exit 0
  }

  # 让 prisma 使用目标库
  $env:DATABASE_URL = $TargetDatabaseUrl

  if (-not $SkipReset) {
    Write-Host "`n=== [1/4] 重置目标库为空 schema ==="
    Invoke-Psql -Url $TargetDatabaseUrl -Sql "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  } else {
    Write-Host "`n=== [1/4] 跳过重置（-SkipReset，假定库已空）==="
  }

  Write-Host "`n=== [2/4] prisma migrate deploy ==="
  & pnpm --filter '@ai-call/api' exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy 失败（exit $LASTEXITCODE）。" }

  Write-Host "`n=== [3/4] 结构与回填校验 ==="
  Invoke-Psql -Url $TargetDatabaseUrl -Sql $verifySql
  Write-Host "结构/回填校验通过。"

  if (-not $SkipSeed) {
    Write-Host "`n=== [4/4] seed 幂等校验（连跑两次）==="
    & pnpm --filter '@ai-call/api' prisma:seed
    if ($LASTEXITCODE -ne 0) { throw "首次 seed 失败（exit $LASTEXITCODE）。" }

    $before = @{}
    foreach ($tbl in @('permissions','roles','outbound_scenarios')) {
      $before[$tbl] = Get-Scalar -Url $TargetDatabaseUrl -Sql "SELECT count(*) FROM `"$tbl`""
    }

    & pnpm --filter '@ai-call/api' prisma:seed
    if ($LASTEXITCODE -ne 0) { throw "第二次 seed 失败（exit $LASTEXITCODE）——seed 非幂等。" }

    foreach ($tbl in @('permissions','roles','outbound_scenarios')) {
      $after = Get-Scalar -Url $TargetDatabaseUrl -Sql "SELECT count(*) FROM `"$tbl`""
      if ($after -ne $before[$tbl]) {
        throw "seed 非幂等：$tbl 行数从 $($before[$tbl]) 变为 $after（第二次 seed 产生了重复）。"
      }
      Write-Host "  $tbl : $after（两次一致 ✔）"
    }
  } else {
    Write-Host "`n=== [4/4] 跳过 seed 幂等校验（-SkipSeed）==="
  }

  Write-Host "`nCALL-11 演练全部通过。" -ForegroundColor Green
  exit 0
} catch {
  [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
  exit 1
}
