param(
  [Parameter(Mandatory = $false, Position = 0)]
  [ValidatePattern("^[0-9]+$")]
  [string]$Extension = "1001",
  [string]$Container = "ai-call-freeswitch"
)

$ErrorActionPreference = "Stop"
$moduleExists = (docker exec $Container fs_cli -x "module_exists mod_audio_fork").Trim()
if ($moduleExists -ne "true") {
  throw "mod_audio_fork is not loaded. Start Docker FreeSWITCH first."
}

$uuid = (docker exec $Container fs_cli -x "create_uuid").Trim()
$metadataJson = "{`"dialog_id`":`"$uuid`",`"audio_response_format`":`"esl-file`"}"
$metadataBytes = [System.Text.Encoding]::UTF8.GetBytes($metadataJson)
$metadata = "base64:$([Convert]::ToBase64String($metadataBytes))"
$variables = "origination_uuid=$uuid,origination_caller_id_number=1000,originate_timeout=30,STREAM_PLAYBACK=true,STREAM_SAMPLE_RATE=16000"
$command = "originate {$variables}user/$Extension &park()"

Write-Host "Calling $Extension with bidirectional audio (call ID: $uuid)..."
$result = (docker exec $Container fs_cli -x $command).Trim()
Write-Host $result
if ($result -notlike "+OK*") {
  throw "Call dispatch failed: $result"
}

$streamCommand = "uuid_audio_fork $uuid start ws://host.docker.internal:8090/audio-stream mono 16k $metadata"
$streamResult = (docker exec $Container fs_cli -x $streamCommand).Trim()
Write-Host $streamResult
if ($streamResult -notlike "+OK*") {
  throw "Audio stream failed: $streamResult"
}
Write-Host "Bidirectional audio stream connected. Keep the call open and speak."
