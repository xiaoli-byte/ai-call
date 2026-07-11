Set-StrictMode -Version Latest

$script:MicroSipAccountUser = '1001'
$script:ExcludedAdapterPattern = '(?i)(loopback|apipa|docker|wsl|vethernet|hyper-v|tunnel|teredo|isatap|tap|vpn|virtual)'

function Test-UsableOutboundIPv4 {
  param([Parameter(Mandatory = $true)][string]$Address)

  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $false }
  if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $bytes = $parsed.GetAddressBytes()
  if ($bytes[0] -eq 0 -or $bytes[0] -eq 127 -or $bytes[0] -ge 224) { return $false }
  if ($bytes[0] -eq 169 -and $bytes[1] -eq 254) { return $false }
  return $true
}

function Select-OutboundHostIPv4Candidate {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object[]]$Candidates)

  $eligible = @($Candidates | Where-Object {
    $_.IsHardware -eq $true -and
    [string]$_.Status -eq 'Up' -and
    ([string]$_.AdapterName -notmatch $script:ExcludedAdapterPattern) -and
    ([string]$_.InterfaceDescription -notmatch $script:ExcludedAdapterPattern) -and
    (Test-UsableOutboundIPv4 -Address ([string]$_.IPAddress))
  } | ForEach-Object {
    $routeMetric = if ($null -eq $_.RouteMetric) { 0 } else { [int]$_.RouteMetric }
    $interfaceMetric = if ($null -eq $_.InterfaceMetric) { 0 } else { [int]$_.InterfaceMetric }
    [pscustomobject]@{
      IPAddress = [string]$_.IPAddress
      Metric = $routeMetric + $interfaceMetric
      AdapterName = [string]$_.AdapterName
      InterfaceIndex = [int]$_.InterfaceIndex
    }
  })

  if ($eligible.Count -eq 0) {
    throw 'No safe hardware IPv4 default-route candidate was found. Pass -HostIPv4 explicitly.'
  }

  $lowestMetric = ($eligible | Measure-Object -Property Metric -Minimum).Minimum
  $winners = @($eligible | Where-Object { $_.Metric -eq $lowestMetric } |
    Sort-Object -Property IPAddress -Unique)
  if ($winners.Count -ne 1) {
    $names = ($winners | ForEach-Object { $_.AdapterName } | Sort-Object -Unique) -join ', '
    throw "Multiple equally preferred hardware IPv4 routes were found ($names). Pass -HostIPv4 explicitly."
  }
  return $winners[0].IPAddress
}

function Resolve-OutboundHostIPv4 {
  [CmdletBinding()]
  param(
    [string]$HostIPv4,
    [object[]]$Candidates
  )

  if (-not [string]::IsNullOrWhiteSpace($HostIPv4)) {
    if (-not (Test-UsableOutboundIPv4 -Address $HostIPv4.Trim())) {
      throw 'HostIPv4 must be a usable non-loopback IPv4 address.'
    }
    return $HostIPv4.Trim()
  }

  if ($null -ne $Candidates) {
    return Select-OutboundHostIPv4Candidate -Candidates $Candidates
  }

  if (-not (Get-Command Get-NetRoute -ErrorAction SilentlyContinue) -or
      -not (Get-Command Get-NetAdapter -ErrorAction SilentlyContinue) -or
      -not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
    throw 'Windows network cmdlets are unavailable. Pass -HostIPv4 explicitly.'
  }

  $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
    Where-Object { $_.State -ne 'Unreachable' })
  $resolved = New-Object System.Collections.Generic.List[object]
  foreach ($route in $routes) {
    $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
    if ($null -eq $adapter) { continue }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
      Where-Object { $_.AddressState -eq 'Preferred' -and $_.SkipAsSource -ne $true })
    foreach ($address in $addresses) {
      $resolved.Add([pscustomobject]@{
        IPAddress = $address.IPAddress
        AdapterName = $adapter.Name
        InterfaceDescription = $adapter.InterfaceDescription
        InterfaceIndex = $route.InterfaceIndex
        IsHardware = [bool]$adapter.HardwareInterface
        Status = [string]$adapter.Status
        RouteMetric = [int]$route.RouteMetric
        InterfaceMetric = [int]$route.InterfaceMetric
      })
    }
  }
  return Select-OutboundHostIPv4Candidate -Candidates $resolved.ToArray()
}

