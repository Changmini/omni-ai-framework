'use strict';

// Pure reducer: Claude Code hook events -> what one terminal's Claude is doing.
// Event names and fields: https://code.claude.com/docs/en/hooks
//
// status of the main agent and of each subagent/teammate:
//   working - a prompt or tool call is in progress
//   waiting - Claude is waiting for the user (permission prompt, input)
//   idle    - finished responding, waiting for the next prompt
//   error   - the turn ended on an API error (StopFailure)
//   null    - Claude is not running in this terminal

const MAX_STOPPED = 200;
const WAIT_NOTIFICATIONS = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog']);

function emptyState() {
  return {
    status: null,
    tool: null,
    message: null,
    sessionId: null,
    cwd: null,
    agents: {}, // agent_id -> { type, name, status, tool }
    teammates: {}, // teammate name -> { status }
    stopped: [], // recent agent_ids that sent SubagentStop (newest last)
    updatedAt: 0,
  };
}

// Returns a new state; never mutates the input.
function reduce(prev, ev, now = Date.now()) {
  const s = {
    ...prev,
    agents: { ...prev.agents },
    teammates: { ...prev.teammates },
    updatedAt: now,
  };
  if (ev.session_id) s.sessionId = ev.session_id;
  if (ev.cwd) s.cwd = ev.cwd;

  const agentId = ev.agent_id || null;
  // Hooks arrive over parallel HTTP requests, so a subagent's last tool event
  // can land after its SubagentStop. Never bring a stopped agent back.
  // TeammateIdle still counts: it follows SubagentStop and only marks the
  // teammate's name idle.
  const late = !['SubagentStop', 'TeammateIdle'].includes(ev.hook_event_name);
  if (agentId && late && prev.stopped && prev.stopped.includes(agentId)) {
    return prev;
  }
  // Events from inside a subagent or in-process teammate update that agent;
  // the main agent stays as it was.
  const touchAgent = (patch) => {
    const a = s.agents[agentId] || { type: ev.agent_type || null, name: null, status: 'working', tool: null };
    s.agents[agentId] = { ...a, ...patch, type: a.type || ev.agent_type || null };
  };
  const touchMain = (patch) => Object.assign(s, patch);
  const touch = agentId ? touchAgent : touchMain;

  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      if (!agentId) touchMain({ status: 'working', tool: null, message: null });
      break;
    case 'PreToolUse':
      touch({ status: 'working', tool: ev.tool_name || null, ...(agentId ? {} : { message: null }) });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      touch({ status: 'working', tool: null });
      break;
    case 'PermissionRequest':
      touch({ status: 'waiting', tool: ev.tool_name || null, ...(agentId ? {} : { message: ev.tool_name ? `${ev.tool_name} 승인 대기` : '승인 대기' }) });
      break;
    case 'Notification':
      if (WAIT_NOTIFICATIONS.has(ev.notification_type)) {
        touch({ status: 'waiting', ...(agentId ? {} : { message: ev.message || '입력 대기' }) });
      } else if (ev.notification_type === 'idle_prompt' && !agentId) {
        touchMain({ status: 'idle', tool: null });
      }
      break;
    case 'SubagentStart':
      if (agentId) touchAgent({ status: 'working', tool: null });
      break;
    case 'SubagentStop':
      if (agentId) {
        delete s.agents[agentId];
        s.stopped = [...(prev.stopped || []).filter((x) => x !== agentId), agentId].slice(-MAX_STOPPED);
      }
      break;
    case 'Stop':
      if (!agentId) {
        touchMain({ status: 'idle', tool: null, message: null });
        // background_tasks lists what still runs after this turn ([] when
        // nothing does, seen on 2.1.318). Then any agent left is stale.
        if (Array.isArray(ev.background_tasks) && ev.background_tasks.length === 0) s.agents = {};
      } else {
        touchAgent({ status: 'idle', tool: null });
      }
      break;
    case 'StopFailure':
      touch({ status: 'error', tool: null, ...(agentId ? {} : { message: `API 오류: ${ev.error || 'unknown'}` }) });
      break;
    case 'TeammateIdle':
      if (ev.teammate_name) s.teammates[ev.teammate_name] = { status: 'idle' };
      // Only update a teammate still running: TeammateIdle can arrive after
      // its SubagentStop (seen on Claude Code 2.1.318).
      if (agentId && s.agents[agentId]) touchAgent({ status: 'idle', tool: null, name: ev.teammate_name || null });
      break;
    case 'SessionEnd':
      return { ...emptyState(), cwd: s.cwd, updatedAt: now };
    default:
      break;
  }
  return s;
}

// Folds team members (from the team config) into the agent list so teammates
// show by name. A teammate already seen in hooks keeps its live status. Ids
// differ between the two sources (config "alpha@session-xxxx", hooks
// "aalpha-<hex>" with agent_type "alpha" on 2.1.318), so match by name too.
function withTeam(state, team) {
  const members = team ? team.members.filter((m) => m.agentType !== 'team-lead') : [];
  if (!members.length) return state;
  const agents = { ...state.agents };
  for (const m of members) {
    const liveKey = Object.keys(agents).find((k) => k === m.agentId || agents[k].name === m.name || agents[k].type === m.name);
    const live = liveKey ? agents[liveKey] : null;
    if (liveKey) delete agents[liveKey];
    const idle = state.teammates[m.name]?.status === 'idle';
    agents[m.agentId || `team:${m.name}`] = {
      type: (live && live.type) || m.agentType || null,
      name: m.name,
      status: (live && live.status) || (idle ? 'idle' : 'working'),
      tool: (live && live.tool) || null,
      teammate: true,
    };
  }
  return { ...state, agents };
}

module.exports = { emptyState, reduce, withTeam };
