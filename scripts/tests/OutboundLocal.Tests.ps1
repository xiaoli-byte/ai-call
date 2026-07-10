$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$modulePath = Join-Path $repositoryRoot 'scripts\lib\OutboundLocal.psm1'
Import-Module $modulePath -Force

Describe 'Outbound host IPv4 selection' {
  It 'prefers an explicit safe HostIPv4 override' {
    $badCandidates = @([pscustomobject]@{
      IPAddress = '172.20.0.1'; AdapterName = 'vEthernet (WSL)'; InterfaceDescription = 'WSL'
      InterfaceIndex = 9; IsHardware = $false; Status = 'Up'; RouteMetric = 1; InterfaceMetric = 1
    })
    Resolve-OutboundHostIPv4 -HostIPv4 '10.20.30.40' -Candidates $badCandidates | Should Be '10.20.30.40'
  }

  It 'rejects loopback and APIPA explicit addresses' {
    { Resolve-OutboundHostIPv4 -HostIPv4 '127.0.0.1' } | Should Throw
    { Resolve-OutboundHostIPv4 -HostIPv4 '169.254.2.3' } | Should Throw
  }

  It 'selects the lowest-metric real hardware route and excludes virtual adapters' {
    $candidates = @(
      [pscustomobject]@{ IPAddress = '172.20.0.1'; AdapterName = 'vEthernet (WSL)'; InterfaceDescription = 'Hyper-V Virtual'; InterfaceIndex = 9; IsHardware = $false; Status = 'Up'; RouteMetric = 1; InterfaceMetric = 1 },
      [pscustomobject]@{ IPAddress = '192.168.1.22'; AdapterName = 'Wi-Fi'; InterfaceDescription = 'Intel Wi-Fi'; InterfaceIndex = 7; IsHardware = $true; Status = 'Up'; RouteMetric = 10; InterfaceMetric = 20 },
      [pscustomobject]@{ IPAddress = '10.0.0.22'; AdapterName = 'Ethernet'; InterfaceDescription = 'Intel Ethernet'; InterfaceIndex = 4; IsHardware = $true; Status = 'Up'; RouteMetric = 40; InterfaceMetric = 20 }
    )
    Select-OutboundHostIPv4Candidate -Candidates $candidates | Should Be '192.168.1.22'
  }

  It 'fails instead of guessing between equal hardware routes' {
    $candidates = @(
      [pscustomobject]@{ IPAddress = '192.168.1.22'; AdapterName = 'Wi-Fi'; InterfaceDescription = 'Intel Wi-Fi'; InterfaceIndex = 7; IsHardware = $true; Status = 'Up'; RouteMetric = 10; InterfaceMetric = 20 },
      [pscustomobject]@{ IPAddress = '10.0.0.22'; AdapterName = 'Ethernet'; InterfaceDescription = 'Intel Ethernet'; InterfaceIndex = 4; IsHardware = $true; Status = 'Up'; RouteMetric = 20; InterfaceMetric = 10 }
    )
    { Select-OutboundHostIPv4Candidate -Candidates $candidates } | Should Throw
  }
}

Describe 'Private runtime configuration' {
  BeforeEach {
    $script:tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai-call-outbound-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:tempRoot | Out-Null
  }

  AfterEach {
    if (Test-Path -LiteralPath $script:tempRoot) { Remove-Item -LiteralPath $script:tempRoot -Recurse -Force }
  }

  It 'creates one stable random 64-hex SIP secret' {
    $path = Join-Path $script:tempRoot 'private\microsip.env'
    $first = Get-OrCreateOutboundSipSecret -Path $path
    $second = Get-OrCreateOutboundSipSecret -Path $path
    $first.Length | Should Be 64
    ($first -match '^[0-9a-f]{64}$') | Should Be $true
    $second | Should Be $first
    ([IO.File]::ReadAllText($path) -split "`n").Count | Should Be 2
    $acl = Get-Acl -LiteralPath $path
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    @($acl.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $currentSid }).Count | Should Be 0
    $acl.AreAccessRulesProtected | Should Be $true
  }

  It 'writes an idempotent runtime vars file with the selected host' {
    $path = Join-Path $script:tempRoot 'freeswitch\vars.xml'
    $fakePassword = 'a' * 64
    $first = Write-FreeSwitchRuntimeVars -Path $path -HostIPv4 '192.168.50.8' -SipPassword $fakePassword
    $second = Write-FreeSwitchRuntimeVars -Path $path -HostIPv4 '192.168.50.8' -SipPassword $fakePassword
    $first.Changed | Should Be $true
    $second.Changed | Should Be $false
    [xml]$xml = [IO.File]::ReadAllText($path)
    $values = @($xml.include.'X-PRE-PROCESS' | ForEach-Object { $_.data })
    ($values -contains 'external_sip_ip=192.168.50.8') | Should Be $true
    ($values -contains 'external_rtp_ip=192.168.50.8') | Should Be $true
    ($values -contains 'sip_port=5060') | Should Be $true
  }
}