function Protect-OutboundPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$Directory
  )

  if (-not (Test-Path -LiteralPath $Path)) { throw "Cannot protect missing path: $Path" }
  if ($env:OS -ne 'Windows_NT') { return }

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = if ($Directory) {
    New-Object System.Security.AccessControl.DirectorySecurity
  } else {
    New-Object System.Security.AccessControl.FileSecurity
  }
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = if ($Directory) {
    [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($accessRule)
  if ($Directory) {
    [IO.Directory]::SetAccessControl($Path, $acl)
  } else {
    [IO.File]::SetAccessControl($Path, $acl)
  }
}

function Write-PrivateBytesAtomic {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][byte[]]$Bytes
  )

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Protect-OutboundPath -Path $parent -Directory
  }
  $temporary = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.tmp.' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllBytes($temporary, $Bytes)
    Protect-OutboundPath -Path $temporary
    if (Test-Path -LiteralPath $Path) {
      $swapBackup = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.swap.' + [guid]::NewGuid().ToString('N'))
      try {
        [IO.File]::Replace($temporary, $Path, $swapBackup)
      } finally {
        if (Test-Path -LiteralPath $swapBackup) { Remove-Item -LiteralPath $swapBackup -Force }
      }
    } else {
      [IO.File]::Move($temporary, $Path)
    }
    Protect-OutboundPath -Path $Path
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Get-OrCreateOutboundSipSecret {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  if (Test-Path -LiteralPath $Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $content = [Text.Encoding]::ASCII.GetString($bytes)
    $match = [regex]::Match($content, '\AMICROSIP_SIP_PASSWORD=([0-9a-fA-F]{64})(?:\r?\n)?\z')
    if (-not $match.Success) {
      throw 'The MicroSIP secret file is malformed; expected one 64-character hexadecimal password.'
    }
    Protect-OutboundPath -Path $Path
    return $match.Groups[1].Value.ToLowerInvariant()
  }

  $random = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($random) } finally { $generator.Dispose() }
  $secret = ([BitConverter]::ToString($random)).Replace('-', '').ToLowerInvariant()
  $payload = [Text.Encoding]::ASCII.GetBytes("MICROSIP_SIP_PASSWORD=$secret`r`n")
  Write-PrivateBytesAtomic -Path $Path -Bytes $payload
  return $secret
}

function Read-TwilioSipVarsFromEnvFile {
  <# 从仓库根 .env 读取 TWILIO_SIP_REALM/USERNAME/PASSWORD。
     三项齐全才返回对象，否则返回 $null（vars.xml 保持 conf 占位值）。 #>
  param([Parameter(Mandatory = $true)][string]$EnvFilePath)
  if (-not (Test-Path -LiteralPath $EnvFilePath)) { return $null }
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($EnvFilePath)) {
    $m = [regex]::Match($line, '^\s*(TWILIO_SIP_(?:REALM|USERNAME|PASSWORD))\s*=\s*(.+?)\s*$')
    if ($m.Success) { $values[$m.Groups[1].Value] = $m.Groups[2].Value }
  }
  if ($values['TWILIO_SIP_REALM'] -and $values['TWILIO_SIP_USERNAME'] -and $values['TWILIO_SIP_PASSWORD']) {
    return [pscustomobject]@{
      Realm    = $values['TWILIO_SIP_REALM']
      Username = $values['TWILIO_SIP_USERNAME']
      Password = $values['TWILIO_SIP_PASSWORD']
    }
  }
  return $null
}

