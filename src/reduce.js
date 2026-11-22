// Pure state machine: (session | undefined, event) -> session.
// Everything the UI shows is derived from the event log through this function,
// so the projection can be rebuilt at any time (`session-board rebuild`).

export const STATES = ['working', 'needs_input', 'review', 'idle', 'failed', 'ended'];

// Events that mean "the human has seen / handled the pending request".
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'request_user_input']);

const clip = (s, n) => {
  if (typeof s !== 'string') return s == null ? null : clip(JSON.stringify(s), n);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export function sessionKey(ev) {
  return `${ev.agent}:${ev.session_id}`;
}

function blank(ev) {
  return {
    key: sessionKey(ev),
    agent: ev.agent,
    session_id: ev.session_id,
    host: ev.host || 'local',
    runtime: ev.runtime || 'local',
    cwd: ev.cwd || null,
    repo: null,
    branch: null,
    title: null,
    state: 'idle',
    since: ev.ts,
    waiting: null, // { kind: 'permission' | 'question', tool, detail }
    background: 0,
    subagents: 0,
    current_tool: null,
    last_prompt: null,
    last_message: null,
    error: null,
    turns: 0,
    created_ts: ev.ts,
    last_event_ts: ev.ts,
    archived: false,
  };
}

function enter(s, state, ts) {
  if (s.state !== state) {
    s.state = state;
    s.since = ts;
  }
  if (state !== 'needs_input') s.waiting = null;
  if (state !== 'failed') s.error = null;
  if (state !== 'working') s.current_tool = null;
}

function wait(s, ts, kind, tool, detail) {
  // Keep the original wait start if we are already waiting on the same thing
  // (PermissionRequest and Notification both fire for one prompt).
  const same = s.state === 'needs_input' && s.waiting && s.waiting.kind === kind;
  if (!same) {
    s.state = 'needs_input';
    s.since = ts;
  }
  s.waiting = {
    kind,
    tool: tool ?? s.waiting?.tool ?? null,
    detail: detail ?? s.waiting?.detail ?? null,
  };
  s.current_tool = null;
}

export function summarizeToolInput(tool, input) {
  if (input == null) return null;
  if (typeof input === 'string') return clip(input, 400);
  if (typeof input.command === 'string') return clip(input.command, 400);
  if (Array.isArray(input.command)) return clip(input.command.join(' '), 400);
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.url === 'string') return input.url;
  if (Array.isArray(input.questions)) {
    return clip(input.questions.map((q) => q.question).filter(Boolean).join(' / '), 400);
  }
  if (typeof input.question === 'string') return clip(input.question, 400);
  if (typeof input.description === 'string') return clip(input.description, 400);
  return clip(JSON.stringify(input), 400);
}

export function reduce(prev, ev) {
  const s = prev ? { ...prev, waiting: prev.waiting && { ...prev.waiting } } : blank(ev);
  const d = ev.data || {};
  const ts = ev.ts;
  s.last_event_ts = ts;
  if (ev.cwd && !s.cwd) s.cwd = ev.cwd;
  if (ev.host && s.host === 'local') s.host = ev.host;
  if (ev.runtime) s.runtime = ev.runtime;
  // Any sign of life un-archives a session, except the human's own actions.
  if (!ev.type.startsWith('human.') && ev.type !== 'session.ended') s.archived = false;

  switch (ev.type) {
    case 'session.started':
      if (d.title && !s.title) s.title = clip(d.title, 120);
      // A resumed/forked session waits for a prompt; compaction happens mid-turn.
      if (d.source !== 'compact' && (s.state === 'ended' || !prev)) enter(s, 'idle', ts);
      break;

    case 'prompt.submitted':
      s.turns += 1;
      s.last_prompt = clip(d.prompt, 600);
      if (!s.title && d.prompt) s.title = clip(String(d.prompt).split('\n')[0], 120);
      s.background = 0;
      enter(s, 'working', ts);
      break;

    case 'tool.started':
      if (QUESTION_TOOLS.has(d.tool)) {
        wait(s, ts, 'question', d.tool, summarizeToolInput(d.tool, d.input));
        break;
      }
      // Parallel tool calls (e.g. from subagents) must not hide a pending request.
      if (s.state === 'needs_input') break;
      enter(s, 'working', ts);
      s.current_tool = { tool: d.tool, detail: summarizeToolInput(d.tool, d.input) };
      break;

    case 'tool.finished':
      if (s.state === 'needs_input') {
        // Only the tool we were waiting on resolves the wait.
        if (!s.waiting?.tool || s.waiting.tool === d.tool) enter(s, 'working', ts);
        break;
      }
      enter(s, 'working', ts);
      break;

    case 'permission.requested':
      wait(s, ts, 'permission', d.tool, summarizeToolInput(d.tool, d.input));
      break;

    case 'permission.denied':
      if (s.state === 'needs_input') enter(s, 'working', ts);
      break;

    case 'question.asked':
      wait(s, ts, 'question', d.tool ?? null, clip(d.message, 400));
      break;

    case 'turn.completed':
      if (d.message) s.last_message = clip(d.message, 1200);
      s.background = d.background || 0;
      if (s.background > 0) {
        // The turn ended but background work will wake the agent up again.
        enter(s, 'working', ts);
      } else {
        // "Agent says done" is not "human accepted": park it for review.
        enter(s, 'review', ts);
      }
      break;

    case 'turn.failed':
      if (d.message) s.last_message = clip(d.message, 1200);
      enter(s, 'failed', ts);
      s.error = clip(d.error || 'unknown error', 300);
      break;

    case 'turn.interrupted':
      // The human stopped it themselves; nothing to tell them.
      enter(s, 'idle', ts);
      break;

    case 'subagent.started':
      s.subagents += 1;
      if (s.state !== 'needs_input') enter(s, 'working', ts);
      break;

    case 'subagent.stopped':
      s.subagents = Math.max(0, s.subagents - 1);
      break;

    case 'session.ended':
      s.subagents = 0;
      s.background = 0;
      // Keep unreviewed results and failures visible after the process exits.
      if (s.state !== 'review' && s.state !== 'failed') enter(s, 'ended', ts);
      s.exited = true;
      break;

    case 'human.acknowledged':
      if (s.state === 'review' || s.state === 'failed') enter(s, s.exited ? 'ended' : 'idle', ts);
      break;

    case 'human.archived':
      s.archived = true;
      break;

    case 'meta.updated':
      if (d.repo !== undefined) s.repo = d.repo;
      if (d.branch !== undefined) s.branch = d.branch;
      if (d.title) s.title = clip(d.title, 120);
      break;

    default:
      break; // unknown event types are kept in the log but do not move state
  }
  if (ev.type !== 'session.ended' && !ev.type.startsWith('human.') && ev.type !== 'meta.updated') {
    s.exited = false;
  }
  return s;
}

// Attention ordering. Deliberately simple and explainable: a fixed tier per
// kind of request, then longest-waiting first. (Olsen & Goodrich: a poor
// attention ranking can be worse than plain round-robin.)
export function attentionTier(s) {
  if (s.archived) return null;
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? 0 : 1;
  if (s.state === 'failed') return 2;
  if (s.state === 'review') return 3;
  return null;
}

export function attentionQueue(sessions) {
  return sessions
    .filter((s) => attentionTier(s) !== null)
    .sort((a, b) => attentionTier(a) - attentionTier(b) || a.since - b.since);
}