Describe 'MicroSIP preservation update' {
  BeforeEach {
    $script:tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai-call-microsip-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:tempRoot | Out-Null
    $script:iniPath = Join-Path $script:tempRoot 'MicroSIP.ini'
    $script:fakePassword = 'b' * 64
    $content = @(
      '[Global]'
      'version=3.22.10'
      '; preserve this comment'
      '[Settings]'
      'accountId=1'
      'sourcePort=5070'
      'customSetting=preserve-me'
      '[Account1]'
      'label=Personal'
      'server=sip.example.test'
      'domain=sip.example.test'
      'username=2002'
      'password=personal-secret'
      'authID=2002'
      'transport=tcp'
      'customAccountKey=preserve-me-too'
      '[Account2]'
      'label=Old Local'
      'server=192.0.2.1:5060'
      'domain=192.0.2.1'
      'username=1001'
      'password=old-local-secret'
      'authID=1001'
      'transport=tcp'
      'ICE=1'
      'unknown1001Key=keep-this'
      '[Dialed]'
      '0=9999'
      ''
    ) -join "`r`n"
    $encoding = New-Object Text.UnicodeEncoding($false, $true)
    [IO.File]::WriteAllText($script:iniPath, $content, $encoding)
  }

  AfterEach {
    if (Test-Path -LiteralPath $script:tempRoot) { Remove-Item -LiteralPath $script:tempRoot -Recurse -Force }
  }

  It 'preserves UTF-16 LE, CRLF, comments, unknown keys, and other accounts' {
    $result = Set-MicroSipLocalAccount -IniPath $script:iniPath -HostIPv4 '192.168.50.8' -SipPassword $script:fakePassword
    $result.Changed | Should Be $true
    (Test-Path -LiteralPath $result.BackupPath) | Should Be $true
    (Get-Acl -LiteralPath $result.BackupPath).AreAccessRulesProtected | Should Be $true
    $bytes = [IO.File]::ReadAllBytes($script:iniPath)
    $bytes[0] | Should Be 255
    $bytes[1] | Should Be 254
    $updated = [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
    $updated | Should Match '; preserve this comment'
    $updated | Should Match 'customSetting=preserve-me'
    $updated | Should Match 'username=2002'
    $updated | Should Match 'customAccountKey=preserve-me-too'
    $updated | Should Match 'unknown1001Key=keep-this'
    $updated | Should Match 'server=192.168.50.8:5060'
    $updated | Should Match 'sourcePort=5062'
    $updated | Should Match 'enableSTUN=0'
    $updated | Should Match 'ICE=0'
    $updated.Replace("`r`n", '') | Should Not Match "`n"
  }

  It 'does not back up or rewrite an unchanged configuration' {
    [void](Set-MicroSipLocalAccount -IniPath $script:iniPath -HostIPv4 '192.168.50.8' -SipPassword $script:fakePassword)
    $backupCount = @(Get-ChildItem -LiteralPath $script:tempRoot -Filter 'MicroSIP.ini.bak.*').Count
    $second = Set-MicroSipLocalAccount -IniPath $script:iniPath -HostIPv4 '192.168.50.8' -SipPassword $script:fakePassword
    $second.Changed | Should Be $false
    @(Get-ChildItem -LiteralPath $script:tempRoot -Filter 'MicroSIP.ini.bak.*').Count | Should Be $backupCount
  }

  It 'removes duplicate 1001 account sections without removing personal accounts' {
    $encoding = New-Object Text.UnicodeEncoding($false, $true)
    $extra = "[Account3]`r`nusername=1001`r`nauthID=1001`r`npassword=duplicate`r`n"
    $text = [IO.File]::ReadAllText($script:iniPath, $encoding) + $extra
    [IO.File]::WriteAllText($script:iniPath, $text, $encoding)
    [void](Set-MicroSipLocalAccount -IniPath $script:iniPath -HostIPv4 '192.168.50.8' -SipPassword $script:fakePassword)
    $updated = [IO.File]::ReadAllText($script:iniPath, $encoding)
    ([regex]::Matches($updated, '(?m)^username=1001\r?$')).Count | Should Be 1
    $updated | Should Match '(?m)^username=2002\r?$'
  }
}

# NOTE: ConvertFrom-FreeSwitchJson 的"截取首个 { / [、剥离控制台噪声前缀"逻辑
# 无法在本仓库固定的 Pester 3.4 上测试 —— 该版本在 mock 模块内部函数后，被测
# 模块函数(带 Set-StrictMode -Version Latest)读取局部变量会误报 "variable not
# set"。逻辑已在隔离环境验证正确；升级到 Pester 5.x 后应补回覆盖。

Describe 'Read-only outbound smoke contract' {
  It 'contains no task creation, publishing, dispatch POST, or built-in administrator password' {
    $scriptText = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'scripts\outbound-runtime-check.ps1'))
    $scriptText | Should Not Match 'Invoke-RestMethod[^\r\n]+-Method\s+Post'
    $scriptText | Should Not Match '/publish'
    $scriptText | Should Not Match '/dispatch'
    $scriptText | Should Not Match 'AdminPassword|admin123'
    $scriptText | Should Match 'ObserveNextTask'
    $scriptText | Should Match 'ringingAt'
    $scriptText | Should Match 'answeredAt'
    $scriptText | Should Match 'endedAt'
  }
}