function Write-FreeSwitchRuntimeVars {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$HostIPv4,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SipPassword,
    [string]$VoiceAgentUrl = 'ws://host.docker.internal:8090/audio-stream',
    # 仓库根 .env 路径；配置了 TWILIO_SIP_* 时把 Twilio 网关凭据注入 runtime vars
    [string]$TwilioEnvFile = ''
  )

  if (-not (Test-UsableOutboundIPv4 -Address $HostIPv4)) {
    throw 'Cannot write FreeSWITCH runtime vars for an unsafe HostIPv4 value.'
  }
  $escape = [System.Security.SecurityElement]
  $ip = $escape::Escape($HostIPv4)
  $password = $escape::Escape($SipPassword)
  $voiceUrl = $escape::Escape($VoiceAgentUrl)
  $lines = @(
    '<?xml version="1.0" encoding="utf-8"?>'
    '<!-- Generated locally by scripts/dev-outbound.ps1. Do not commit this file. -->'
    '<include>'
    "  <X-PRE-PROCESS cmd=`"set`" data=`"domain=$ip`"/>"
    "  <X-PRE-PROCESS cmd=`"set`" data=`"external_sip_ip=$ip`"/>"
    "  <X-PRE-PROCESS cmd=`"set`" data=`"external_rtp_ip=$ip`"/>"
    '  <X-PRE-PROCESS cmd="set" data="sip_port=5060"/>'
    '  <X-PRE-PROCESS cmd="set" data="rtp_start_port=16384"/>'
    '  <X-PRE-PROCESS cmd="set" data="rtp_end_port=16394"/>'
    "  <X-PRE-PROCESS cmd=`"set`" data=`"default_password=$password`"/>"
    "  <X-PRE-PROCESS cmd=`"set`" data=`"voice_agent_ws_url=$voiceUrl`"/>"
  )
  if ($TwilioEnvFile) {
    $twilio = Read-TwilioSipVarsFromEnvFile -EnvFilePath $TwilioEnvFile
    if ($null -ne $twilio) {
      $lines += "  <X-PRE-PROCESS cmd=`"set`" data=`"twilio_sip_realm=$($escape::Escape($twilio.Realm))`"/>"
      $lines += "  <X-PRE-PROCESS cmd=`"set`" data=`"twilio_sip_username=$($escape::Escape($twilio.Username))`"/>"
      $lines += "  <X-PRE-PROCESS cmd=`"set`" data=`"twilio_sip_password=$($escape::Escape($twilio.Password))`"/>"
    }
  }
  $xml = ($lines + @('</include>', '')) -join "`r`n"
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($xml)
  $changed = $true
  if (Test-Path -LiteralPath $Path) {
    $existing = [IO.File]::ReadAllBytes($Path)
    $changed = [Convert]::ToBase64String($existing) -cne [Convert]::ToBase64String($bytes)
  }
  if ($changed) { Write-PrivateBytesAtomic -Path $Path -Bytes $bytes }
  return [pscustomobject]@{ Path = $Path; Changed = $changed }
}

function Get-PreservedTextFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $bytes = [IO.File]::ReadAllBytes($Path)
  $offset = 0
  $hasBom = $false
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xff -and $bytes[1] -eq 0xfe) {
    $encoding = New-Object Text.UnicodeEncoding($false, $true)
    $offset = 2; $hasBom = $true
  } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xfe -and $bytes[1] -eq 0xff) {
    $encoding = New-Object Text.UnicodeEncoding($true, $true)
    $offset = 2; $hasBom = $true
  } elseif ($bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf) {
    $encoding = New-Object Text.UTF8Encoding($true)
    $offset = 3; $hasBom = $true
  } else {
    $encoding = [Text.Encoding]::Default
  }
  $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
  $newline = if ($text.Contains("`r`n")) { "`r`n" } elseif ($text.Contains("`n")) { "`n" } elseif ($text.Contains("`r")) { "`r" } else { "`r`n" }
  return [pscustomobject]@{
    Text = $text
    Encoding = $encoding
    HasBom = $hasBom
    NewLine = $newline
    HasTrailingNewLine = [regex]::IsMatch($text, '(\r\n|\n|\r)$')
  }
}

