'use strict';

// The settings file passed to claude with --settings inside app terminals
// only. It adds HTTP hooks that report to this app; the user's own settings
// files are untouched. Verified on Claude Code 2.1.318: hooks from --settings
// run, and header values interpolate the env vars listed in allowedEnvVars.

const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'SessionEnd',
];

// The status line: reports what Claude Code passes it (plan usage in
// rate_limits.five_hour) to the app in the background, then runs the user's
// own statusLine command, which the claude wrapper puts in
// OMNI_USER_STATUSLINE (these settings replace the status line). Verified on
// Claude Code 2.1.318: a statusLine from --settings runs, and rate_limits
// arrives after the first answer on a claude.ai subscription.
// https://code.claude.com/docs/en/statusline
// The status line runs on every conversation update: it reports only when
// there is plan usage and it changed since the last report to this app run
// (OMNI_CWD_URL carries the app's port, new on each start). The last one is
// kept per terminal in the user's runtime folder (else $TMPDIR or ~/.cache,
// never a shared /tmp); without grep it reports every time. POSIX sh.
const STATUS_LINE_COMMAND = [
  'input=$(cat)',
  'case "$input" in *\'"five_hour"\'*)'
    + ' seg=$(printf \'%s\' "$input" | grep -o \'"five_hour"[^}]*}\' | head -1)'
    + '; f="${XDG_RUNTIME_DIR:-${TMPDIR:-$HOME/.cache}}/omni-plan-$OMNI_TERMINAL_ID"'
    + '; if [ -z "$seg" ] || [ "$(cat "$f" 2>/dev/null)" != "$OMNI_CWD_URL $seg" ]; then'
    + ' printf \'%s\' "$OMNI_CWD_URL $seg" > "$f" 2>/dev/null'
    + '; ( printf \'%s\' "$input" | curl -s -m 2 -o /dev/null -X POST -H \'Content-Type: application/json\''
    + ' -H "X-Omni-Token: $OMNI_HOOK_TOKEN" -H "X-Omni-Terminal: $OMNI_TERMINAL_ID"'
    + ' --data-binary @- "${OMNI_CWD_URL%/cwd}/status" >/dev/null 2>&1 & ); fi ;; esac',
  'if [ -n "$OMNI_USER_STATUSLINE" ]; then printf \'%s\' "$input" | eval "$OMNI_USER_STATUSLINE"; fi',
].join('; ');

function buildClaudeSettings(port) {
  const hook = {
    type: 'http',
    url: `http://127.0.0.1:${port}/hook`,
    timeout: 3,
    headers: {
      'X-Omni-Terminal': '${OMNI_TERMINAL_ID}',
      'X-Omni-Token': '${OMNI_HOOK_TOKEN}',
    },
    allowedEnvVars: ['OMNI_TERMINAL_ID', 'OMNI_HOOK_TOKEN'],
  };
  return {
    hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hook] }]])),
    statusLine: { type: 'command', command: STATUS_LINE_COMMAND },
  };
}

module.exports = { HOOK_EVENTS, buildClaudeSettings, STATUS_LINE_COMMAND };
