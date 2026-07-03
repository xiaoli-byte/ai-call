param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern("^[0-9]+$")]
  [string]$Extension,
  [string]$FreeSwitchHome = "H:\Program Files\FreeSWITCH",
  [string]$Password = "ClueCon"
)

$ErrorActionPreference = "Stop"
$cli = Join-Path $FreeSwitchHome "fs_cli.exe"
$uuid = (& $cli -H 127.0.0.1 -P 8021 -p $Password -x "create_uuid").Trim()
if ($uuid -notmatch "^[0-9a-f-]{36}$") {
  throw "Could not create a FreeSWITCH call UUID: $uuid"
}

Write-Host "Calling SIP extension $Extension (call ID: $uuid)..."
$command = "originate {origination_uuid=$uuid,origination_caller_id_number=1000}user/$Extension &park()"
$result = (& $cli -H 127.0.0.1 -P 8021 -p $Password -x $command).Trim()
Write-Host $result
if ($result -like "-ERR*") {
  throw "Call failed. Confirm extension $Extension is registered with pnpm freeswitch:local:check."
}
