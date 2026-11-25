# Omni Agent Terminal shell integration. Runs only in terminals opened by the
# app (passed with -EncodedCommand, so execution policy does not apply).

# 1. `claude` gets --settings with the app's hooks. Outside the app, plain claude.
#    Those settings replace the status line (it reports plan usage to the app)
#    and run the user's own statusLine command after it: found here, in
#    Claude Code's order (local, project, user settings).
function global:__omniUserStatusLine {
  $dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  $here = (Get-Location).Path
  foreach ($f in @((Join-Path $here '.claude\settings.local.json'), (Join-Path $here '.claude\settings.json'), (Join-Path $dir 'settings.json'))) {
    try { $s = (Get-Content -Raw -LiteralPath $f -ErrorAction Stop | ConvertFrom-Json).statusLine } catch { continue }
    if ($s -and $s.command -and (-not $s.type -or $s.type -eq 'command')) { return [string]$s.command }
  }
  return ''
}
if ($env:OMNI_CLAUDE_SETTINGS) {
  function global:claude {
    $cmd = Get-Command claude -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cmd) { Write-Error 'claude was not found in PATH.'; return }
    $env:OMNI_USER_STATUSLINE = __omniUserStatusLine
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

# 3. `wsl` (optionally with -d/-u/--cd/~) opens bash inside WSL with the same
#    integration (omni.bash). The OMNI_* variables reach WSL through WSLENV,
#    set by the app. With a command or any other option, plain wsl.exe runs.
#    The -c text has no inner quotes (IFS= instead), so Windows PowerShell 5.1
#    passes it to wsl.exe intact.
function global:wsl {
  $pre = @()
  $i = 0
  while ($i -lt $args.Count) {
    $a = [string]$args[$i]
    if ($a -in @('-d', '--distribution', '-u', '--user', '--cd')) {
      if ($i + 1 -ge $args.Count) { break }
      $pre += $a, [string]$args[$i + 1]
      $i += 2
      continue
    }
    if ($a -eq '~') { $pre += '--cd', '~'; $i++; continue }
    break
  }
  if ($i -lt $args.Count -or -not $env:OMNI_INIT_BASH) {
    & wsl.exe @args
  } else {
    & wsl.exe @pre -e bash -c 'IFS=; exec bash --rcfile $OMNI_INIT_BASH -i'
  }
  # Back in PowerShell: report the folder again at the next prompt.
  $global:__omniLastCwd = $null
}