Describe 'Outbound orchestration gates' {
  It 'starts Outbox only after Event Worker, Voice Agent, and registration, then starts Scheduler last' {
    $dev = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'scripts\dev-outbound.ps1'))
    $voiceReady = $dev.IndexOf("8090/health/ready", [StringComparison]::Ordinal)
    $eventReady = $dev.IndexOf("3012/health/ready", [StringComparison]::Ordinal)
    $registration = $dev.IndexOf("Wait-FreeSwitchRegistration", [StringComparison]::Ordinal)
    $outbox = $dev.IndexOf("-Name 'outbox'", [StringComparison]::Ordinal)
    $scheduler = $dev.IndexOf("-Name 'scheduler'", [StringComparison]::Ordinal)
    ($voiceReady -ge 0 -and $voiceReady -lt $outbox) | Should Be $true
    ($eventReady -ge 0 -and $eventReady -lt $outbox) | Should Be $true
    ($registration -ge 0 -and $registration -lt $outbox) | Should Be $true
    ($outbox -lt $scheduler) | Should Be $true
    $dev | Should Match "OUTBOUND_REAL_CALL_MODE = 'true'"
  }

  It 'uses the private vars bind mount and never runs compose down' {
    $compose = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'freeswitch\docker-compose.yml'))
    $sharedVars = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'freeswitch\conf\vars.xml'))
    $dev = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'scripts\dev-outbound.ps1'))
    $stop = [IO.File]::ReadAllText((Join-Path $repositoryRoot 'scripts\dev-outbound-stop.ps1'))
    $compose | Should Match 'source:\s+\$\{FREESWITCH_VARS_FILE'
    $compose | Should Match 'target:\s+/usr/local/freeswitch/conf/vars.xml'
    $sharedVars | Should Not Match 'default_password='
    $sharedVars | Should Not Match '192\.168\.'
    $dev | Should Match "'--no-deps'"
    ($dev + $stop) | Should Not Match 'compose\s+down'
  }

  It 'uses MicroSIP official slash-exit and does not force-kill it' {
    $module = [IO.File]::ReadAllText($modulePath)
    $restartStart = $module.IndexOf('function Restart-MicroSipSafely', [StringComparison]::Ordinal)
    $restartEnd = $module.IndexOf('function Test-TcpEndpoint', $restartStart, [StringComparison]::Ordinal)
    $restart = $module.Substring($restartStart, $restartEnd - $restartStart)
    $restart | Should Match "ArgumentList @\('/exit'\)"
    $restart | Should Not Match 'Stop-Process'
  }
}

Describe 'Managed process ownership' {
  It 'never stops a process marked as unowned' {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden
    try {
      $record = [pscustomobject]@{ Pid = $process.Id; StartedAt = $process.StartTime.ToUniversalTime().ToString('o'); Owned = $false }
      Stop-OutboundManagedProcess -Record $record
      (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) -ne $null | Should Be $true
    } finally {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }

  It 'stops only the exact tracked process instance' {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden
    $record = [pscustomobject]@{ Pid = $process.Id; StartedAt = $process.StartTime.ToUniversalTime().ToString('o'); Owned = $true }
    Stop-OutboundManagedProcess -Record $record
    Start-Sleep -Milliseconds 100
    (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) -eq $null | Should Be $true
  }
}
