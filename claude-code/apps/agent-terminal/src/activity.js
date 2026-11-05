'use strict';

// One line of the inspector's activity log from a Claude Code hook event, or
// null for events that are not shown. Field names follow the hook input
// documented at https://code.claude.com/docs/en/hooks (tool_input of the
// built-in tools: file_path, command, pattern, url, query, description).

const MAX_TEXT = 160;
const ACTIVITY_MAX = 200; // log lines kept per terminal (main process and page)

const oneLine = (v, max = MAX_TEXT) => {
  if (typeof v !== 'string') return '';
  const line = v.split(/\r?\n/).find((l) => l.trim()) || '';
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// What a tool call is about, in a few words, plus the file it touches.
function toolSummary(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const file = typeof i.file_path === 'string' ? i.file_path
    : typeof i.notebook_path === 'string' ? i.notebook_path : null;
  if (file) return { text: file, file };
  if (typeof i.command === 'string') return { text: oneLine(i.command), file: null };
  if (typeof i.pattern === 'string') {
    const where = typeof i.path === 'string' ? ` · ${i.path}` : '';
    return { text: oneLine(`${i.pattern}${where}`), file: null };
  }
  if (typeof i.url === 'string') return { text: oneLine(i.url), file: null };
  if (typeof i.query === 'string') return { text: oneLine(i.query), file: null };
  if (/^(Agent|Task)$/.test(name || '')) {
    return { text: oneLine([i.subagent_type, i.description].filter(Boolean).join(' · ')), file: null };
  }
  if (typeof i.description === 'string') return { text: oneLine(i.description), file: null };
  if (typeof i.skill === 'string') return { text: oneLine(i.skill), file: null };
  return { text: '', file: null };
}

/**
 * @param {object} ev   hook event
 * @param {number} at   ms timestamp
 * @param {string|null} who  null for the terminal's main agent, else a
 *        subagent type or teammate name
 */
function activityEntry(ev, at, who = null) {
  if (!ev || typeof ev !== 'object') return null;
  const base = { at, who };
  switch (ev.hook_event_name) {
    case 'UserPromptSubmit': {
      const text = oneLine(ev.prompt);
      return text ? { ...base, kind: 'prompt', text } : null;
    }
    case 'PreToolUse': {
      const s = toolSummary(ev.tool_name, ev.tool_input);
      return { ...base, kind: 'tool', tool: oneLine(ev.tool_name, 60) || 'tool', text: s.text, file: s.file, useId: ev.tool_use_id || null };
    }
    case 'PostToolUseFailure': {
      const s = toolSummary(ev.tool_name, ev.tool_input);
      return { ...base, kind: 'fail', tool: oneLine(ev.tool_name, 60) || 'tool', text: oneLine(ev.error) || s.text, file: s.file, useId: ev.tool_use_id || null };
    }
    case 'PermissionRequest':
      return { ...base, kind: 'wait', tool: oneLine(ev.tool_name, 60) || null, text: '승인 대기' };
    case 'Notification':
      // idle_prompt is noise; permission_prompt repeats PermissionRequest.
      return ev.notification_type === 'idle_prompt' || ev.notification_type === 'permission_prompt' ? null
        : { ...base, kind: 'wait', text: oneLine(ev.message) || '알림' };
    case 'Stop':
      return ev.agent_id ? null : { ...base, kind: 'done', text: '응답 완료' };
    case 'StopFailure':
      return { ...base, kind: 'error', text: oneLine(ev.error || ev.message) || '오류로 중단' };
    case 'SubagentStart':
      return { ...base, kind: 'agent', who: ev.agent_type || who, text: '서브에이전트 시작' };
    case 'SubagentStop':
      return { ...base, kind: 'agent', who: ev.agent_type || who, text: '서브에이전트 종료' };
    case 'TeammateIdle':
      return { ...base, kind: 'idle', who: ev.teammate_name || who, text: '대기 중' };
    default:
      return null;
  }
}

module.exports = { activityEntry, toolSummary, oneLine, ACTIVITY_MAX };
