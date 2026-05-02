# wmux OSC 133 shell integration for PowerShell.

$script:WmuxLastHistoryId = -1
$script:WmuxPromptStarted = $false

function global:prompt {
  $exitCode = if ($global:LASTEXITCODE -is [int]) { $global:LASTEXITCODE } else { 0 }
  if ($script:WmuxPromptStarted) {
    Write-Host -NoNewline "$([char]27)]133;D;$exitCode$([char]7)"
  }
  $script:WmuxPromptStarted = $true
  Write-Host -NoNewline "$([char]27)]133;A$([char]7)"
  $path = (Get-Location).Path
  Write-Host -NoNewline "PS $path> "
  Write-Host -NoNewline "$([char]27)]133;B$([char]7)"
  return " "
}

Set-PSReadLineOption -AddToHistoryHandler {
  param([string]$line)
  Write-Host -NoNewline "$([char]27)]133;C$([char]7)"
  return $true
}
