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
    // Filing is kept apart from state: these record what the human did with
    // the session, not what the agent is doing.
    seen_ts: 0, // when the human last looked at it
    snoozed_until: null, // out of the queue until then, unless it needs them sooner
    acked: null, // { phase, since } before the last acknowledgement, for undo
    outgoing: null, // { text, via, ts } a reply sent from the board, not yet confirmed received
    queued: [], // messages waiting to be handed over by a hook when its turn ends
    stop_requested: false, // the human asked it to stop; the next hook tells it
    cloud_id: null, // the vendor's id for a cloud session
    url: null, // where to open it in the vendor's own UI
    activity: null, // what a cloud session says it is doing right now
    tip: null, // commit its branch points at (cloud sessions known through git)
    commits: [], // its recent commits: { sha, ts, subject }
    ahead: null, behind: null, // commits it has that the default branch lacks, and the reverse
    base_branch: null, // the repository's default branch
    base_conflicts: null, // files that would conflict merging into the default branch ([] = clean, null = unknown)
    git_recent: false, // committed within the "recently active" window
    listed: false, // seen in the vendor's session list (which knows its state better than git does)
    last_commit_ts: 0, // newest commit on its branch, for sessions known through git
    hooked: false, // its own hooks report to us (so a coarse cloud listing must not drive its state)
    task_reason: null, // why task_manual was set: 'parent' when a parent session spawned it
    repo_id: null, // what identifies the repository across worktrees (remote, or the shared git dir)
    task_manual: null, // another session's key (joined by hand) or 'solo' (pulled out by hand)
    triage: null, // { for, summary, suggestion, ts } a triage agent's note on what is currently open
    first_prompt: null, // what was originally asked, for coming back to a session cold
    title_manual: false, // the human named it; do not rename it for them
    compactions: 0, // times the agent's context was compacted
    baseline: null, // commit-ish of the working tree when the session was first seen
    checks: [], // recent test / lint / type / build runs: { kind, cmd, ok, ts }
    last_edit_ts: 0, // last time an edit tool ran, to tell "tests passed" from "tests passed, then more edits"
    viewed: {}, // file -> content hash the human marked as reviewed
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
  s.requests.push({
    id: id ?? null, kind, tool: tool ?? null, detail: detail ?? null, ts, questions: questions ?? null,
    risky: kind === 'permission' && isRisky(detail),
  });
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

// A cloud session known only through git: what its commits and pull request
// allow us to say. Git shows what it did and when, never that it is waiting.
function gitState(s, ts) {
  if (s.pr?.state === 'merged') {
    if (s.phase !== 'idle') enter(s, 'idle', ts);
    s.settled = 'merged';
    s.activity = null;
  } else if (s.git_recent) {
    enter(s, 'working', ts);
    s.activity = null;
  } else if (s.pr?.state === 'open' && !s.pr.draft && s.reviewed_tip !== s.tip) {
    // It opened a pull request and went quiet: there is something to review
    // (unless the human already accepted exactly this commit).
    if (s.phase !== 'review') enter(s, 'review', ts);
    s.activity = null;
  } else {
    if (s.phase !== 'idle' && s.phase !== 'ended') enter(s, 'idle', ts);
    s.activity = 'quiet';
  }
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
    s.waiting = { id: first.id, kind: first.kind, tool: first.tool, detail: first.detail, questions: first.questions, risky: !!first.risky };
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

// Commands that deserve a second look. This is a highlighter, not a security
// boundary: it only decides what is kept out of batch approval and standing
// rules, so that those shortcuts are never the way something drastic gets in.
const RISKY = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, /\bsudo\b/, /--force\b|\s-f\b.*\bpush\b|\bpush\b.*\s-f\b/, /\|\s*(ba|z|k)?sh\b/,
  /\bmkfs\b|\bdd\s+if=/, /\bdrop\s+(table|database|schema)\b/i, /\btruncate\s+table\b/i, /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/,
  /\bchmod\s+-R\b|\bchown\s+-R\b/, />\s*\/dev\/(sd|nvme|disk)/, /\b(shutdown|reboot)\b/, /\bkubectl\s+delete\b|\bterraform\s+(destroy|apply)\b/,
  /\bcurl\b.*\|\s*\w*sh\b|\bwget\b.*\|\s*\w*sh\b/, /\bgh\s+pr\s+merge\b|\bnpm\s+publish\b/,
];
export const isRisky = (detail) => typeof detail === 'string' && RISKY.some((re) => re.test(detail));

