param(
  [string]$ApiBaseUrl = 'http://127.0.0.1:3001/api',
  [string]$HostIPv4 = $env:HOST_IPV4,
  [int]$TimeoutSeconds = 180,
  [string]$TaskId,
  [switch]$ObserveNextTask,
  [switch]$SkipTask
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $PSScriptRoot 'lib\OutboundLocal.psm1') -Force

if ($TaskId -and $ObserveNextTask) { throw 'Use either -TaskId or -ObserveNextTask, not both.' }

function Import-ServiceAuthFromDotEnv {
  $path = Join-Path $repositoryRoot '.env'
  if (-not (Test-Path -LiteralPath $path)) { return }
  $text = [IO.File]::ReadAllText($path)
  foreach ($name in @('SERVICE_API_TOKEN', 'SERVICE_API_REQUIRE_SIGNATURE', 'SERVICE_API_SIGNING_SECRET')) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name, 'Process'))) { continue }
    $match = [regex]::Match($text, "(?m)^$([regex]::Escape($name))=(.*)$")
    if (-not $match.Success) { continue }
    $value = $match.Groups[1].Value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

Import-ServiceAuthFromDotEnv

function Test-HttpGet {
  param([string]$Uri)
  try {
    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Method = 'GET'; $request.Timeout = 3000
    $response = $request.GetResponse()
    $status = [int]$response.StatusCode
    $response.Close()
    return $status -ge 200 -and $status -lt 500
  } catch [Net.WebException] {
    if ($null -ne $_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      $_.Exception.Response.Close()
      return $status -in @(401, 403, 404)
    }
    return $false
  }
}

function Test-JsonHealth {
  param([string]$Uri, [scriptblock]$Validate)
  try {
    $body = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 3
    return [bool](& $Validate $body)
  } catch { return $false }
}

function Get-ServiceHeaders {
  $headers = @{ Accept = 'application/json' }
  $token = $env:SERVICE_API_TOKEN
  if (-not [string]::IsNullOrWhiteSpace($token)) {
    $headers['X-Service-Token'] = $token
    if ([string]$env:SERVICE_API_REQUIRE_SIGNATURE -and $env:SERVICE_API_REQUIRE_SIGNATURE.ToLowerInvariant() -eq 'true') {
      $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
      $secret = if ($env:SERVICE_API_SIGNING_SECRET) { $env:SERVICE_API_SIGNING_SECRET } else { $token }
      $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
      try {
        $signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$timestamp.$token"))
      } finally { $hmac.Dispose() }
      $headers['X-Service-Timestamp'] = $timestamp
      $headers['X-Service-Signature'] = ([BitConverter]::ToString($signatureBytes)).Replace('-', '').ToLowerInvariant()
    }
  }
  return $headers
}

function Get-DashboardHeaders {
  $headers = @{ Accept = 'application/json' }
  if ($env:AI_CALL_ACCESS_TOKEN) {
    $headers.Authorization = "Bearer $($env:AI_CALL_ACCESS_TOKEN)"
  } elseif ($env:AI_CALL_DASHBOARD_COOKIE) {
    $headers.Cookie = $env:AI_CALL_DASHBOARD_COOKIE
  } else {
    throw 'ObserveNextTask needs an existing Dashboard session via AI_CALL_ACCESS_TOKEN or AI_CALL_DASHBOARD_COOKIE.'
  }
  return $headers
}

function Get-TaskContext {
  param([string]$Id)
  return Invoke-RestMethod -Uri "$ApiBaseUrl/tasks/$Id/context" -Method Get -Headers (Get-ServiceHeaders) -TimeoutSec 5
}

function Get-TaskListItems {
  $response = Invoke-RestMethod -Uri "$ApiBaseUrl/tasks?limit=50" -Method Get -Headers (Get-DashboardHeaders) -TimeoutSec 5
  if ($null -ne $response.PSObject.Properties['items']) { return @($response.items) }
  return @($response)
}

