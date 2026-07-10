param(
  [string]$HostIPv4 = $env:HOST_IPV4,
  [string]$MicroSipPath,
  [string]$MicroSipIniPath,
  [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$modulePath = Join-Path $PSScriptRoot 'lib\OutboundLocal.psm1'
Import-Module $modulePath -Force

$runtimeRoot = Join-Path $repositoryRoot '.runtime\outbound'
$statePath = Join-Path $runtimeRoot 'state.json'
$logDirectory = Join-Path $runtimeRoot 'logs'
$secretPath = Join-Path $repositoryRoot '.runtime\microsip.env'
$varsPath = Join-Path $repositoryRoot '.runtime\freeswitch\vars.xml'
$composePath = Join-Path $repositoryRoot 'freeswitch\docker-compose.yml'
$startedThisRun = New-Object System.Collections.ArrayList
$containerStartedThisRun = $false
$microSipStartedThisRun = $false
$mutex = $null
$mutexHeld = $false

function Test-ProcessRecordAlive {
  param($Record)
  if ($null -eq $Record) { return $false }
  $process = Get-Process -Id ([int]$Record.Pid) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  try {
    $expected = [DateTime]::Parse([string]$Record.StartedAt).ToUniversalTime()
    return [Math]::Abs(($process.StartTime.ToUniversalTime() - $expected).TotalSeconds) -le 2
  } catch { return $false }
}

function Test-DescendantProcess {
  param([int]$ChildId, [int]$AncestorId, [object[]]$Processes)
  $current = $ChildId
  $seen = New-Object 'System.Collections.Generic.HashSet[int]'
  while ($current -gt 0 -and $seen.Add($current)) {
    if ($current -eq $AncestorId) { return $true }
    $entry = @($Processes | Where-Object { $_.ProcessId -eq $current }) | Select-Object -First 1
    if ($null -eq $entry) { return $false }
    $current = [int]$entry.ParentProcessId
  }
  return $false
}

function Get-StateService {
  param([string]$Name)
  if ($null -eq $script:state -or $null -eq $script:state.Services) { return $null }
  return @($script:state.Services | Where-Object { $_.Name -eq $Name }) | Select-Object -First 1
}

function Set-StateService {
  param($Record)
  $next = @($script:state.Services | Where-Object { $_.Name -ne $Record.Name })
  $script:state.Services = @($next + $Record)
  $script:state.UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
  Write-OutboundRuntimeState -Path $statePath -State $script:state
}

function Assert-PortIsReusable {
  param([string]$Name, [int]$Port)
  $owners = @(Get-OutboundPortOwner -Port $Port)
  if ($owners.Count -eq 0) { return $false }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $knownRecords = @($script:state.Services | Where-Object { Test-ProcessRecordAlive $_ })
  foreach ($owner in $owners) {
    $ownedByRepository = Test-RepositoryProcess -ProcessId $owner -RepositoryRoot $repositoryRoot
    if (-not $ownedByRepository) {
      foreach ($record in $knownRecords) {
        if (Test-DescendantProcess -ChildId $owner -AncestorId ([int]$record.Pid) -Processes $processes) {
          $ownedByRepository = $true
          break
        }
      }
    }
    if (-not $ownedByRepository) {
      throw "$Name cannot use port $Port because it belongs to an unverified process (PID $owner)."
    }
  }
  return $true
}

function Start-OrReusePortService {
  param(
    [string]$Name,
    [int]$Port,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )
  $occupied = Assert-PortIsReusable -Name $Name -Port $Port
  if ($occupied) {
    $record = Get-StateService -Name $Name
    if ($null -eq $record -or -not (Test-ProcessRecordAlive $record)) {
      $owner = @(Get-OutboundPortOwner -Port $Port) | Select-Object -First 1
      $process = Get-Process -Id $owner -ErrorAction Stop
      $record = [pscustomobject]@{
        Name = $Name
        Pid = $process.Id
        StartedAt = $process.StartTime.ToUniversalTime().ToString('o')
        Owned = $false
        Stdout = $null
        Stderr = $null
      }
      Set-StateService -Record $record
    }
    Write-Host "Reusing verified $Name process on port $Port."
    return $record
  }
  $record = Start-OutboundManagedProcess -Name $Name -FilePath $FilePath -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory -LogDirectory $logDirectory
  [void]$startedThisRun.Add($record)
  Set-StateService -Record $record
  Write-Host "Started $Name (PID $($record.Pid))."
  return $record
}

function Find-VerifiedWorkerProcess {
  param([string]$Hint)
  $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ([string]$_.CommandLine).IndexOf($Hint, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    (Test-RepositoryProcess -ProcessId ([int]$_.ProcessId) -RepositoryRoot $repositoryRoot)
  })
  if ($matches.Count -gt 1) { throw "Multiple verified worker processes match $Hint; stop duplicates before continuing." }
  return $matches | Select-Object -First 1
}

function Start-OrReuseWorker {
  param([string]$Name, [string]$Hint, [string]$FilePath, [string[]]$Arguments)
  $record = Get-StateService -Name $Name
  if ($null -ne $record -and (Test-ProcessRecordAlive $record)) {
    Write-Host "Reusing verified $Name process."
    return $record
  }
  $existing = Find-VerifiedWorkerProcess -Hint $Hint
  if ($null -ne $existing) {
    $process = Get-Process -Id ([int]$existing.ProcessId) -ErrorAction Stop
    $record = [pscustomobject]@{
      Name = $Name
      Pid = $process.Id
      StartedAt = $process.StartTime.ToUniversalTime().ToString('o')
      Owned = $false
      Stdout = $null
      Stderr = $null
    }
    Set-StateService -Record $record
    Write-Host "Reusing verified $Name process."
    return $record
  }
  $record = Start-OutboundManagedProcess -Name $Name -FilePath $FilePath -ArgumentList $Arguments `
    -WorkingDirectory $repositoryRoot -LogDirectory $logDirectory
  [void]$startedThisRun.Add($record)
  Set-StateService -Record $record
  Start-Sleep -Seconds 2
  if (-not (Test-ProcessRecordAlive $record)) { throw "$Name exited during startup. Check its private runtime log." }
  Write-Host "Started $Name (PID $($record.Pid))."
  return $record
}

function Wait-ApiProcess {
  if (-not (Wait-TcpEndpoint -HostName '127.0.0.1' -Port 3001 -TimeoutSeconds $StartupTimeoutSeconds)) {
    throw 'API did not open port 3001 before the timeout.'
  }
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  do {
    try {
      $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:3001/api/auth/me')
      $request.Method = 'GET'; $request.Timeout = 3000
      $response = $request.GetResponse(); $response.Close(); return
    } catch [Net.WebException] {
      if ($null -ne $_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
        $_.Exception.Response.Close()
        if ($status -in @(200, 401, 403, 404)) { return }
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw 'API did not return an identifiable HTTP response before the timeout.'
}

function Stop-NewResources {
  foreach ($record in @($startedThisRun.ToArray() | Sort-Object { $_.Name -eq 'scheduler' } -Descending)) {
    Stop-OutboundManagedProcess -Record $record
  }
  if ($microSipStartedThisRun) {
    try {
      if (-not (Test-FreeSwitchActiveExtension -User '1001')) {
        $exe = Find-MicroSipExecutable -ExplicitPath $MicroSipPath
        $exit = Start-Process -FilePath $exe -ArgumentList @('/exit') -PassThru -WindowStyle Hidden
        [void]$exit.WaitForExit(5000)
      }
    } catch { }
  }
  if ($containerStartedThisRun) {
    & docker stop ai-call-freeswitch | Out-Null
  }
}

try {
  if (-not (Test-Path -LiteralPath $runtimeRoot)) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  }
  Protect-OutboundPath -Path $runtimeRoot -Directory
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $mutexSuffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($repositoryRoot)))).Replace('-', '').Substring(0, 16) } finally { $hash.Dispose() }
  $mutex = New-Object Threading.Mutex($false, "Local\AiCallOutbound-$mutexSuffix")
  $mutexHeld = $mutex.WaitOne(0)
  if (-not $mutexHeld) { throw 'Another dev:outbound orchestration run is already in progress.' }

  $existingState = Read-OutboundRuntimeState -Path $statePath
  if ($null -eq $existingState) {
    $script:state = [pscustomobject]@{
      Version = 1
      RepositoryRoot = $repositoryRoot
      HostIPv4 = $null
      UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
      Container = [pscustomobject]@{ Name = 'ai-call-freeswitch'; Owned = $false; WasRunning = $false }
      Services = @()
    }
  } else {
    if ([IO.Path]::GetFullPath([string]$existingState.RepositoryRoot) -ne $repositoryRoot) {
      throw 'The outbound runtime state belongs to another repository.'
    }
    $script:state = $existingState
    if ($null -eq $script:state.Services) { $script:state.Services = @() }
  }

  if (-not $HostIPv4) { $HostIPv4 = $env:OUTBOUND_HOST_IPV4 }
  $resolvedHost = Resolve-OutboundHostIPv4 -HostIPv4 $HostIPv4
  $script:state.HostIPv4 = $resolvedHost

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required.' }
  if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw 'pnpm.cmd is required.' }
  & docker version --format '{{.Server.Version}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready.' }
  if (-not (Test-TcpEndpoint -HostName '127.0.0.1' -Port 5432)) { throw 'PostgreSQL is not ready on 127.0.0.1:5432.' }

  $voicePython = Join-Path $repositoryRoot 'services\voice-agent\.venv\Scripts\python.exe'
  $funAsrPython = Join-Path $repositoryRoot 'services\funasr-server\.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $voicePython)) { throw 'Voice Agent virtualenv is missing. Run its setup first.' }
  if (-not (Test-Path -LiteralPath $funAsrPython)) { throw 'FunASR virtualenv is missing. Run pnpm dev:funasr:setup first.' }

  $sipPassword = Get-OrCreateOutboundSipSecret -Path $secretPath
  $vars = Write-FreeSwitchRuntimeVars -Path $varsPath -HostIPv4 $resolvedHost -SipPassword $sipPassword
  $env:FREESWITCH_VARS_FILE = $varsPath

  $containerInfo = @(& docker ps -a --filter 'name=^/ai-call-freeswitch$' --format '{{.Names}}|{{.Status}}')
  $wasRunning = @(& docker ps --filter 'name=^/ai-call-freeswitch$' --format '{{.Names}}').Count -gt 0
  $containerInspect = $null
  if ($containerInfo.Count -gt 0) {
    $containerInspect = @((& docker inspect ai-call-freeswitch | ConvertFrom-Json))[0]
    $composeFile = [string]$containerInspect.Config.Labels.'com.docker.compose.project.config_files'
    if ([IO.Path]::GetFullPath($composeFile) -ne [IO.Path]::GetFullPath($composePath)) {
      throw 'The ai-call-freeswitch container is not owned by this repository.'
    }
  }
  $sipContainers = @(& docker ps --filter 'publish=5060' --format '{{.Names}}' | Where-Object { $_ -ne 'ai-call-freeswitch' })
  if ($sipContainers.Count -gt 0) { throw 'SIP port 5060 is published by another Docker container.' }
  $mountedVars = if ($wasRunning) {
    [string](@($containerInspect.Mounts | Where-Object { $_.Destination -eq '/usr/local/freeswitch/conf/vars.xml' }) | Select-Object -ExpandProperty Source -First 1)
  } else { '' }
  $forceRecreate = $vars.Changed -or ($wasRunning -and [IO.Path]::GetFullPath($mountedVars) -ne [IO.Path]::GetFullPath($varsPath))
  if ($forceRecreate -and $wasRunning -and (Test-FreeSwitchActiveExtension -User '1001')) {
    throw 'Account 1001 has an active channel; refusing to recreate FreeSWITCH.'
  }
  $composeArguments = @('compose', '-f', $composePath, 'up', '-d', '--no-deps')
  if ($forceRecreate) { $composeArguments += '--force-recreate' }
  $composeArguments += 'freeswitch'
  & docker @composeArguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'FreeSWITCH compose startup failed.' }
  $containerStartedThisRun = -not $wasRunning
  $script:state.Container = [pscustomobject]@{ Name = 'ai-call-freeswitch'; Owned = $containerStartedThisRun; WasRunning = $wasRunning }
  Write-OutboundRuntimeState -Path $statePath -State $script:state
  if (-not (Wait-TcpEndpoint -HostName '127.0.0.1' -Port 18021 -TimeoutSeconds 30)) { throw 'FreeSWITCH ESL did not become ready.' }
  [void](Assert-FreeSwitchLocalReady -HostIPv4 $resolvedHost)
  Write-Host 'FreeSWITCH ESL, advertised media addresses, internal profile, and mod_audio_fork are ready.'

  foreach ($entry in @(
    @{ Name = 'FunASR'; Port = 10095 },
    @{ Name = 'API'; Port = 3001 },
    @{ Name = 'Dashboard'; Port = 3000 },
    @{ Name = 'Voice Agent'; Port = 8090 },
    @{ Name = 'Event Worker'; Port = 3012 }
  )) { [void](Assert-PortIsReusable -Name $entry.Name -Port $entry.Port) }

  $pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
  $env:OUTBOUND_REAL_CALL_MODE = 'true'
  $env:FREESWITCH_ESL_HOST = '127.0.0.1'
  $env:FREESWITCH_ESL_PORT = '18021'
  $env:FREESWITCH_DIAL_STRING = 'user/{to}'
  $env:FREESWITCH_AUDIO_FORK_ENABLED = 'true'
  $env:FREESWITCH_AUDIO_MODULE = 'audio_fork'
  $env:FREESWITCH_AUDIO_FORK_URL = 'ws://host.docker.internal:8090/audio-stream'
  $env:INTERNAL_API_BASE_URL = 'http://127.0.0.1:3001/api'
  $env:API_BASE_URL = 'http://127.0.0.1:3001/api'
  $env:FUNASR_WS_URL = 'ws://127.0.0.1:10095'
  $env:VOICE_AGENT_WS_HOST = '0.0.0.0'
  $env:VOICE_AGENT_WS_PORT = '8090'

  $env:PYTHONPATH = Join-Path $repositoryRoot 'services\funasr-server\src'
  [void](Start-OrReusePortService -Name 'funasr' -Port 10095 -FilePath $funAsrPython -Arguments @('-m', 'funasr_server') -WorkingDirectory (Join-Path $repositoryRoot 'services\funasr-server'))
  [void](Wait-HttpReady -Uri 'http://127.0.0.1:10095/health' -TimeoutSeconds $StartupTimeoutSeconds -Validate {
    param($health) $health.status -eq 'ok' -and $health.models_loaded -eq $true
  })
  Write-Host 'FunASR models are ready.'

  [void](Start-OrReusePortService -Name 'api' -Port 3001 -FilePath $pnpm -Arguments @('--filter', '@ai-call/api', 'dev') -WorkingDirectory $repositoryRoot)
  Wait-ApiProcess
  Write-Host 'API is ready.'

  [void](Start-OrReusePortService -Name 'dashboard' -Port 3000 -FilePath $pnpm -Arguments @('--filter', '@ai-call/dashboard', 'dev') -WorkingDirectory $repositoryRoot)
  [void](Wait-HttpReady -Uri 'http://127.0.0.1:3000/' -TimeoutSeconds $StartupTimeoutSeconds -Validate { param($body) $null -ne $body })
  Write-Host 'Dashboard is ready.'

  $env:PYTHONPATH = Join-Path $repositoryRoot 'services\voice-agent\src'
  [void](Start-OrReusePortService -Name 'voice-agent' -Port 8090 -FilePath $voicePython -Arguments @('-m', 'voice_agent.main') -WorkingDirectory (Join-Path $repositoryRoot 'services\voice-agent'))
  [void](Wait-HttpReady -Uri 'http://127.0.0.1:8090/health/live' -TimeoutSeconds $StartupTimeoutSeconds)
  try {
    [void](Wait-HttpReady -Uri 'http://127.0.0.1:8090/health/ready' -TimeoutSeconds $StartupTimeoutSeconds)
  } catch {
    throw 'Voice Agent is live but not ready. Configure a non-mock TTS provider and verify FunASR/ESL, then inspect its private runtime log.'
  }
  Write-Host 'Voice Agent is ready for real outbound audio.'

  [void](Start-OrReusePortService -Name 'event-worker' -Port 3012 -FilePath $pnpm -Arguments @('--filter', '@ai-call/api', 'dev:freeswitch-events') -WorkingDirectory $repositoryRoot)
  [void](Wait-HttpReady -Uri 'http://127.0.0.1:3012/health/live' -TimeoutSeconds 30)
  try {
    [void](Wait-HttpReady -Uri 'http://127.0.0.1:3012/health/ready' -TimeoutSeconds $StartupTimeoutSeconds)
  } catch {
    throw 'Event Worker is live but not ready. Verify ESL authentication/subscription and inspect its private runtime log.'
  }
  Write-Host 'FreeSWITCH Event Worker is authenticated, subscribed, and ready.'

  $microSipWasRunning = @(Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue).Count -gt 0
  $microSipExecutable = Find-MicroSipExecutable -ExplicitPath $MicroSipPath
  $microSipIni = Find-MicroSipIni -ExplicitPath $MicroSipIniPath -ExecutablePath $microSipExecutable
  $microSipUpdate = Set-MicroSipLocalAccount -IniPath $microSipIni -HostIPv4 $resolvedHost -SipPassword $sipPassword
  if ($microSipUpdate.Changed) {
    [void](Restart-MicroSipSafely -ExecutablePath $microSipExecutable)
    $microSipStartedThisRun = -not $microSipWasRunning
  } elseif (-not $microSipWasRunning) {
    [void](Start-Process -FilePath $microSipExecutable -PassThru)
    $microSipStartedThisRun = $true
  }
  if (-not (Wait-FreeSwitchRegistration -User '1001' -TimeoutSeconds 45)) {
    throw 'MicroSIP 1001 did not register; Outbox and Scheduler were not started.'
  }
  Write-Host 'MicroSIP 1001 registration is ready.'

  [void](Start-OrReuseWorker -Name 'outbox' -Hint 'outbox-worker.main' -FilePath $pnpm -Arguments @('--filter', '@ai-call/api', 'dev:outbox'))
  Write-Host 'Outbox Worker is running.'

  [void](Start-OrReuseWorker -Name 'scheduler' -Hint 'scheduler-worker.main' -FilePath $pnpm -Arguments @('--filter', '@ai-call/api', 'dev:scheduler'))
  Write-Host 'Scheduler is running (started last).'

  $script:state.UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
  Write-OutboundRuntimeState -Path $statePath -State $script:state
  Write-Host ''
  Write-Host 'Outbound runtime READY: Dashboard -> Scheduler -> Outbox -> FreeSWITCH -> MicroSIP 1001.'
  Write-Host 'Create an immediate 1001 task in the Dashboard; use pnpm smoke:outbound-runtime -TaskId <id> only to observe it.'
} catch {
  Stop-NewResources
  throw
} finally {
  if ($mutexHeld -and $null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { } }
  if ($null -ne $mutex) { $mutex.Dispose() }
}
