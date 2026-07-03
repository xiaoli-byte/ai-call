param(
  [string]$FreeSwitchHome = "H:\Program Files\FreeSWITCH"
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $FreeSwitchHome "FreeSwitchConsole.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "FreeSWITCH executable not found: $exe"
}

$dockerContainer = docker ps --filter "name=^/ai-call-freeswitch$" --format "{{.Names}}"
if ($dockerContainer -eq "ai-call-freeswitch") {
  Write-Host "Stopping Docker FreeSWITCH to release SIP/ESL ports..."
  docker stop ai-call-freeswitch | Out-Null
}

$releaseDeadline = (Get-Date).AddSeconds(15)
do {
  $occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 5060, 8021 }
  if ($occupied) { Start-Sleep -Milliseconds 500 }
} until (-not $occupied -or (Get-Date) -ge $releaseDeadline)
if ($occupied) {
  $owners = ($occupied | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
  throw "Ports 5060 or 8021 are still occupied by process IDs: $owners"
}

Write-Host "Starting local FreeSWITCH from $FreeSwitchHome ..."
$runtimeRoot = Join-Path $PSScriptRoot "..\runtime"
$confDir = Join-Path $runtimeRoot "conf"
$runDir = Join-Path $runtimeRoot "run"
$logDir = Join-Path $runtimeRoot "log"
$dbDir = Join-Path $runtimeRoot "db"
$recordingsDir = Join-Path $runtimeRoot "recordings"
$storageDir = Join-Path $runtimeRoot "storage"
@($runDir, $logDir, $dbDir, $recordingsDir, $storageDir) | ForEach-Object {
  New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
if (-not (Test-Path -LiteralPath (Join-Path $confDir "freeswitch.xml"))) {
  Write-Host "Preparing a local copy of the FreeSWITCH configuration..."
  Copy-Item -Path (Join-Path $FreeSwitchHome "conf") -Destination $runtimeRoot -Recurse -Force
}

# The Windows package enables WSS but may not ship a usable WSS certificate.
# A bad WSS.PEM makes the whole IPv4 internal profile fail, while local SIP
# softphones only need UDP/TCP 5060. Remove WSS from the runtime config copy.
$internalProfile = Join-Path $confDir "sip_profiles\internal.xml"
[xml]$internalXml = Get-Content -LiteralPath $internalProfile
$wssNodes = $internalXml.SelectNodes("//param[@name='wss-binding']")
foreach ($node in $wssNodes) {
  [void]$node.ParentNode.RemoveChild($node)
}
$internalXml.Save($internalProfile)

$arguments = @(
  "-nc",
  "-conf", "`"$confDir`"",
  "-run", "`"$runDir`"",
  "-log", "`"$logDir`"",
  "-db", "`"$dbDir`"",
  "-recordings", "`"$recordingsDir`"",
  "-storage", "`"$storageDir`""
)
Start-Process -FilePath $exe -WorkingDirectory $FreeSwitchHome -ArgumentList $arguments

$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 500
  $ready = Test-NetConnection 127.0.0.1 -Port 8021 -InformationLevel Quiet -WarningAction SilentlyContinue
} until ($ready -or (Get-Date) -ge $deadline)

if (-not $ready) {
  throw "FreeSWITCH did not open ESL port 8021 within 15 seconds. Check $logDir."
}

Write-Host "Local FreeSWITCH is ready. Run: pnpm freeswitch:local:check"