$resolvedHost = Resolve-OutboundHostIPv4 -HostIPv4 $HostIPv4
$checks = New-Object System.Collections.ArrayList
[void]$checks.Add([pscustomobject]@{ Name = 'PostgreSQL'; Ready = (Test-TcpEndpoint -HostName '127.0.0.1' -Port 5432); Detail = '127.0.0.1:5432' })
[void]$checks.Add([pscustomobject]@{ Name = 'API'; Ready = ((Test-TcpEndpoint -HostName '127.0.0.1' -Port 3001) -and (Test-HttpGet -Uri "$ApiBaseUrl/auth/me")); Detail = $ApiBaseUrl })
[void]$checks.Add([pscustomobject]@{ Name = 'Dashboard'; Ready = (Test-HttpGet -Uri 'http://127.0.0.1:3000/'); Detail = 'http://127.0.0.1:3000' })
[void]$checks.Add([pscustomobject]@{ Name = 'FunASR'; Ready = (Test-JsonHealth -Uri 'http://127.0.0.1:10095/health' -Validate { param($h) $h.status -eq 'ok' -and $h.models_loaded -eq $true }); Detail = 'models loaded' })
[void]$checks.Add([pscustomobject]@{ Name = 'Voice Agent'; Ready = (Test-JsonHealth -Uri 'http://127.0.0.1:8090/health/ready' -Validate { param($h) $null -ne $h }); Detail = 'real outbound ready' })
[void]$checks.Add([pscustomobject]@{ Name = 'Event Worker'; Ready = (Test-JsonHealth -Uri 'http://127.0.0.1:3012/health/ready' -Validate { param($h) $null -ne $h }); Detail = 'ESL subscribed' })
[void]$checks.Add([pscustomobject]@{ Name = 'FreeSWITCH ESL'; Ready = (Test-TcpEndpoint -HostName '127.0.0.1' -Port 18021); Detail = '127.0.0.1:18021' })

$freeSwitchReady = $false
if (($checks | Where-Object { $_.Name -eq 'FreeSWITCH ESL' }).Ready) {
  try { [void](Assert-FreeSwitchLocalReady -HostIPv4 $resolvedHost); $freeSwitchReady = $true } catch { $freeSwitchReady = $false }
}
[void]$checks.Add([pscustomobject]@{ Name = 'FreeSWITCH media'; Ready = $freeSwitchReady; Detail = "advertised $resolvedHost" })
[void]$checks.Add([pscustomobject]@{ Name = 'MicroSIP 1001'; Ready = (Test-FreeSwitchRegistration -User '1001'); Detail = 'real SIP registration' })

Write-Host '=== Outbound runtime readiness (read-only) ==='
$checks | Format-Table -AutoSize
$failed = @($checks | Where-Object { -not $_.Ready })
if ($failed.Count -gt 0) {
  throw "Outbound runtime is not ready: $(($failed | Select-Object -ExpandProperty Name) -join ', ')."
}

if ($SkipTask -or (-not $TaskId -and -not $ObserveNextTask)) {
  Write-Host 'Readiness checks passed. No task was created, published, or dispatched.'
  exit 0
}

if ($ObserveNextTask) {
  $baseline = @(Get-TaskListItems | Select-Object -ExpandProperty id)
  $startedAt = [DateTimeOffset]::UtcNow
  Write-Host 'Waiting for a new 1001 task created from the Dashboard...'
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    foreach ($candidate in @(Get-TaskListItems)) {
      if ($baseline -notcontains $candidate.id -and $candidate.to -eq '1001' -and
          [DateTimeOffset]::Parse($candidate.createdAt) -ge $startedAt) {
        $TaskId = $candidate.id
        break
      }
    }
    if ($TaskId) { break }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  if (-not $TaskId) { throw 'No new Dashboard-created 1001 task appeared before the timeout.' }
}

Write-Host "Observing task $TaskId without mutating it."
$sawProgress = $false
$sawAnswer = $false
$sawHangup = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  $task = Get-TaskContext -Id $TaskId
  if ($task.to -ne '1001') { throw 'The observed task does not target MicroSIP extension 1001.' }
  $attempt = @($task.attempts)[0]
  if ($null -ne $attempt) {
    if ($attempt.ringingAt) { $sawProgress = $true }
    if ($attempt.answeredAt) { $sawAnswer = $true }
    if ($attempt.endedAt -and $task.status -in @('completed', 'no_answer', 'failed')) { $sawHangup = $true }
    Write-Host "status=$($task.status) attempt=$($attempt.id) progress=$sawProgress answer=$sawAnswer hangup=$sawHangup"
  } else {
    Write-Host "status=$($task.status) attempt=<pending> progress=false answer=false hangup=false"
  }
  if ($sawProgress -and $sawAnswer -and $sawHangup) { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)

if (-not $sawProgress) { throw 'No authoritative ringingAt field from a real PROGRESS event was observed.' }
if (-not $sawAnswer) { throw 'No authoritative answeredAt field from a real ANSWER event was observed.' }
if (-not $sawHangup) { throw 'No terminal endedAt field from a real HANGUP_COMPLETE event was observed.' }
Write-Host "Real outbound observation passed for task $TaskId."
