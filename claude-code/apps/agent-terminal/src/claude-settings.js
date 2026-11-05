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
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hook] }]])) };
}

module.exports = { HOOK_EVENTS, buildClaudeSettings };
