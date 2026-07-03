param(
  [string]$FreeSwitchHome = "H:\Program Files\FreeSWITCH",
  [string]$Password = "ClueCon"
)

$ErrorActionPreference = "Stop"
$cli = Join-Path $FreeSwitchHome "fs_cli.exe"
if (-not (Test-Path -LiteralPath $cli)) {
  throw "fs_cli not found: $cli"
}

Write-Host "=== FreeSWITCH status ==="
& $cli -H 127.0.0.1 -P 8021 -p $Password -x "status"
Write-Host "=== SIP profiles ==="
& $cli -H 127.0.0.1 -P 8021 -p $Password -x "sofia status"
Write-Host "=== Registered softphones ==="
& $cli -H 127.0.0.1 -P 8021 -p $Password -x "show registrations"

