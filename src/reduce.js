// Pure state machine: (session | undefined, event) -> session.
// Everything the UI shows is derived from the event log through this function,
// so the projection can be rebuilt at any time (`session-board rebuild`).

export const STATES = ['working', 'needs_input', 'review', 'idle', 'failed', 'unknown', 'ended'];

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
    // `phase` is the agent's own lifecycle. `requests` are the open questions
    // it has put to the human. `state` is derived from both: any open request
    // means needs_input, and resolving the last one falls back to the phase.
    phase: 'idle',
    phase_since: ev.ts,
    requests: [], // { id, kind: 'permission' | 'question', tool, detail, ts }
    auto_allow: [], // tools the human told the board to approve for this session
    files: [], // files this session's edit tools were pointed at
    start_head: null, // commit the working tree was on when first seen
    settled: null, // why the hub closed a review on its own ('merged')
    pr_alert: null, // the PR problem already raised, so it is raised once
    pr: null, // { number, url, title, state: open|merged|closed, draft, checks, review, base, head_sha }
    github: null, // "owner/repo", when a sender tells us (cloud sessions)
    tmux: null, // { socket, pane } when the agent runs inside tmux
    state: 'idle',
    since: ev.ts,
    waiting: null, // the oldest open request, for display
    usage: null, // { model, context_tokens, output_tokens, cost_usd }
    transcript: null,
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

function enter(s, phase, ts) {
  if (s.phase !== phase) {
    s.phase = phase;
    s.phase_since = ts;
  }
  if (phase !== 'failed' && phase !== 'unknown') s.error = null;
  if (phase !== 'working') s.current_tool = null;
}

// Open a request, merging the duplicate reports one prompt produces
// (PreToolUse/PermissionRequest carry the tool, Notification does not).
function open(s, ts, kind, tool, detail, id, questions) {
  const same = s.requests.find(
    (r) => r.kind === kind && (!tool || !r.tool || (r.tool === tool && (!detail || !r.detail || r.detail === detail))),
  );
  if (same) {
    same.tool ??= tool ?? null;
    same.detail ??= detail ?? null;
    same.id ??= id ?? null;
    same.questions ??= questions ?? null;
    return;
  }
  s.requests.push({ id: id ?? null, kind, tool: tool ?? null, detail: detail ?? null, ts, questions: questions ?? null });
}

// Resolve the oldest open request that matches. A request reported without a
// tool name (bare notification) is resolved by anything.
function resolve(s, { id, kind, tool } = {}) {
  const i = s.requests.findIndex((r) =>
    id ? r.id === id : (!kind || r.kind === kind) && (!tool || !r.tool || r.tool === tool),
  );
  if (i >= 0) s.requests.splice(i, 1);
  return i >= 0;
}

// What is wrong with a pull request that the human should hear about, if anything.
export function prProblem(pr) {
  if (!pr || pr.state !== 'open') return null;
  const parts = [pr.checks === 'failing' && 'checks', pr.review === 'changes_requested' && 'review'].filter(Boolean);
  return parts.length ? parts.join('+') : null;
}
export const prAlertKey = (pr) => (prProblem(pr) ? `${pr.number}:${pr.head_sha || ''}:${prProblem(pr)}` : null);

function derive(s) {
  const first = s.requests[0];
  if (first) {
    s.state = 'needs_input';
    s.since = first.ts;
    s.waiting = { id: first.id, kind: first.kind, tool: first.tool, detail: first.detail, questions: first.questions };
  } else {
    s.state = s.phase;
    s.since = s.phase_since;
    s.waiting = null;
  }
  return s;
}

