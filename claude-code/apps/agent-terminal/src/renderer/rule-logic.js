'use strict';

// Automation rules: "when <event> (and <condition>) in <these terminals>, do
// <action>". A rule is plain data the user edits in the 자동화 tab; this
// module holds what both sides need without the DOM: the main process runs
// rules on Claude Code hook events (src/rules.js), the page lists, describes
// and test-runs them. Loaded by index.html (window.RuleLogic) and by main
// and tests (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuleLogic = api;
}(typeof self !== 'undefined' ? self : this, () => {
  // Rule events and the Claude Code hook each one answers to.
  const EVENTS = {
    prompt: { hook: 'UserPromptSubmit', label: '프롬프트를 받을 때' },
    pre: { hook: 'PreToolUse', label: '명령·도구 실행 전' },
    post: { hook: 'PostToolUse', label: '명령·도구 실행 후' },
    wait: { hook: 'PermissionRequest', label: '승인을 기다릴 때' },
    stop: { hook: 'Stop', label: '작업이 끝났을 때' },
    compact: { hook: 'PostCompact', label: '대화가 압축된 뒤' },
  };
  const EVENT_OF_HOOK = Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [v.hook, k]));

  // Actions, and the events each one can run on. Text for Claude goes with a
  // prompt or a tool call (on a finished turn it would make Claude carry on);
  // block and ask only before a tool runs (Claude Code reads
  // permissionDecision there; HTTP hook replies verified on 2.1.331).
  const ACTIONS = {
    context: { label: 'Claude 에게 글 붙이기', events: ['prompt', 'pre', 'post'], reply: true },
    pipeline: { label: '파이프라인 노드 정보 붙이기', events: ['prompt'], reply: true },
    block: { label: '실행 막기', events: ['pre'], reply: true },
    ask: { label: '실행 전 확인 받기', events: ['pre'], reply: true },
    fill: { label: '다른 터미널 입력창에 글 넣기', events: Object.keys(EVENTS), reply: false },
    highlight: { label: '사이드바에 표시', events: Object.keys(EVENTS), reply: false },
  };

  const FREQS = { every: '매번', once: '세션당 한 번', changed: '글이 바뀔 때만' };
  const VARS = ['terminal', 'branch', 'cwd', 'prompt', 'command', 'file', 'tool', 'last_answer'];
  const SUBJECT_MAX = 20000;

  // The text a condition looks at for a hook event: the prompt, the tool and
  // its command or file, or Claude's last answer.
  function subject(ev) {
    const input = ev.tool_input && typeof ev.tool_input === 'object' ? ev.tool_input : {};
    let s = '';
    switch (ev.hook_event_name) {
      case 'UserPromptSubmit': s = ev.prompt || ''; break;
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PermissionRequest':
        s = [ev.tool_name, input.command || input.file_path || input.url || input.pattern || ''].filter(Boolean).join(' ');
        break;
      case 'Stop': s = ev.last_assistant_message || ''; break;
      default: s = '';
    }
    return String(s).slice(0, SUBJECT_MAX);
  }

  // Values a rule's text can use as {name}. `meta`: { terminal, branch, cwd }.
  function vars(ev, meta = {}) {
    const input = ev.tool_input && typeof ev.tool_input === 'object' ? ev.tool_input : {};
    return {
      terminal: meta.terminal || '',
      branch: meta.branch || '',
      cwd: ev.cwd || meta.cwd || '',
      prompt: typeof ev.prompt === 'string' ? ev.prompt : '',
      command: typeof input.command === 'string' ? input.command : '',
      file: typeof input.file_path === 'string' ? input.file_path : '',
      tool: ev.tool_name || '',
      last_answer: typeof ev.last_assistant_message === 'string' ? ev.last_assistant_message : '',
    };
  }

  function fillText(template, v) {
    return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
  }

  // Whether the condition holds for this subject: none, text (case-blind
  // "contains"), or a regular expression (case-blind; an invalid one never
  // matches).
  function condHolds(cond, text) {
    if (!cond || !cond.kind || cond.kind === 'none' || !cond.value) return true;
    if (cond.kind === 'text') return text.toLowerCase().includes(String(cond.value).toLowerCase());
    if (cond.kind === 'regex') {
      try { return new RegExp(cond.value, 'i').test(text); } catch { return false; }
    }
    return false;
  }

  // Whether `rule` (compiled: `terminals` is null for all, else a list of
  // terminal ids) fires for hook event `ev` of terminal `terminalId`.
  function fires(rule, ev, terminalId) {
    if (!rule || !rule.enabled) return false;
    if (EVENT_OF_HOOK[ev.hook_event_name] !== rule.event) return false;
    if (!ACTIONS[rule.action && rule.action.kind] || !ACTIONS[rule.action.kind].events.includes(rule.event)) return false;
    if (rule.terminals && !rule.terminals.includes(String(terminalId))) return false;
    return condHolds(rule.cond, subject(ev));
  }

  // The rule as one line for the list.
  function describe(rule, groupName = (id) => id) {
    const ev = EVENTS[rule.event] ? EVENTS[rule.event].label : '?';
    const cond = rule.cond && rule.cond.kind !== 'none' && rule.cond.value
      ? ` · ${rule.cond.kind === 'regex' ? '정규식' : '내용에'} 「${rule.cond.value}」` : '';
    const scope = !rule.scope || rule.scope.kind === 'all' ? '모든 터미널'
      : rule.scope.kind === 'group' ? `그룹 ${groupName(rule.scope.id)}` : `터미널 ${rule.scope.name}`;
    const a = rule.action || {};
    const what = a.kind === 'fill' ? `터미널 ${a.target || '?'} 입력창에 글 ${a.send ? '넣고 보내기' : '채우기'}`
      : (ACTIONS[a.kind] ? ACTIONS[a.kind].label : '?');
    return `${ev}${cond} · ${scope} → ${what}`;
  }

  // Starting points in the 자동화 tab's 템플릿 menu.
  const TEMPLATES = [
    { name: '작업 끝나면 다른 터미널에 넘기기', event: 'stop', cond: { kind: 'none', value: '' }, scope: { kind: 'terminal', name: '' }, action: { kind: 'fill', target: '', send: false, text: '{branch} 브랜치의 변경을 SPEC 기준으로 리뷰해줘' }, freq: 'every' },
    { name: '그룹 규칙 상기', event: 'prompt', cond: { kind: 'none', value: '' }, scope: { kind: 'group', id: '' }, action: { kind: 'context', text: '' }, freq: 'once' },
    { name: '위험 명령 확인', event: 'pre', cond: { kind: 'regex', value: 'git push|migrate' }, scope: { kind: 'all' }, action: { kind: 'ask', text: '이 명령은 실행 전에 확인합니다: {command}' }, freq: 'every' },
    { name: '키워드로 체크리스트', event: 'prompt', cond: { kind: 'text', value: '배포' }, scope: { kind: 'all' }, action: { kind: 'context', text: '배포 전 체크리스트: 시험 통과, 마이그레이션 확인, 롤백 방법.' }, freq: 'every' },
    { name: '승인 대기 표시', event: 'wait', cond: { kind: 'none', value: '' }, scope: { kind: 'all' }, action: { kind: 'highlight' }, freq: 'every' },
    { name: '파이프라인 노드 알리기', event: 'prompt', cond: { kind: 'none', value: '' }, scope: { kind: 'all' }, action: { kind: 'pipeline' }, freq: 'changed' },
  ];

  return { EVENTS, EVENT_OF_HOOK, ACTIONS, FREQS, VARS, TEMPLATES, subject, vars, fillText, condHolds, fires, describe };
}));