function ConvertTo-PreservedBytes {
  param(
    [Parameter(Mandatory = $true)]$FileInfo,
    [Parameter(Mandatory = $true)][string]$Text
  )
  $body = $FileInfo.Encoding.GetBytes($Text)
  if (-not $FileInfo.HasBom) { return $body }
  $preamble = $FileInfo.Encoding.GetPreamble()
  $result = New-Object byte[] ($preamble.Length + $body.Length)
  [Array]::Copy($preamble, 0, $result, 0, $preamble.Length)
  [Array]::Copy($body, 0, $result, $preamble.Length, $body.Length)
  return $result
}

function Get-IniSections {
  param([Parameter(Mandatory = $true)][System.Collections.ArrayList]$Lines)

  $headers = @()
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $match = [regex]::Match([string]$Lines[$i], '^\s*\[([^\]]+)\]\s*(?:[;#].*)?$')
    if ($match.Success) {
      $headers += [pscustomobject]@{ Name = $match.Groups[1].Value; Start = $i }
    }
  }
  $sections = @()
  for ($i = 0; $i -lt $headers.Count; $i++) {
    $end = if ($i + 1 -lt $headers.Count) { $headers[$i + 1].Start - 1 } else { $Lines.Count - 1 }
    $sections += [pscustomobject]@{ Name = $headers[$i].Name; Start = $headers[$i].Start; End = $end }
  }
  return $sections
}

function Get-IniSectionValue {
  param(
    [Parameter(Mandatory = $true)][System.Collections.ArrayList]$Lines,
    [Parameter(Mandatory = $true)]$Section,
    [Parameter(Mandatory = $true)][string]$Key
  )
  for ($i = $Section.Start + 1; $i -le $Section.End; $i++) {
    $match = [regex]::Match([string]$Lines[$i], '^\s*([^;#][^=]*?)\s*=\s*(.*)$')
    if ($match.Success -and $match.Groups[1].Value.Trim() -ieq $Key) {
      return $match.Groups[2].Value
    }
  }
  return $null
}

