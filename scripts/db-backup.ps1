param(
  [string]$DatabaseUrl = "",
  [string]$PgDumpPath = "pg_dump",
  [string]$OutputDir = "backups/postgres",
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

function ConvertTo-RepoPath {
  param([string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Path))
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

try {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $DatabaseUrl = $env:DATABASE_URL
  }

  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "DATABASE_URL is not set. Pass -DatabaseUrl or set DATABASE_URL in the environment."
  }

  $resolvedOutputDir = ConvertTo-RepoPath -Path $OutputDir
  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
  $backupFile = Join-Path $resolvedOutputDir "ai-call-postgres-$timestamp.sql"

  $dumpArgs = @(
    "--dbname=$DatabaseUrl",
    "--format=plain",
    "--encoding=UTF8",
    "--no-owner",
    "--no-privileges",
    "--file=$backupFile"
  )
  $displayDumpArgs = @(
    "--dbname=$(Hide-ConnectionSecret -ConnectionString $DatabaseUrl)",
    "--format=plain",
    "--encoding=UTF8",
    "--no-owner",
    "--no-privileges",
    "--file=$backupFile"
  )

  Write-Host "=== PostgreSQL backup ==="
  Write-Host "Output file: $backupFile"
  Write-Host "Command: $(Format-CommandLine -Executable $PgDumpPath -Arguments $displayDumpArgs)"

  if ($DryRun) {
    Write-Host "Dry-run: would create output directory when missing: $resolvedOutputDir"
    Write-Host "Dry-run: pg_dump will not be executed."
    Write-Host "Post-backup checks to run after a real backup:"
    Write-Host "  1. Confirm the dump file exists and has non-zero size."
    Write-Host "  2. Record SHA256 with Get-FileHash -Algorithm SHA256."
    Write-Host "  3. Store the dump in encrypted off-host storage."
    Write-Host "  4. Do not commit dump files to git."
    exit 0
  }

  New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

  & $PgDumpPath @dumpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump exited with code $LASTEXITCODE."
  }

  $backupItem = Get-Item -LiteralPath $backupFile
  if ($backupItem.Length -le 0) {
    throw "Backup file was created but is empty: $backupFile"
  }

  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
  Write-Host "Backup complete."
  Write-Host "Size bytes: $($backupItem.Length)"
  Write-Host "SHA256: $($hash.Hash)"
  Write-Host "Do not commit dump files to git; move them to encrypted off-host storage."
  exit 0
} catch {
  [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
  exit 1
}
