param(
  [string]$HostIPv4 = $env:HOST_IPV4,
  [string]$MicroSipPath,
  [string]$MicroSipIniPath,
  [int]$RegistrationTimeoutSeconds = 30,
  [switch]$FreeSwitchAlreadyConfigured
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $PSScriptRoot 'lib\OutboundLocal.psm1') -Force

$resolvedHost = Resolve-OutboundHostIPv4 -HostIPv4 $HostIPv4
$runtimeRoot = Join-Path $repositoryRoot '.runtime'
$secretPath = Join-Path $runtimeRoot 'microsip.env'
$varsPath = Join-Path $runtimeRoot 'freeswitch\vars.xml'
$sipPassword = Get-OrCreateOutboundSipSecret -Path $secretPath
$vars = Write-FreeSwitchRuntimeVars -Path $varsPath -HostIPv4 $resolvedHost -SipPassword $sipPassword

if (-not $FreeSwitchAlreadyConfigured) {
  if ((Test-FreeSwitchActiveExtension -User '1001')) {
    throw 'Account 1001 has an active channel; refusing to reload FreeSWITCH credentials.'
  }
  $env:FREESWITCH_VARS_FILE = $varsPath
  $composePath = Join-Path $repositoryRoot 'freeswitch\docker-compose.yml'
  $existing = @(& docker ps -a --filter 'name=^/ai-call-freeswitch$' --format '{{.Names}}')
  if ($existing.Count -gt 0) {
    $inspect = @((& docker inspect ai-call-freeswitch | ConvertFrom-Json))[0]
    $configuredBy = [string]$inspect.Config.Labels.'com.docker.compose.project.config_files'
    if ([IO.Path]::GetFullPath($configuredBy) -ne [IO.Path]::GetFullPath($composePath)) {
      throw 'The ai-call-freeswitch container is not owned by this repository.'
    }
  }
  $arguments = @('compose', '-f', $composePath, 'up', '-d', '--no-deps')
  if ($vars.Changed) { $arguments += '--force-recreate' }
  $arguments += 'freeswitch'
  & docker @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'FreeSWITCH could not be started with the private runtime vars file.' }
}
if (-not (Wait-TcpEndpoint -HostName '127.0.0.1' -Port 18021 -TimeoutSeconds 30)) {
  throw 'FreeSWITCH ESL did not become ready after applying runtime vars.'
}
[void](Assert-FreeSwitchLocalReady -HostIPv4 $resolvedHost)

$executable = Find-MicroSipExecutable -ExplicitPath $MicroSipPath
$ini = Find-MicroSipIni -ExplicitPath $MicroSipIniPath -ExecutablePath $executable
$update = Set-MicroSipLocalAccount -IniPath $ini -HostIPv4 $resolvedHost -SipPassword $sipPassword
$running = @(Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue)
if ($update.Changed) {
  [void](Restart-MicroSipSafely -ExecutablePath $executable)
} elseif ($running.Count -eq 0) {
  [void](Start-Process -FilePath $executable -PassThru)
}

if (-not (Wait-FreeSwitchRegistration -User '1001' -TimeoutSeconds $RegistrationTimeoutSeconds)) {
  throw 'MicroSIP account 1001 did not register before the timeout. Check the host IP, SIP port, and FreeSWITCH logs.'
}

Write-Host "MicroSIP 1001 is registered through $resolvedHost`:5060 (local source port 5062)."
if ($update.Changed) { Write-Host 'MicroSIP.ini was updated and a private backup was created.' }