function Set-IniSectionValue {
  param(
    [Parameter(Mandatory = $true)][System.Collections.ArrayList]$Lines,
    [Parameter(Mandatory = $true)][string]$SectionName,
    [Parameter(Mandatory = $true)][string]$Key,
    [AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value
  )

  $section = @(Get-IniSections -Lines $Lines | Where-Object { $_.Name -ieq $SectionName }) | Select-Object -First 1
  if ($null -eq $section) { throw "Missing INI section [$SectionName]." }
  $matches = New-Object System.Collections.Generic.List[int]
  for ($i = $section.Start + 1; $i -le $section.End; $i++) {
    $match = [regex]::Match([string]$Lines[$i], '^\s*([^;#][^=]*?)\s*=')
    if ($match.Success -and $match.Groups[1].Value.Trim() -ieq $Key) { $matches.Add($i) }
  }
  if ($matches.Count -eq 0) {
    [void]$Lines.Insert($section.End + 1, "$Key=$Value")
  } else {
    $Lines[$matches[0]] = "$Key=$Value"
    for ($i = $matches.Count - 1; $i -ge 1; $i--) { $Lines.RemoveAt($matches[$i]) }
  }
}

function Set-MicroSipLocalAccount {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$IniPath,
    [Parameter(Mandatory = $true)][string]$HostIPv4,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$SipPassword
  )

  if (-not (Test-UsableOutboundIPv4 -Address $HostIPv4)) { throw 'MicroSIP HostIPv4 is unsafe.' }
  if (-not (Test-Path -LiteralPath $IniPath)) { throw "MicroSIP.ini was not found: $IniPath" }
  $fileInfo = Get-PreservedTextFile -Path $IniPath
  $lines = New-Object System.Collections.ArrayList
  $split = [regex]::Split($fileInfo.Text, '\r\n|\n|\r')
  foreach ($line in $split) { [void]$lines.Add($line) }
  if ($fileInfo.HasTrailingNewLine -and $lines.Count -gt 0 -and [string]$lines[$lines.Count - 1] -eq '') {
    $lines.RemoveAt($lines.Count - 1)
  }

  $sections = @(Get-IniSections -Lines $lines)
  $settings = @($sections | Where-Object { $_.Name -ieq 'Settings' }) | Select-Object -First 1
  if ($null -eq $settings) {
    if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$lines[$lines.Count - 1])) { [void]$lines.Add('') }
    [void]$lines.Add('[Settings]')
  }

  $sections = @(Get-IniSections -Lines $lines)
  $accounts = @($sections | Where-Object { $_.Name -match '^Account(\d+)$' })
  $matches = @($accounts | Where-Object {
    (Get-IniSectionValue -Lines $lines -Section $_ -Key 'username') -eq $script:MicroSipAccountUser -or
    (Get-IniSectionValue -Lines $lines -Section $_ -Key 'authID') -eq $script:MicroSipAccountUser
  })
  $activeId = Get-IniSectionValue -Lines $lines -Section (@(Get-IniSections -Lines $lines | Where-Object { $_.Name -ieq 'Settings' }) | Select-Object -First 1) -Key 'accountId'
  $primary = @($matches | Where-Object { $_.Name -ieq "Account$activeId" }) | Select-Object -First 1
  if ($null -eq $primary) { $primary = @($matches | Sort-Object { [int]([regex]::Match($_.Name, '\d+').Value) }) | Select-Object -First 1 }

  if ($null -ne $primary) {
    $duplicates = @($matches | Where-Object { $_.Name -ine $primary.Name } | Sort-Object Start -Descending)
    foreach ($duplicate in $duplicates) {
      for ($i = $duplicate.End; $i -ge $duplicate.Start; $i--) { $lines.RemoveAt($i) }
    }
    $accountName = $primary.Name
    $accountNumber = [int]([regex]::Match($accountName, '\d+').Value)
  } else {
    $used = @($accounts | ForEach-Object { [int]([regex]::Match($_.Name, '\d+').Value) })
    $accountNumber = 1
    while ($used -contains $accountNumber) { $accountNumber++ }
    $accountName = "Account$accountNumber"
    if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$lines[$lines.Count - 1])) { [void]$lines.Add('') }
    [void]$lines.Add("[$accountName]")
  }

  Set-IniSectionValue -Lines $lines -SectionName 'Settings' -Key 'accountId' -Value ([string]$accountNumber)
  Set-IniSectionValue -Lines $lines -SectionName 'Settings' -Key 'sourcePort' -Value '5062'
  Set-IniSectionValue -Lines $lines -SectionName 'Settings' -Key 'STUN' -Value ''
  Set-IniSectionValue -Lines $lines -SectionName 'Settings' -Key 'enableSTUN' -Value '0'

  $values = [ordered]@{
    label = 'AI Call Local 1001'
    server = "$HostIPv4`:5060"
    proxy = ''
    domain = $HostIPv4
    username = $script:MicroSipAccountUser
    password = $SipPassword
    authID = $script:MicroSipAccountUser
    transport = 'udp'
    publicAddr = ''
    ICE = '0'
  }
  foreach ($entry in $values.GetEnumerator()) {
    Set-IniSectionValue -Lines $lines -SectionName $accountName -Key $entry.Key -Value ([string]$entry.Value)
  }

  $updated = ($lines.ToArray() -join $fileInfo.NewLine)
  if ($fileInfo.HasTrailingNewLine) { $updated += $fileInfo.NewLine }
  if ($updated -ceq $fileInfo.Text) {
    return [pscustomobject]@{ Changed = $false; BackupPath = $null; AccountSection = $accountName }
  }

  $backup = "$IniPath.bak.$((Get-Date).ToString('yyyyMMdd-HHmmss-fff')).$([guid]::NewGuid().ToString('N'))"
  [IO.File]::Copy($IniPath, $backup, $false)
  Protect-OutboundPath -Path $backup
  $bytes = ConvertTo-PreservedBytes -FileInfo $fileInfo -Text $updated
  Write-PrivateBytesAtomic -Path $IniPath -Bytes $bytes
  return [pscustomobject]@{ Changed = $true; BackupPath = $backup; AccountSection = $accountName }
}

