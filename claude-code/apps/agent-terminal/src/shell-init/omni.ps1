# Omni Agent Terminal shell integration. Runs only in terminals opened by the
# app (passed with -EncodedCommand, so execution policy does not apply).

# 1. `claude` gets --settings with the app's hooks. Outside the app, plain claude.
if ($env:OMNI_CLAUDE_SETTINGS) {
  function global:claude {
    $cmd = Get-Command claude -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cmd) { Write-Error 'claude was not found in PATH.'; return }
    & $cmd.Source --settings $env:OMNI_CLAUDE_SETTINGS @args
  }
}

# 2. Report the current folder before each prompt (OSC 9;9, as Windows Terminal uses).
$global:__omniPrompt = $function:prompt
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $osc = ''
  if ($loc.Provider.Name -eq 'FileSystem') {
    $osc = "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]27)\"
  }
  $osc + (& $global:__omniPrompt)
}
