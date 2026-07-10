param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $PSScriptRoot 'lib\OutboundLocal.psm1') -Force
$statePath = Join-Path $repositoryRoot '.runtime\outbound\state.json'
$hash = [Security.Cryptography.SHA256]::Create()
try { $mutexSuffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($repositoryRoot)))).Replace('-', '').Substring(0, 16) } finally { $hash.Dispose() }
$mutex = New-Object Threading.Mutex($false, "Local\AiCallOutbound-$mutexSuffix")
$mutexHeld = $mutex.WaitOne(0)
if (-not $mutexHeld) { $mutex.Dispose(); throw 'Another outbound orchestration operation is in progress.' }

try {
$state = Read-OutboundRuntimeState -Path $statePath
if ($null -eq $state) {
  Write-Host 'No outbound runtime state exists; nothing was stopped.'
  exit 0
}
if ([IO.Path]::GetFullPath([string]$state.RepositoryRoot) -ne $repositoryRoot) {
  throw 'The outbound runtime state belongs to another repository; nothing was stopped.'
}

$order = @('scheduler', 'outbox', 'event-worker', 'voice-agent', 'dashboard', 'api', 'funasr')
foreach ($name in $order) {
  $record = @($state.Services | Where-Object { $_.Name -eq $name }) | Select-Object -First 1
  if ($null -eq $record -or $record.Owned -ne $true) { continue }
  Stop-OutboundManagedProcess -Record $record
  Write-Host "Stopped owned $name process."
}

if ($null -ne $state.Container -and $state.Container.Owned -eq $true) {
  $inspectOutput = @(& docker inspect ai-call-freeswitch 2>$null)
  $inspectSucceeded = $LASTEXITCODE -eq 0
  $composeFile = if ($inspectSucceeded) {
    $inspect = @(($inspectOutput -join "`n" | ConvertFrom-Json))[0]
    [string]$inspect.Config.Labels.'com.docker.compose.project.config_files'
  } else { '' }
  if ($inspectSucceeded -and
      [IO.Path]::GetFullPath($composeFile) -eq [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'freeswitch\docker-compose.yml'))) {
    & docker stop ai-call-freeswitch | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The owned FreeSWITCH container could not be stopped.' }
    Write-Host 'Stopped the owned FreeSWITCH container without removing Compose resources.'
  } elseif ($inspectSucceeded) {
    throw 'The FreeSWITCH container identity changed; refusing to stop it.'
  }
}

$remaining = @($state.Services | Where-Object { $_.Owned -ne $true })
if ($remaining.Count -gt 0 -or ($null -ne $state.Container -and $state.Container.Owned -ne $true)) {
  $state.Services = $remaining
  $state.UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
  Write-OutboundRuntimeState -Path $statePath -State $state
  Write-Host 'Verified pre-existing processes/containers were left running and remain recorded as unowned.'
} else {
  Remove-Item -LiteralPath $statePath -Force
}

Write-Host 'Owned outbound runtime resources are stopped. MicroSIP was left under user control.'
} finally {
  if ($mutexHeld) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
