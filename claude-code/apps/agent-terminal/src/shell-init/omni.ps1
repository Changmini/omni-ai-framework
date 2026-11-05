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

# 2. Report the current folder before each prompt, two ways:
#    - OSC 9;9 in the prompt text (as Windows Terminal uses). The pseudo console
#      between PowerShell and the app may drop it, so also
#    - POST it to the app's local receiver when it changes.
$global:__omniPrompt = $function:prompt
$global:__omniLastCwd = $null
function global:__omniPostCwd([string]$path) {
  if (-not $env:OMNI_CWD_URL) { return }
  try {
    $body = [System.Text.Encoding]::UTF8.GetBytes((@{ cwd = $path } | ConvertTo-Json -Compress))
    $req = [System.Net.WebRequest]::Create($env:OMNI_CWD_URL)
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Timeout = 500
    $req.Proxy = $null
    $req.Headers.Add('X-Omni-Token', $env:OMNI_HOOK_TOKEN)
    $req.Headers.Add('X-Omni-Terminal', $env:OMNI_TERMINAL_ID)
    $stream = $req.GetRequestStream(); $stream.Write($body, 0, $body.Length); $stream.Close()
    $req.GetResponse().Close()
  } catch { }
}
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $osc = ''
  if ($loc.Provider.Name -eq 'FileSystem') {
    $path = $loc.ProviderPath
    $osc = "$([char]27)]9;9;`"$path`"$([char]27)\"
    if ($path -ne $global:__omniLastCwd) {
      $global:__omniLastCwd = $path
      __omniPostCwd $path
    }
  }
  $osc + (& $global:__omniPrompt)
}