function Find-MicroSipExecutable {
  [CmdletBinding()]
  param([string]$ExplicitPath)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { throw "MicroSIP executable was not found: $ExplicitPath" }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }
  foreach ($process in @(Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue)) {
    try {
      if ($process.Path -and (Test-Path -LiteralPath $process.Path)) { return $process.Path }
    } catch { }
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  $registryPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($registryPath in $registryPaths) {
    foreach ($entry in @(Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match '(?i)MicroSIP' })) {
      if ($entry.DisplayIcon) {
        $displayIcon = [string]$entry.DisplayIcon
        $quotedPath = [regex]::Match($displayIcon, '^"([^"]+)"')
        if ($quotedPath.Success) { $candidates.Add($quotedPath.Groups[1].Value) }
        else { $candidates.Add($displayIcon.Split(',')[0].Trim()) }
      }
      if ($entry.InstallLocation) { $candidates.Add((Join-Path ([string]$entry.InstallLocation) 'MicroSIP.exe')) }
    }
  }
  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA 'MicroSIP\MicroSIP.exe'),
    (Join-Path $env:APPDATA 'MicroSIP\MicroSIP.exe'),
    (Join-Path $env:ProgramFiles 'MicroSIP\MicroSIP.exe'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'MicroSIP\MicroSIP.exe' })
  )) { if ($candidate) { $candidates.Add($candidate) } }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'MicroSIP.exe was not found. Pass -MicroSipPath explicitly.'
}

function Find-MicroSipIni {
  [CmdletBinding()]
  param(
    [string]$ExplicitPath,
    [Parameter(Mandatory = $true)][string]$ExecutablePath
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { throw "MicroSIP.ini was not found: $ExplicitPath" }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }
  $candidates = @(
    (Join-Path (Split-Path -Parent $ExecutablePath) 'MicroSIP.ini'),
    (Join-Path $env:APPDATA 'MicroSIP\MicroSIP.ini'),
    (Join-Path $env:LOCALAPPDATA 'MicroSIP\MicroSIP.ini'),
    (Join-Path $env:APPDATA 'MicroSIP.ini')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'MicroSIP.ini was not found. Start MicroSIP once or pass -MicroSipIniPath explicitly.'
}

function Invoke-FreeSwitchLocalCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  if ($Command.IndexOf("`n") -ge 0 -or $Command.IndexOf("`r") -ge 0 -or $Command.IndexOf([char]0) -ge 0) {
    throw 'Rejected an unsafe FreeSWITCH command.'
  }
  # 原生命令的 stderr 不并入 stdout（2>&1 会污染 fs_cli 的 JSON 输出）；
  # 单独重定向到临时文件，仅用于失败时的诊断日志。
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ('ai-call-fs-cli-' + [guid]::NewGuid().ToString('N') + '.stderr.log')
  try {
    $output = @(& docker exec ai-call-freeswitch fs_cli -x $Command 2>$stderrPath)
    $exitCode = $LASTEXITCODE
    if ((Test-Path -LiteralPath $stderrPath) -and (Get-Item -LiteralPath $stderrPath).Length -gt 0) {
      Write-Verbose ('FreeSWITCH stderr: ' + ([IO.File]::ReadAllText($stderrPath)).Trim())
    }
    if ($exitCode -ne 0) { throw 'FreeSWITCH control command failed.' }
    return ($output -join "`n").Trim()
  } finally {
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue }
  }
}

