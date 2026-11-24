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
  // For the pipeline (pipeline-context.js): /omni:pipeline typed, and a
  // compaction that may have dropped what was told before.
  'UserPromptExpansion',
  'PostCompact',
];

// The status line: reports what Claude Code passes it to the app in the
// background, then runs the user's own statusLine command, which the claude
// wrapper puts in OMNI_USER_STATUSLINE (these settings replace the status
// line). The app takes two things from it:
// - plan usage (rate_limits.five_hour), which arrives after the first answer
//   on a claude.ai subscription;
// - the session's id and name (session_id, session_name: the --name or
//   /rename name, else the generated title). It also runs once as claude
//   starts, before any prompt or hook, so it tells the app Claude is up.
// Verified on Claude Code 2.1.318 (statusLine from --settings runs, plan
// usage) and 2.1.331 (runs at start with session_id; session_name after
// --name and right after /rename). https://code.claude.com/docs/en/statusline
// The status line runs on every conversation update: it reports only when
// one of them changed since the last report to this app run (OMNI_CWD_URL
// carries the app's port, new on each start). Plan usage is account-wide:
// one file per user; the session, one file per terminal. Both live in the
// user's runtime folder or ~/.cache (never a shared temp folder, where a
// planted link would be written through). POSIX sh, shell builtins only
// besides reading the input (cat) and reporting (curl).
const STATUS_LINE_COMMAND = [
  'input=$(cat)',
  'd="${XDG_RUNTIME_DIR:-$HOME/.cache}"; [ -d "$d" ] || mkdir -p "$d" 2>/dev/null',
  'due=',
  // Plan usage, like grep -o '"five_hour"[^}]*}' | head -1, by shell builtins.
  'case "$input" in *\'"five_hour"\'*) seg=${input#*\'"five_hour"\'}; seg=\'"five_hour"\'${seg%%\'}\'*}\'}\''
    + '; last=; { IFS= read -r last < "$d/omni-plan"; } 2>/dev/null'
    + '; if [ "$last" != "$OMNI_CWD_URL $seg" ]; then printf \'%s\\n\' "$OMNI_CWD_URL $seg" > "$d/omni-plan" 2>/dev/null; due=1; fi ;; esac',
  // The session: the id, and the name up to its closing quote (an escaped
  // \" stays part of it).
  'sid=; case "$input" in *\'"session_id":"\'*) sid=${input#*\'"session_id":"\'}; sid=${sid%%\'"\'*} ;; esac',
  'nm=; case "$input" in *\'"session_name":"\'*) r=${input#*\'"session_name":"\'}'
    + '; while :; do p=${r%%\'"\'*}; nm=$nm$p; case "$r" in *\'"\'*) r=${r#*\'"\'} ;; *) break ;; esac'
    + '; case "$p" in *\'\\\') nm=$nm\'"\' ;; *) break ;; esac; done ;; esac',
  // One file per terminal and tmux pane: claude sessions in other panes of
  // the same terminal do not overwrite each other's last report.
  'if [ -n "$sid" ]; then f="$d/omni-session-$OMNI_TERMINAL_ID$TMUX_PANE"; last=; { IFS= read -r last < "$f"; } 2>/dev/null'
    + '; if [ "$last" != "$OMNI_CWD_URL $sid $nm" ]; then printf \'%s\\n\' "$OMNI_CWD_URL $sid $nm" > "$f" 2>/dev/null; due=1; fi; fi',
  'if [ -n "$due" ]; then ( printf \'%s\' "$input" | curl -s -m 2 -o /dev/null -X POST -H \'Content-Type: application/json\''
    + ' -H "X-Omni-Token: $OMNI_HOOK_TOKEN" -H "X-Omni-Terminal: $OMNI_TERMINAL_ID"'
    + ' --data-binary @- "${OMNI_CWD_URL%/cwd}/status" >/dev/null 2>&1 & ); fi',
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