// The structured form of a multiple-choice question, bounded for storage.
function questionsOf(input) {
  if (!Array.isArray(input?.questions)) return null;
  return input.questions.slice(0, 8).map((q) => ({
    question: clip(String(q.question ?? ''), 400),
    header: q.header ? clip(String(q.header), 60) : null,
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 12).map((o) => ({
      label: clip(String(o.label ?? o), 120),
      description: o.description ? clip(String(o.description), 300) : null,
    })),
  }));
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_FILES = 300;

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
  const s = prev ? { ...prev, requests: prev.requests.map((r) => ({ ...r })), auto_allow: [...prev.auto_allow], files: [...prev.files] } : blank(ev);
  const d = ev.data || {};
  const ts = ev.ts;
  s.last_event_ts = ts;
  if (ev.cwd && !s.cwd) s.cwd = ev.cwd;
  if (ev.transcript) s.transcript = ev.transcript;
  if (ev.host && s.host === 'local') s.host = ev.host;
  if (ev.runtime) s.runtime = ev.runtime;
  // Any sign of life un-archives a session, except the human's own actions.
  if (!ev.type.startsWith('human.') && !['session.ended', 'session.lost', 'session.imported', 'session.settled', 'meta.updated', 'usage.updated', 'pr.updated', 'rule.added', 'rule.removed', 'request.resolved'].includes(ev.type)) s.archived = false;

  const working = () => enter(s, 'working', ts);

  switch (ev.type) {
    case 'session.started':
      if (d.title && !s.title) s.title = clip(d.title, 120);
      s.tmux = d.tmux || null;
      // A resumed/forked session waits for a prompt; compaction happens mid-turn.
      if (d.source !== 'compact' && (s.phase === 'ended' || s.phase === 'unknown' || !prev)) {
        s.requests = [];
        enter(s, 'idle', ts);
      }
      break;

    case 'session.imported':
      // Found in the agent's own history files, not seen live. We know what it
      // was about, not whether anything is still running.
      if (d.title) s.title = clip(d.title, 120);
      if (d.last_prompt) s.last_prompt = clip(d.last_prompt, 600);
      if (d.last_message) s.last_message = clip(d.last_message, 1200);
      if (d.branch) s.branch = d.branch;
      if (d.repo) s.repo = d.repo;
      s.turns = d.turns || s.turns;
      s.imported = true;
      enter(s, 'ended', ts);
      break;

    case 'prompt.submitted': {
      // A message sent from the board is recorded at once, and then reported
      // again by the agent's own hook when it picks it up: one turn, not two.
      const echo = s.board_prompt && !d.via && clip(d.prompt, 600) === s.last_prompt;
      s.board_prompt = d.via === 'board';
      if (!echo) s.turns += 1;
      s.last_prompt = clip(d.prompt, 600);
      if (!s.title && d.prompt) s.title = clip(String(d.prompt).split('\n')[0], 120);
      s.background = 0;
      s.settled = null;
      s.requests = []; // the human is at the keyboard: nothing is pending
      working();
      break;
    }

    case 'tool.started':
      if (QUESTION_TOOLS.has(d.tool)) {
        open(s, ts, 'question', d.tool, summarizeToolInput(d.tool, d.input), null, questionsOf(d.input));
      } else {
        s.current_tool = { tool: d.tool, detail: summarizeToolInput(d.tool, d.input) };
      }
      // Remember which files this session set out to change, so review can
      // show its own work apart from everything else in the working tree.
      if (EDIT_TOOLS.has(d.tool)) {
        const file = d.input?.file_path || d.input?.notebook_path;
        if (typeof file === 'string' && !s.files.includes(file) && s.files.length < MAX_FILES) s.files.push(file);
      }
      working();
      break;

    case 'tool.finished':
      // Only the tool a request was about resolves it; parallel tool calls
      // (e.g. from subagents) leave other requests open.
      resolve(s, { tool: d.tool });
      working();
      break;

    case 'permission.requested':
      if (QUESTION_TOOLS.has(d.tool)) {
        // A question tool asks through the permission channel: same request,
        // now with an id the board can answer.
        open(s, ts, 'question', d.tool, summarizeToolInput(d.tool, d.input), d.request_id, questionsOf(d.input));
      } else if (d.tool || !s.requests.length) {
        // A bare "needs your permission" notice adds nothing to an open request.
        open(s, ts, 'permission', d.tool, summarizeToolInput(d.tool, d.input), d.request_id);
      }
      working();
      break;

    case 'permission.denied':
      resolve(s, { kind: 'permission', tool: d.tool });
      break;

    case 'question.asked':
      open(s, ts, 'question', d.tool ?? null, clip(d.message, 400));
      break;

    case 'request.resolved':
      if (d.all) s.requests = [];
      else resolve(s, { id: d.id, kind: d.kind, tool: d.tool });
      break;

    case 'rule.added':
      if (d.tool && !s.auto_allow.includes(d.tool)) s.auto_allow.push(d.tool);
      break;

    case 'rule.removed':
      s.auto_allow = s.auto_allow.filter((t) => t !== d.tool);
      break;

    case 'turn.completed':
      if (d.message) s.last_message = clip(d.message, 1200);
      s.background = d.background || 0;
      s.requests = [];
      // With background work pending the agent will wake itself up again.
      // Otherwise "agent says done" is not "human accepted": park for review.
      enter(s, s.background > 0 ? 'working' : 'review', ts);
      break;

    case 'turn.failed':
      if (d.message) s.last_message = clip(d.message, 1200);
      s.requests = [];
      enter(s, 'failed', ts);
      s.error = clip(d.error || 'unknown error', 300);
      s.rate_limited = /rate_limit|quota|billing|account_on_hold/.test(String(d.error));
      break;

    case 'turn.interrupted':
      // The human stopped it themselves; nothing to tell them.
      s.requests = [];
      enter(s, 'idle', ts);
      break;

    case 'subagent.started':
      s.subagents += 1;
      working();
      break;

    case 'subagent.stopped':
      s.subagents = Math.max(0, s.subagents - 1);
      break;

    case 'session.ended':
      s.subagents = 0;
      s.background = 0;
      s.requests = [];
      // Keep unreviewed results and failures visible after the process exits.
      if (s.phase !== 'review' && s.phase !== 'failed') enter(s, 'ended', ts);
      s.exited = true;
      s.tmux = null;
      break;

    case 'session.lost':
      // Reconciliation found no live agent process behind a session we showed
      // as active. Say so rather than keep claiming it is working.
      s.requests = [];
      s.subagents = 0;
      s.background = 0;
      enter(s, 'unknown', ts);
      s.error = clip(d.reason || 'agent process not found', 300);
      s.exited = true;
      s.tmux = null;
      break;

    case 'human.acknowledged':
      // Dismissing a PR alert is its own act: the work itself stays in review.
      if (s.requests.some((r) => r.kind === 'pr')) s.requests = s.requests.filter((r) => r.kind !== 'pr');
      else if (['review', 'failed', 'unknown'].includes(s.phase)) enter(s, s.exited ? 'ended' : 'idle', ts);
      break;

    case 'human.archived':
      s.archived = true;
      break;

    case 'session.settled':
      // Decided by the hub from recorded facts, with no one watching.
      if (d.reason === 'merged' && s.phase === 'review') {
        enter(s, s.exited ? 'ended' : 'idle', ts);
        s.settled = 'merged';
      } else if (d.reason === 'inactive') {
        s.archived = true;
      }
      break;

    case 'meta.updated':
      if (d.repo !== undefined) s.repo = d.repo;
      if (d.branch !== undefined) s.branch = d.branch;
      if (d.head && !s.start_head) s.start_head = d.head;
      if (d.github) s.github = d.github;
      if (d.title) s.title = clip(d.title, 120);
      break;

    case 'pr.updated': {
      s.pr = d.pr || null;
      // A failing check or a "changes requested" review joins the queue as a
      // request of its own: once per problem, and not while the agent is
      // mid-turn (it may be fixing exactly this). It leaves when the problem
      // does, when the human dismisses it, or when they send the agent off.
      const key = prAlertKey(s.pr);
      if (!key) {
        s.requests = s.requests.filter((r) => r.kind !== 'pr');
        s.pr_alert = null;
      } else if (key !== s.pr_alert && s.phase !== 'working') {
        s.requests = s.requests.filter((r) => r.kind !== 'pr');
        s.requests.push({ id: null, kind: 'pr', tool: null, detail: prProblem(s.pr), ts, questions: null });
        s.pr_alert = key;
      }
      break;
    }

    case 'usage.updated':
      s.usage = { ...s.usage, ...d };
      break;

    default:
      break; // unknown event types are kept in the log but do not move state
  }
  const passive = ['session.ended', 'session.lost', 'session.imported', 'session.settled', 'meta.updated', 'usage.updated', 'pr.updated', 'rule.added', 'rule.removed', 'request.resolved'];
  if (!passive.includes(ev.type) && !ev.type.startsWith('human.')) {
    s.exited = false;
    s.imported = false;
  }
  if (s.phase !== 'failed') s.rate_limited = false;
  return derive(s);
}

// Attention ordering. Deliberately simple and explainable: a fixed tier per
// kind of request, then longest-waiting first. (Olsen & Goodrich: a poor
// attention ranking can be worse than plain round-robin.)
export function attentionTier(s) {
  if (s.archived) return null;
  // Blocked agents first (a permission is the cheapest to clear), then broken
  // ones, then pull requests that need attention, then finished work.
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? 0 : s.waiting?.kind === 'pr' ? 3 : 1;
  if (s.state === 'failed' || s.state === 'unknown') return 2;
  if (s.state === 'review') return 4;
  return null;
}

export function attentionQueue(sessions) {
  return sessions
    .filter((s) => attentionTier(s) !== null)
    .sort((a, b) => attentionTier(a) - attentionTier(b) || a.since - b.since);
}