function ConvertFrom-FreeSwitchJson {
  param([Parameter(Mandatory = $true)][string]$Command)
  $raw = Invoke-FreeSwitchLocalCommand -Command $Command
  # 截取首个 '{' 或 '[' 起始的子串，防止任何 stdout 前缀噪声（横幅/告警行）污染解析。
  $jsonStart = [regex]::Match($raw, '[\{\[]')
  if (-not $jsonStart.Success) { throw 'FreeSWITCH returned malformed JSON.' }
  $jsonText = $raw.Substring($jsonStart.Index)
  try { return $jsonText | ConvertFrom-Json } catch { throw 'FreeSWITCH returned malformed JSON.' }
}

function Test-FreeSwitchRegistration {
  [CmdletBinding()]
  param([string]$User = '1001')
  try {
    $result = ConvertFrom-FreeSwitchJson -Command 'show registrations as json'
    return @($result.rows | Where-Object { [string]$_.reg_user -eq $User }).Count -gt 0
  } catch { return $false }
}

function Test-FreeSwitchActiveExtension {
  [CmdletBinding()]
  param([string]$User = '1001')
  try {
    $result = ConvertFrom-FreeSwitchJson -Command 'show channels as json'
    foreach ($row in @($result.rows)) {
      foreach ($property in @('dest', 'callee_num', 'cid_num', 'presence_id', 'name')) {
        $value = [string]$row.$property
        if ($value -eq $User -or $value -match "(?:^|[/:@])$([regex]::Escape($User))(?:$|[;@])") { return $true }
      }
    }
    return $false
  } catch { return $false }
}

function Wait-FreeSwitchRegistration {
  [CmdletBinding()]
  param(
    [string]$User = '1001',
    [int]$TimeoutSeconds = 30
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-FreeSwitchRegistration -User $User) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Assert-FreeSwitchLocalReady {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$HostIPv4)

  $sipIp = Invoke-FreeSwitchLocalCommand -Command 'eval $${external_sip_ip}'
  $rtpIp = Invoke-FreeSwitchLocalCommand -Command 'eval $${external_rtp_ip}'
  $sipPort = Invoke-FreeSwitchLocalCommand -Command 'eval $${sip_port}'
  $module = Invoke-FreeSwitchLocalCommand -Command 'module_exists mod_audio_fork'
  $profile = Invoke-FreeSwitchLocalCommand -Command 'sofia status profile internal'
  if ($sipIp -ne $HostIPv4 -or $rtpIp -ne $HostIPv4) { throw 'FreeSWITCH advertised SIP/RTP IP does not match HostIPv4.' }
  if ($sipPort -ne '5060') { throw 'FreeSWITCH internal SIP port is not 5060.' }
  if ($module -ne 'true') { throw 'FreeSWITCH mod_audio_fork is not loaded.' }
  if ($profile -notmatch '(?m)^Name\s+internal\s*$' -or $profile -notmatch '(?m)^URL\s+.*:5060\s*$') {
    throw 'FreeSWITCH internal SIP profile is not ready on port 5060.'
  }
  return [pscustomobject]@{ SipIp = $sipIp; RtpIp = $rtpIp; SipPort = 5060; AudioFork = $true; InternalProfile = $true }
}

function Restart-MicroSipSafely {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [int]$ExitTimeoutSeconds = 10
  )

  if (Test-FreeSwitchActiveExtension -User $script:MicroSipAccountUser) {
    throw 'MicroSIP account 1001 has an active FreeSWITCH channel; refusing to restart it.'
  }
  $running = @(Get-Process -Name 'MicroSIP' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    $exitProcess = Start-Process -FilePath $ExecutablePath -ArgumentList @('/exit') -PassThru -WindowStyle Hidden
    [void]$exitProcess.WaitForExit([Math]::Max(1000, $ExitTimeoutSeconds * 1000))
    $deadline = (Get-Date).AddSeconds($ExitTimeoutSeconds)
    do {
      $remaining = @($running | Where-Object { Get-Process -Id $_.Id -ErrorAction SilentlyContinue })
      if ($remaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if ($remaining.Count -gt 0) {
      throw 'MicroSIP did not exit after the official /exit request; it was not force-killed.'
    }
  }
  return Start-Process -FilePath $ExecutablePath -PassThru
}

function Test-TcpEndpoint {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 1000
  )
  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch { return $false } finally { $client.Close() }
}