// Commands that are evidence about the work: did it run the tests, did they pass.
const CHECKS = [
  ['test', /\b(pytest|jest|vitest|mocha|rspec|phpunit|playwright|cypress|go test|cargo test|dotnet test|ctest|(npm|pnpm|yarn|bun)( run)? test\w*|make (test|check)|tox|unittest)\b/],
  ['types', /\b(tsc|mypy|pyright|typecheck|type-check|cargo check)\b/],
  ['lint', /\b(eslint|ruff|flake8|pylint|rubocop|clippy|biome|golangci-lint|(npm|pnpm|yarn|bun)( run)? lint\w*|prettier --check)\b/],
  ['build', /\b((npm|pnpm|yarn|bun)( run)? build\w*|cargo build|go build|make( all)?$|gradle build|mvn (package|verify)|vite build|next build)\b/],
];
export const checkKind = (command) => (typeof command === 'string' ? (CHECKS.find(([, re]) => re.test(command)) || [null])[0] : null);

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
  const s = prev ? { ...prev, requests: prev.requests.map((r) => ({ ...r })), queued: [...prev.queued], auto_allow: [...prev.auto_allow], files: [...prev.files], checks: [...prev.checks], viewed: { ...prev.viewed } } : blank(ev);
  const d = ev.data || {};
  const ts = ev.ts;
  s.last_event_ts = ts;
  if (ev.cwd && !s.cwd) s.cwd = ev.cwd;
  if (ev.transcript) s.transcript = ev.transcript;
  if (ev.host && s.host === 'local') s.host = ev.host;
  if (ev.cloud_id && !s.cloud_id) {
    s.cloud_id = ev.cloud_id;
    s.url = `https://claude.ai/code/session_${ev.cloud_id}`;
    s.host = 'claude-cloud';
    s.runtime = 'cloud';
  }
  if (ev.runtime) s.runtime = ev.runtime;
  // Any sign of life un-archives a session, except the human's own actions.
  if (!ev.type.startsWith('human.') && !['session.ended', 'session.lost', 'session.imported', 'session.settled', 'meta.updated', 'usage.updated', 'pr.updated', 'rule.added', 'rule.removed', 'request.resolved', 'reply.sent', 'task.assigned', 'triage.noted', 'cloud.snapshot', 'cloud.branch', 'cloud.branch.gone', 'files.attributed', 'context.compacted'].includes(ev.type)) s.archived = false;

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
      // "Sent" is not "received": a reply from the board counts as delivered
      // only when the agent's own hook reports that very prompt.
      if (s.outgoing && clip(d.prompt, 600) === s.outgoing.text) s.outgoing = null;
      s.turns += 1;
      s.last_prompt = clip(d.prompt, 600);
      if (!s.title && d.prompt) s.title = clip(String(d.prompt).split('\n')[0], 120);
      if (!s.first_prompt && d.prompt) s.first_prompt = clip(d.prompt, 600);
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
        s.last_edit_ts = ts;
      }
      working();
      break;

    case 'tool.finished':
      // Only the tool a request was about resolves it; parallel tool calls
      // (e.g. from subagents) leave other requests open.
      resolve(s, { tool: d.tool });
      // Keep the last few runs of anything that checks the work.
      if (d.ok !== undefined) {
        const cmd = typeof d.input?.command === 'string' ? d.input.command : Array.isArray(d.input?.command) ? d.input.command.join(' ') : null;
        const kind = checkKind(cmd);
        if (kind) s.checks = [...s.checks.filter((c) => c.kind !== kind || c.cmd !== clip(cmd, 160)), { kind, cmd: clip(cmd, 160), ok: !!d.ok, ts }].slice(-6);
      }
      working();
      break;

    case 'files.attributed':
      // Files that changed while one of this session's shell commands ran.
      for (const f of d.files || []) if (!s.files.includes(f) && s.files.length < MAX_FILES) s.files.push(f);
      break;

    case 'context.compacted':
      s.compactions += 1;
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
      s.stop_requested = false;
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
      else if (['review', 'failed', 'unknown'].includes(s.phase)) {
        s.acked = { phase: s.phase, since: s.phase_since, error: s.error };
        s.reviewed_tip = s.tip || null;
        enter(s, s.exited ? 'ended' : 'idle', ts);
      }
      break;

    case 'human.unacknowledged': // undo
      if (s.acked && (s.phase === 'idle' || s.phase === 'ended')) {
        s.phase = s.acked.phase;
        s.phase_since = s.acked.since;
        s.error = s.acked.error;
        s.acked = null;
      }
      break;

    case 'human.archived':
      s.archived = true;
      break;

    case 'human.unarchived':
      s.archived = false;
      break;

    case 'human.seen':
      s.seen_ts = ts;
      break;

    case 'human.unseen':
      s.seen_ts = 0;
      break;

    case 'human.snoozed':
      s.snoozed_until = Number(d.until) || null;
      break;

    case 'human.unsnoozed':
      s.snoozed_until = null;
      break;

    case 'task.assigned':
      s.task_manual = d.task || null;
      s.task_reason = d.reason || null;
      break;

    case 'cloud.branch': {
      // Seen through git: a claude/ branch whose commits name this session.
      s.runtime = 'cloud';
      if (d.url) s.url = d.url;
      if (d.repo && !s.repo) s.repo = d.repo;
      if (d.repo_id && !s.repo_id) s.repo_id = d.repo_id;
      if (d.github) s.github = d.github;
      if (d.branch) s.branch = d.branch;
      s.tip = d.tip || s.tip;
      s.last_commit_ts = d.ts || s.last_commit_ts;
      s.commits = Array.isArray(d.commits) ? d.commits.slice(0, 15) : s.commits;
      s.ahead = d.ahead ?? null;
      s.behind = d.behind ?? null;
      s.base_branch = d.base || s.base_branch;
      s.base_conflicts = d.conflicts ?? null;
      s.git_recent = !!d.recent;
      // The branch is the record of what it changed: better than anything else we have for a cloud session.
      if (Array.isArray(d.files) && !s.cwd) s.files = d.files.slice(0, MAX_FILES);
      if (!s.title_manual && !s.listed && !s.hooked && d.subject && !s.pr?.title) s.title = clip(d.subject, 120);
      if (s.hooked || s.listed) break; // better sources decide its state
      s.last_message = clip(d.subject, 1200);
      gitState(s, ts);
      break;
    }

    case 'cloud.branch.gone':
      // Its branch is no longer on the remote: merged and deleted, or dropped.
      s.git_recent = false;
      if (s.hooked || s.listed) break;
      s.requests = s.requests.filter((r) => r.kind !== 'pr');
      if (s.pr?.state === 'merged') { enter(s, 'idle', ts); s.settled = 'merged'; } else enter(s, 'ended', ts);
      s.activity = 'gone';
      break;

    case 'cloud.snapshot': {
      // One row of the vendor's own session list. Coarser than hooks: it says
      // which bucket the session is in, not what it is waiting for.
      if (d.title && !s.title_manual) s.title = clip(d.title, 120);
      s.runtime = 'cloud';
      s.listed = true;
      if (d.url) s.url = d.url;
      if (d.summary) s.last_message = clip(d.summary, 1200);
      s.activity = d.activity ? clip(d.activity, 200) : null;
      if (s.hooked) break; // its own hooks know better
      if (d.bucket === 'working') enter(s, 'working', ts);
      else if (d.bucket === 'blocked') {
        enter(s, 'working', ts);
        if (!s.requests.length) s.requests.push({ id: null, kind: 'question', tool: null, detail: d.activity || null, ts, questions: null, risky: false });
      } else if (d.bucket === 'failed') {
        s.requests = [];
        enter(s, 'failed', ts);
        s.error = 'failed in the cloud';
      } else if (d.bucket === 'review' || (d.bucket === 'completed' && d.unread)) {
        s.requests = [];
        if (s.phase !== 'review') enter(s, 'review', ts);
      } else if (d.bucket === 'completed') {
        s.requests = [];
        // Finished and already read in the vendor's UI: nothing left for you here.
        if (s.phase !== 'idle') enter(s, 'idle', ts);
        s.seen_ts = ts;
      }
      if (d.bucket !== 'blocked') s.requests = s.requests.filter((r) => r.kind === 'pr');
      break;
    }

    case 'triage.noted':
      // Advice about one specific open item; it is ignored once that item is gone.
      s.triage = { for: d.for, summary: clip(d.summary, 240), suggestion: d.suggestion || 'none', ts };
      break;

    case 'reply.queued':
      if (s.queued.length < 10) s.queued.push({ text: clip(d.text, 2000), ts });
      break;

    case 'reply.delivered':
      s.queued = [];
      s.outgoing = null;
      break;

    case 'human.stop_requested':
      s.stop_requested = true;
      break;

    case 'human.stopped':
      // The agent has been told to stop. The human did it, so it is not news to them.
      s.stop_requested = false;
      s.requests = [];
      s.queued = [];
      enter(s, 'idle', ts);
      break;

    case 'reply.sent':
      s.outgoing = { text: clip(d.text, 600), via: d.via, ts };
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
      if (d.baseline && !s.baseline) s.baseline = d.baseline;
      if (d.github) s.github = d.github;
      if (d.repo_id) s.repo_id = d.repo_id;
      if (d.title && !s.title_manual) s.title = clip(d.title, 120);
      break;

    case 'human.renamed':
      if (typeof d.title === 'string' && d.title.trim()) {
        s.title = clip(d.title.trim(), 120);
        s.title_manual = true;
      }
      break;

    case 'human.viewed':
      // hash null = "not reviewed after all"
      if (d.hash) s.viewed[d.path] = d.hash;
      else delete s.viewed[d.path];
      break;

    case 'pr.updated': {
      s.pr = d.pr || null;
      if (s.runtime === 'cloud' && s.tip && !s.hooked && !s.listed) {
        if (s.pr?.title && !s.title_manual) s.title = clip(s.pr.title, 120);
        gitState(s, ts);
      }
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
  const passive = ['session.ended', 'session.lost', 'session.imported', 'session.settled', 'meta.updated', 'usage.updated', 'pr.updated', 'rule.added', 'rule.removed', 'request.resolved', 'reply.sent', 'task.assigned', 'triage.noted', 'context.compacted', 'files.attributed', 'cloud.snapshot', 'cloud.branch', 'cloud.branch.gone', 'reply.queued', 'reply.delivered'];
  if (!passive.includes(ev.type) && !ev.type.startsWith('human.')) {
    s.last_work_ts = ts;
    if (ev.type !== 'heartbeat' && ev.type !== 'notification') s.hooked = true;
    s.exited = false;
    s.imported = false;
  }
  if (s.phase !== 'failed') s.rate_limited = false;
  derive(s);
  // Snoozing covers what was on the table when the human snoozed. Anything
  // new (a request, a failure, a fresh result) brings the session back early.
  if (prev && ev.type !== 'human.snoozed' && (s.state !== prev.state || s.since !== prev.since)) s.snoozed_until = null;
  if (s.phase !== 'idle' && s.phase !== 'ended') s.acked = null;
  return s;
}

// Attention ordering. Deliberately simple and explainable: a fixed tier per
// kind of request, then longest-waiting first. (Olsen & Goodrich: a poor
// attention ranking can be worse than plain round-robin.)
export function attentionTier(s, now = 0) {
  if (s.archived) return null;
  if (s.snoozed_until && now < s.snoozed_until) return null;
  // Blocked agents first (a permission is the cheapest to clear), then broken
  // ones, then pull requests that need attention, then finished work.
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? 0 : s.waiting?.kind === 'pr' ? 3 : 1;
  if (s.state === 'failed' || s.state === 'unknown') return 2;
  if (s.state === 'review') return 4;
  return null;
}

export function attentionQueue(sessions, now = 0) {
  return sessions
    .filter((s) => attentionTier(s, now) !== null)
    .sort((a, b) => attentionTier(a, now) - attentionTier(b, now) || a.since - b.since);
}
