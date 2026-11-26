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
    prompt: { hook: 'UserPromptSubmit', label: '💬 프롬프트' },
    pre: { hook: 'PreToolUse', label: '🛠️ 실행 전' },
    post: { hook: 'PostToolUse', label: '✅ 실행 후' },
    wait: { hook: 'PermissionRequest', label: '✋ 승인 대기' },
    stop: { hook: 'Stop', label: '🏁 작업 끝' },
    compact: { hook: 'PostCompact', label: '🗜️ 압축 뒤' },
  };
  const EVENT_OF_HOOK = Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [v.hook, k]));

  // Actions, and the events each one can run on. Text for Claude goes with a
  // prompt or a tool call (on a finished turn it would make Claude carry on);
  // block and ask only before a tool runs (Claude Code reads
  // permissionDecision there; HTTP hook replies verified on 2.1.331).
  const ACTIONS = {
    context: { label: '📝 글 붙이기', events: ['prompt', 'pre', 'post'], reply: true },
    pipeline: { label: '🧭 노드 정보 붙이기', events: ['prompt'], reply: true },
    block: { label: '⛔ 막기', events: ['pre'], reply: true },
    ask: { label: '❓ 확인 받기', events: ['pre'], reply: true },
    fill: { label: '↪️ 다른 터미널에 넣기', events: Object.keys(EVENTS), reply: false },
    highlight: { label: '⚡ 표시', events: Object.keys(EVENTS), reply: false },
  };

  const FREQS = { every: '매번', once: '세션당 1번', changed: '바뀔 때만' };
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

  // Whether hook event agent_type `type` is agent `name`: the session
  // started with `claude --agent <name>` (every hook of it carries the name)
  // or a subagent of that type (verified on Claude Code 2.1.332). A plain
  // name also matches a plugin's agent of that name ("plugin:name").
  function agentMatches(type, name) {
    const t = String(type || '');
    const n = String(name || '').trim();
    return Boolean(t && n) && (t === n || (!n.includes(':') && t.endsWith(`:${n}`)));
  }

  // Whether `rule` (compiled: `terminals` is null for all, else a list of
  // terminal ids; `agent` null for any agent) fires for hook event `ev` of
  // terminal `terminalId`.
  function fires(rule, ev, terminalId) {
    if (!rule || !rule.enabled) return false;
    if (EVENT_OF_HOOK[ev.hook_event_name] !== rule.event) return false;
    if (!ACTIONS[rule.action && rule.action.kind] || !ACTIONS[rule.action.kind].events.includes(rule.event)) return false;
    if (rule.terminals && !rule.terminals.includes(String(terminalId))) return false;
    if (rule.agent && !agentMatches(ev.agent_type, rule.agent)) return false;
    return condHolds(rule.cond, subject(ev));
  }

  // The rule as one short line for the list: when · condition · where →
  // what. "Every terminal" is left out; "?" marks a choice still to make.
  function describe(rule, groupName = (id) => id) {
    const ev = EVENTS[rule.event] ? EVENTS[rule.event].label : '?';
    const c = rule.cond || {};
    const shown = String(c.value || '').length > 40 ? `${String(c.value).slice(0, 40)}…` : c.value;
    const cond = c.kind === 'none' || !c.value ? '' : ` · ${c.label || `「${shown}」`}`;
    const s = rule.scope || {};
    const scope = !s.kind || s.kind === 'all' ? ''
      : s.kind === 'group' ? ` · 📁 ${groupName(s.id)}`
        : s.kind === 'agent' ? ` · 🤖 ${s.name || '?'}` : ` · 🖥️ ${s.name || '?'}`;
    const a = rule.action || {};
    const what = a.kind === 'fill' ? `↪️ ${a.target || '?'} ${a.send ? '보내기' : '넣기'}`
      : (ACTIONS[a.kind] ? ACTIONS[a.kind].label : '?');
    return `${ev}${cond}${scope} → ${what}`;
  }

  // Starting points in the 자동화 tab's 템플릿 menu, by `group`. Guards watch
  // the tool and its command or file (subject): a command line only, not a
  // script it runs, so they catch slips, not intent. Command guards
  // (`shellGuard`) hold for a shell tool only, not for a file read or a
  // search that merely names the same words (db/migrate/, "sudo"). Each
  // regex is tested against what it must and must not catch
  // (test/rules.test.js).
  const R = String.raw;
  const END = R`(?=\s|;|&|\||\)|$)`; // end of a command-line word
  const EDIT = R`^(Edit|Write|MultiEdit) `;
  const none = { kind: 'none', value: '' };
  // `label`: what the condition is about, shown in the list instead of the
  // regex until the user changes it.
  const re = (value, label) => ({ kind: 'regex', value, label });
  const all = { kind: 'all' };
  const guard = (name, label, kind, value, text) => ({ group: '🛡️ 지키기', name, event: 'pre', cond: re(value, label), scope: all, action: { kind, text }, freq: 'every' });
  // PowerShell: the Windows shell tool's name, unverified (harmless if absent).
  const shellGuard = (name, label, kind, value, text) => guard(name, label, kind, R`^(Bash|PowerShell) [\s\S]*?(?:` + value + ')', text);
  const tell = (name, event, cond, text, freq = 'every', scope = all) => ({ group: '💬 알려 주기', name, event, cond, scope, action: { kind: 'context', text }, freq });
  const TEMPLATES = [
    guard('비밀 파일 막기', '비밀 파일', 'block',
      R`(^|[\\/\s])(\.env(\.[\w-]+)?|id_rsa|id_ed25519|id_ecdsa|[\w-]+\.(pem|key|p12|pfx)|credentials(\.json)?|\.netrc|\.pgpass)` + END,
      '비밀 정보가 든 파일은 읽거나 고치지 않습니다: {file}{command}. 필요하면 사용자에게 값을 요청하세요.'),
    shellGuard('넓은 삭제 막기', '루트·홈·폴더 전체 삭제', 'block',
      R`\brm\b(?=[^;&|]*\s(-[a-zA-Z]*[rR]|--recursive))[^;&|]*\s["']?(\/\*?|~\/?\*?|\$HOME\/?\*?|\.\.?\/?\*?|\*)["']?` + END,
      '루트·홈·현재 폴더 전체를 지우는 명령은 막혀 있습니다: {command}. 지울 대상을 정확히 적으세요.'),
    shellGuard('되돌릴 수 없는 git 명령 막기', '되돌릴 수 없는 git 명령', 'block',
      R`\bgit\s+push\b[^;&|]*\s(--force|-f)` + END + R`|\bgit\s+reset\b[^;&|]*\s--hard\b|\bgit\s+clean\s+[^;&|]*-[a-zA-Z]*f|\bgit\s+(checkout|restore)\s+(--\s+)?\.` + END,
      '작업을 되돌릴 수 없게 지우는 git 명령은 막혀 있습니다: {command}. 필요하면 사용자에게 직접 실행을 요청하세요.'),
    guard('잠금 파일 직접 수정 막기', '잠금 파일 수정', 'block',
      EDIT + R`.*[\\/](package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$`,
      '잠금 파일({file})은 손으로 고치지 않습니다. 패키지 관리자 명령으로 바꾸세요.'),
    shellGuard('푸시 전 확인', 'git push', 'ask', R`\bgit\s+push\b`, '원격 저장소로 올리기 전 확인: {command}'),
    shellGuard('의존성 설치 확인', '패키지 설치', 'ask',
      R`\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install)\b|\bpoetry\s+add\b|\bcargo\s+add\b|\bgo\s+get\b|\bgem\s+install\b`,
      '새 패키지 설치 전 확인: {command}'),
    shellGuard('인터넷 스크립트 실행 확인', '받은 스크립트 바로 실행', 'ask',
      R`\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)\b|\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^;&]*\|\s*(iex|Invoke-Expression)\b`,
      '인터넷에서 받은 스크립트를 바로 실행하기 전 확인: {command}'),
    shellGuard('외부로 보내는 명령 확인', '밖으로 보내기', 'ask',
      R`\bcurl\b[^;&|]*\s(-d|--data(-[a-z]+)?|-F|--form|-T|--upload-file)(\s|=)|\bwget\b[^;&|]*\s--post-(data|file)\b|\bscp\b|\brsync\b[^;&|]*\s[\w.@-]+:`,
      '이 PC 밖으로 데이터를 보내기 전 확인: {command}'),
    shellGuard('배포·인프라 명령 확인', '배포·인프라 명령', 'ask',
      R`\bkubectl\s+(apply|create|delete|replace|patch|scale|rollout|drain)\b|\b(terraform|tofu)\s+(apply|destroy|import)\b|\bhelm\s+(install|upgrade|uninstall|rollback|delete)\b|\bpulumi\s+(up|destroy)\b|\bdocker\s+push\b|\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b`,
      '배포나 공유 인프라를 바꾸는 명령 전 확인: {command}'),
    shellGuard('DB 변경 확인', 'DB 변경', 'ask',
      R`\bmigrate\b|\bdb:(migrate|rollback|reset|drop)\b|\balembic\s+(upgrade|downgrade)\b|\bprisma\s+db\s+push\b|\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)|TRUNCATE|ALTER\s+TABLE)\b|\bDELETE\s+FROM\s+[\w."]+\s*(;|"|'|$)`,
      '데이터베이스 구조나 데이터를 바꾸는 명령 전 확인: {command}'),
    shellGuard('관리자 권한 확인', '관리자 권한', 'ask', R`\bsudo\b|\b(Start-Process\b[^;&|]*-Verb\s+RunAs)\b`, '관리자 권한으로 실행하기 전 확인: {command}'),
    guard('시스템·계정 설정 수정 확인', '시스템·계정 설정 파일', 'ask',
      EDIT + R`(\/etc\/|.*[\\/]\.ssh[\\/]|.*[\\/]\.aws[\\/]|.*[\\/]\.(bashrc|zshrc|profile|bash_profile|zprofile|gitconfig|npmrc|pypirc)$|.*[\\/]\.claude[\\/]settings(\.local)?\.json$)`,
      '셸·계정·Claude 권한 설정 파일을 고치기 전 확인: {file}'),

    tell('답변 방식', 'prompt', none, '답변은 한국어로, 결론부터 짧게 해 주세요.', 'once'),
    tell('작업 위치 알리기', 'prompt', none, '작업 위치: {cwd} (브랜치 {branch}). main·master 같은 기본 브랜치라면 커밋하기 전에 먼저 물어보세요.', 'changed'),
    tell('큰 변경은 계획 먼저', 'prompt', re(R`리팩터|리팩토링|refactor|마이그레이션|migration|구조\s*(변경|개편)|재설계|전체\s*(수정|변경)|모든\s*파일`, '큰 변경 낱말'),
      '범위가 큰 작업입니다. 고치기 전에 바꿀 파일과 순서를 먼저 보여 주고 확인을 받으세요.'),
    tell('버그는 재현부터', 'prompt', re(R`버그|안\s*돼|안\s*됨|오류|에러|실패|깨[져짐]|bug|error|fail|crash|exception`, '버그·오류 낱말'),
      '고치기 전에 원인을 재현해 확인하고, 고친 뒤 같은 방법으로 해결됐는지 확인하세요.'),
    tell('커밋 규칙 상기', 'prompt', re(R`커밋|commit|\bPR\b|풀\s*리퀘`, '커밋·PR 낱말'),
      '커밋 메시지는 Conventional Commits(feat:, fix:, docs: …) 형식, 제목은 명령형으로 짧게 써 주세요.'),
    tell('키워드에 체크리스트 붙이기', 'prompt', re(R`배포|릴리스|release|deploy`, '배포 낱말'), '배포 전 체크리스트: 시험 통과, 마이그레이션 확인, 롤백 방법.'),
    tell('수정 뒤 시험 상기', 'post', re(EDIT, '파일 수정'), '파일을 고쳤으면 끝내기 전에 관련 시험·검사를 돌려 결과를 확인하세요.', 'once'),
    tell('그룹 규칙 상기', 'prompt', none, '이 그룹의 작업 규칙: (여기에 적기)', 'once', { kind: 'group', id: '' }),

    { group: '↪️ 넘기기·표시', name: '작업 끝나면 다른 터미널에 넘기기', event: 'stop', cond: none, scope: { kind: 'terminal', name: '' }, action: { kind: 'fill', target: '', send: false, text: '「{terminal}」의 작업이 끝났어. {branch} 브랜치의 변경을 검토해줘.' }, freq: 'every' },
    { group: '↪️ 넘기기·표시', name: '마지막 답 넘기기', event: 'stop', cond: none, scope: { kind: 'terminal', name: '' }, action: { kind: 'fill', target: '', send: false, text: '「{terminal}」의 마지막 답이야. 이어서 처리해줘.\n\n{last_answer}' }, freq: 'every' },
    { group: '↪️ 넘기기·표시', name: '질문으로 끝나면 표시', event: 'stop', cond: re(R`(\?|？|까요\.?)\s*$`, '질문으로 끝남'), scope: all, action: { kind: 'highlight' }, freq: 'every' },
    { group: '↪️ 넘기기·표시', name: '승인 대기 표시', event: 'wait', cond: none, scope: all, action: { kind: 'highlight' }, freq: 'every' },
    { group: '↪️ 넘기기·표시', name: '작업 끝 표시', event: 'stop', cond: none, scope: all, action: { kind: 'highlight' }, freq: 'every' },

    { group: '🧭 파이프라인', name: '파이프라인 노드 알리기', event: 'prompt', cond: none, scope: all, action: { kind: 'pipeline' }, freq: 'changed' },
  ];

  return { EVENTS, EVENT_OF_HOOK, ACTIONS, FREQS, VARS, TEMPLATES, subject, vars, fillText, condHolds, agentMatches, fires, describe };
}));