function Wait-TcpEndpoint {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 30
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-TcpEndpoint -HostName $HostName -Port $Port) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Wait-HttpReady {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 60,
    [scriptblock]$Validate
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 3
      if ($null -eq $Validate -or (& $Validate $response)) { return $response }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Readiness endpoint did not become healthy: $Uri"
}

function Get-OutboundPortOwner {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][int]$Port)
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return @() }
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-RepositoryProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$RepositoryRoot
  )
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    $root = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    return ([string]$process.CommandLine).IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      ([string]$process.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}

function Start-OutboundManagedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogDirectory
  )
  if (-not (Test-Path -LiteralPath $LogDirectory)) {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
  }
  Protect-OutboundPath -Path $LogDirectory -Directory
  $stdout = Join-Path $LogDirectory "$Name.out.log"
  $stderr = Join-Path $LogDirectory "$Name.err.log"
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  return [pscustomobject]@{
    Name = $Name
    Pid = $process.Id
    StartedAt = $process.StartTime.ToUniversalTime().ToString('o')
    Owned = $true
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Stop-OutboundManagedProcess {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)]$Record)

  if ($Record.Owned -ne $true) { return }
  $root = Get-Process -Id ([int]$Record.Pid) -ErrorAction SilentlyContinue
  if ($null -eq $root) { return }
  try {
    $expected = [DateTime]::Parse([string]$Record.StartedAt).ToUniversalTime()
    if ([Math]::Abs(($root.StartTime.ToUniversalTime() - $expected).TotalSeconds) -gt 2) { return }
  } catch { return }

  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $pending = New-Object System.Collections.Generic.List[int]
  $pending.Add([int]$Record.Pid)
  $descendants = New-Object System.Collections.Generic.List[int]
  for ($index = 0; $index -lt $pending.Count; $index++) {
    $parent = $pending[$index]
    foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $parent })) {
      if (-not $pending.Contains([int]$child.ProcessId)) {
        $pending.Add([int]$child.ProcessId)
        $descendants.Add([int]$child.ProcessId)
      }
    }
  }
  $childPids = $descendants.ToArray()
  [Array]::Reverse($childPids)
  foreach ($childPid in $childPids) {
    Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id ([int]$Record.Pid) -Force -ErrorAction SilentlyContinue
}

function Write-OutboundRuntimeState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$State
  )
  $json = $State | ConvertTo-Json -Depth 8
  Write-PrivateBytesAtomic -Path $Path -Bytes ((New-Object Text.UTF8Encoding($false)).GetBytes($json + "`r`n"))
}

function Read-OutboundRuntimeState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json) }
  catch { throw 'The outbound runtime state file is malformed.' }
}

Export-ModuleMember -Function @(
  'Select-OutboundHostIPv4Candidate',
  'Resolve-OutboundHostIPv4',
  'Protect-OutboundPath',
  'Get-OrCreateOutboundSipSecret',
  'Write-FreeSwitchRuntimeVars',
  'Set-MicroSipLocalAccount',
  'Find-MicroSipExecutable',
  'Find-MicroSipIni',
  'Test-FreeSwitchRegistration',
  'Test-FreeSwitchActiveExtension',
  'Wait-FreeSwitchRegistration',
  'Assert-FreeSwitchLocalReady',
  'Restart-MicroSipSafely',
  'Test-TcpEndpoint',
  'Wait-TcpEndpoint',
  'Wait-HttpReady',
  'Get-OutboundPortOwner',
  'Test-RepositoryProcess',
  'Start-OutboundManagedProcess',
  'Stop-OutboundManagedProcess',
  'Write-OutboundRuntimeState',
  'Read-OutboundRuntimeState'
)
