param(
  [string]$BackupFile = "",
  [string]$TargetDatabaseUrl = "",
  [string]$PsqlPath = "psql",
  [switch]$ConfirmRestore,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Hide-ConnectionSecret {
  param([string]$ConnectionString)

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    return $ConnectionString
  }

  return ($ConnectionString -replace '(^[a-zA-Z][a-zA-Z0-9+.-]*://[^:/@\s]+):([^@/\s]+)@', '$1:***@')
}

function ConvertTo-FullPath {
  param([string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Format-CommandPart {
  param([string]$Value)

  if ($Value -match '^[A-Za-z0-9_\-\.\\/:=@%,]+$') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Format-CommandLine {
  param(
    [string]$Executable,
    [string[]]$Arguments
  )

  return ((@($Executable) + $Arguments | ForEach-Object { Format-CommandPart $_ }) -join " ")
}

function New-CoreTableCountSql {
  param([string[]]$Tables)

  $selects = foreach ($table in $Tables) {
    "SELECT '$table' AS table_name, COUNT(*)::bigint AS row_count FROM `"$table`""
  }

  return (($selects -join "`nUNION ALL`n") + "`nORDER BY table_name;")
}

try {
  $usingExampleBackup = $false
  $usingExampleTarget = $false

  if ([string]::IsNullOrWhiteSpace($BackupFile)) {
    if (-not $DryRun) {
      throw "Pass -BackupFile for the SQL dump to restore."
    }
    $BackupFile = "backups/postgres/ai-call-postgres-YYYYMMDDTHHMMSSZ.sql"
    $usingExampleBackup = $true
  }

  if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
    if (-not $DryRun) {
      throw "Pass -TargetDatabaseUrl for the restore target."
    }
    $TargetDatabaseUrl = "postgresql://restore_user:example-password@localhost:5432/ai_call_restore"
    $usingExampleTarget = $true
  }

  if (-not $DryRun -and -not $ConfirmRestore) {
    throw "Restore refused. Re-run with -ConfirmRestore after verifying the target is an empty, non-production restore database."
  }

  $backupPath = ConvertTo-FullPath -Path $BackupFile
  if (-not $DryRun) {
    $backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
  }

  $coreTables = @(
    "tenants",
    "outbound_tasks",
    "call_attempts",
    "outbox_events",
    "task_flows",
    "task_flow_versions",
    "call_events",
    "transcript_turns"
  )
  $coreCountSql = New-CoreTableCountSql -Tables $coreTables
  $outboxStatusSql = 'SELECT status, COUNT(*)::bigint AS row_count FROM "outbox_events" GROUP BY status ORDER BY status;'

  $restoreArgs = @(
    "--set=ON_ERROR_STOP=on",
    "--single-transaction",
    "--dbname=$TargetDatabaseUrl",
    "--file=$backupPath"
  )
  $displayRestoreArgs = @(
    "--set=ON_ERROR_STOP=on",
    "--single-transaction",
    "--dbname=$(Hide-ConnectionSecret -ConnectionString $TargetDatabaseUrl)",
    "--file=$backupPath"
  )
  $displayCoreCheckArgs = @(
    "--set=ON_ERROR_STOP=on",
    "--dbname=$(Hide-ConnectionSecret -ConnectionString $TargetDatabaseUrl)",
    "--command=<core table count SQL below>"
  )
  $displayOutboxCheckArgs = @(
    "--set=ON_ERROR_STOP=on",
    "--dbname=$(Hide-ConnectionSecret -ConnectionString $TargetDatabaseUrl)",
    "--command=$outboxStatusSql"
  )

  Write-Host "=== PostgreSQL restore check ==="
  if ($usingExampleBackup) {
    Write-Host "Dry-run: using example backup path because -BackupFile was omitted."
  }
  if ($usingExampleTarget) {
    Write-Host "Dry-run: using example target URL because -TargetDatabaseUrl was omitted."
  }
  Write-Host "Backup file: $backupPath"
  Write-Host "Target database: $(Hide-ConnectionSecret -ConnectionString $TargetDatabaseUrl)"
  Write-Host "Restore command: $(Format-CommandLine -Executable $PsqlPath -Arguments $displayRestoreArgs)"
  Write-Host "Core count command: $(Format-CommandLine -Executable $PsqlPath -Arguments $displayCoreCheckArgs)"
  Write-Host "Outbox status command: $(Format-CommandLine -Executable $PsqlPath -Arguments $displayOutboxCheckArgs)"
  Write-Host "Core table count SQL:"
  Write-Host $coreCountSql

  if ($DryRun) {
    Write-Host "Dry-run: psql will not be executed."
    Write-Host "Real restores are refused unless -ConfirmRestore is supplied."
    exit 0
  }

  Write-Host "Running restore. Confirmed by -ConfirmRestore."
  & $PsqlPath @restoreArgs
  if ($LASTEXITCODE -ne 0) {
    throw "psql restore exited with code $LASTEXITCODE."
  }

  Write-Host "=== Core table counts ==="
  & $PsqlPath "--set=ON_ERROR_STOP=on" "--dbname=$TargetDatabaseUrl" "--command=$coreCountSql"
  if ($LASTEXITCODE -ne 0) {
    throw "psql core table count check exited with code $LASTEXITCODE."
  }

  Write-Host "=== Outbox status summary ==="
  & $PsqlPath "--set=ON_ERROR_STOP=on" "--dbname=$TargetDatabaseUrl" "--command=$outboxStatusSql"
  if ($LASTEXITCODE -ne 0) {
    throw "psql outbox status check exited with code $LASTEXITCODE."
  }

  Write-Host "Restore and core checks completed."
  exit 0
} catch {
  [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
  exit 1
}
