param(
  [string]$ApiBaseUrl = "http://localhost:3001/api",
  [string]$DashboardHost = "127.0.0.1",
  [int]$DashboardPort = 3000,
  [string]$ServiceHost = "127.0.0.1",
  [int]$ApiPort = 3001,
  [int]$VoiceAgentPort = 8090,
  [int]$FunAsrPort = 10095,
  [int]$FreeSwitchEslPort = 18021,
  [int]$PostgresPort = 5432,
  [string]$AdminEmail = "",
  [string]$AdminPassword = "",
  [string]$To = "1001",
  [ValidateSet("collection", "ecommerce", "presale")]
  [string]$Scenario = "ecommerce",
  [int]$TimeoutSeconds = 45,
  [switch]$DispatchNow,
  [switch]$SkipTask
)

$ErrorActionPreference = "Stop"

if (-not $AdminEmail) {
  $AdminEmail = if ($env:DEFAULT_ADMIN_EMAIL) { $env:DEFAULT_ADMIN_EMAIL } else { "admin@ai-call.local" }
}
if (-not $AdminPassword) {
  $AdminPassword = if ($env:DEFAULT_ADMIN_PASSWORD) { $env:DEFAULT_ADMIN_PASSWORD } else { "admin123" }
}

function Test-TcpPort {
  param(
    [string]$Name,
    [string]$HostName,
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(1000, $false)
    if (-not $ok) {
      return [pscustomobject]@{ Name = $Name; Address = "$HostName`:$Port"; Ready = $false; Detail = "timeout" }
    }
    $client.EndConnect($async)
    return [pscustomobject]@{ Name = $Name; Address = "$HostName`:$Port"; Ready = $true; Detail = "listening" }
  } catch {
    return [pscustomobject]@{ Name = $Name; Address = "$HostName`:$Port"; Ready = $false; Detail = $_.Exception.Message }
  } finally {
    $client.Close()
  }
}

function Invoke-ApiJson {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $uri = "$ApiBaseUrl$Path"
  $args = @{
    Uri = $uri
    Method = $Method
    WebSession = $script:Session
    Headers = @{ Accept = "application/json" }
  }
  if ($null -ne $Body) {
    $args.ContentType = "application/json"
    $args.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  return Invoke-RestMethod @args
}

Write-Host "=== Runtime readiness ==="
$checks = @(
  (Test-TcpPort -Name "PostgreSQL" -HostName $ServiceHost -Port $PostgresPort),
  (Test-TcpPort -Name "NestJS API" -HostName $ServiceHost -Port $ApiPort),
  (Test-TcpPort -Name "Dashboard" -HostName $DashboardHost -Port $DashboardPort),
  (Test-TcpPort -Name "Voice Agent WS" -HostName $ServiceHost -Port $VoiceAgentPort),
  (Test-TcpPort -Name "FunASR WS" -HostName $ServiceHost -Port $FunAsrPort),
  (Test-TcpPort -Name "FreeSWITCH ESL" -HostName $ServiceHost -Port $FreeSwitchEslPort)
)
$checks | Format-Table -AutoSize

if ($SkipTask) {
  Write-Host "SkipTask set; readiness check complete."
  exit 0
}

$apiCheck = $checks | Where-Object { $_.Name -eq "NestJS API" }
if (-not $apiCheck.Ready) {
  throw "NestJS API is not reachable at $($apiCheck.Address). Start API before task smoke."
}

$script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Write-Host "=== Login API ==="
Invoke-ApiJson -Method POST -Path "/auth/login" -Body @{
  email = $AdminEmail
  password = $AdminPassword
} | Out-Null
Write-Host "Logged in as $AdminEmail"

Write-Host "=== Select published flow ==="
$flows = Invoke-ApiJson -Method GET -Path "/task-flows?status=published"
if (-not $flows -or $flows.Count -eq 0) {
  Write-Host "No published flow found; trying to publish the first draft flow..."
  $draftFlows = Invoke-ApiJson -Method GET -Path "/task-flows?status=draft"
  if (-not $draftFlows -or $draftFlows.Count -eq 0) {
    throw "No task flow found. Run Prisma seed or create a flow in Dashboard."
  }
  $draft = @($draftFlows)[0]
  $published = Invoke-ApiJson -Method POST -Path "/task-flows/$($draft.id)/publish"
  Write-Host "Published draft flow: $($published.name) ($($published.id))"
  $flows = @($published)
}
$flow = @($flows)[0]
Write-Host "Using flow: $($flow.name) ($($flow.id))"

Write-Host "=== Create outbound task ==="
$scheduledAt = (Get-Date).ToUniversalTime().ToString("o")
$task = Invoke-ApiJson -Method POST -Path "/tasks" -Body @{
  to = $To
  scenario = $Scenario
  flowId = $flow.id
  scheduledAt = $scheduledAt
  variables = @{
    company = "RuntimeSmoke"
    orderNo = "SMOKE-$((Get-Date).ToString('yyyyMMddHHmmss'))"
    activity = "runtime smoke"
  }
}
Write-Host "Created task $($task.id), status=$($task.status), scheduledAt=$($task.scheduledAt)"

if ($DispatchNow) {
  Write-Host "=== Manual dispatch ==="
  $task = Invoke-ApiJson -Method POST -Path "/tasks/$($task.id)/dispatch"
  Write-Host "Dispatched task $($task.id), status=$($task.status)"
}

Write-Host "=== Poll task dispatch/outbox state ==="
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$last = $task
do {
  Start-Sleep -Seconds 2
  $last = Invoke-ApiJson -Method GET -Path "/tasks/$($task.id)"
  $attempt = @($last.attempts)[0]
  $attemptInfo = if ($attempt) {
    "attempt=$($attempt.id) attemptStatus=$($attempt.status) ringingAt=$($attempt.ringingAt)"
  } else {
    "attempt=<none>"
  }
  Write-Host "taskStatus=$($last.status) attemptCount=$($last.attemptCount) $attemptInfo"

  if ($last.status -in @("failed", "no_answer", "completed", "in_call")) { break }
  if ($attempt -and $attempt.ringingAt) { break }
} while ((Get-Date) -lt $deadline)

if ($last.attemptCount -lt 1) {
  throw "Task was not dispatched. Check TASK_SCHEDULER_ENABLED or run with -DispatchNow."
}

$latestAttempt = @($last.attempts)[0]
if (-not $latestAttempt.ringingAt) {
  throw "Task created an attempt but FreeSWITCH dispatch was not accepted. Check ESL/registrations/outbox logs."
}

Write-Host "Runtime outbound dispatch smoke passed for task $($last.id)."
