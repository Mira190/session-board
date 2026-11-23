// The hub: receives hook events, keeps the projection, serves the board, and
// carries the human's decisions back to the agents.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { fromHook } from './adapters/hooks.js';
import { attentionQueue, prAlertKey, isRisky } from './reduce.js';
import { liveAgents, orphanReason } from './reconcile.js';
import { scanHistory, usageFor } from './transcripts.js';
import { createGitHub } from './github.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY = 2 * 1024 * 1024;
const MAX_DIFF = 200 * 1024;
// A "working" session that has been silent this long is flagged, not hidden:
// we cannot tell a long build from a dead process, so we say what we know.
export const QUIET_MS = 10 * 60 * 1000;
// Do not judge a session orphaned until it has been silent this long.
export const SETTLE_MS = 2 * 60 * 1000;
// How long a permission request is held open for an answer from the board
// before it is handed back to the agent's own prompt.
export const HOLD_MS = 9 * 60 * 1000;
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// Answering a question tool = allowing it with the answers filled in.
const answerBody = (input, answers) => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: { behavior: 'allow', updatedInput: { ...input, answers } },
  },
});
// Pull requests are re-read at most this often per session, except right after
// a turn ends (the agent may just have pushed, opened or merged one).
export const PR_POLL_MS = 2 * 60 * 1000;
// ...and only while the session has seen activity this recently.
const PR_WATCH_MS = 14 * 24 * 60 * 60 * 1000;
// How long finished sessions stay on the board before the hub files them away.
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
// A reply not confirmed by the agent within this long is shown as undelivered.
export const UNDELIVERED_MS = 20_000;
const ROW_TEXT = 200; // characters of prompt / reply text carried on a board row

const decisionBody = (behavior, message) => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: behavior === 'allow' ? { behavior } : { behavior, message: message || 'Denied from session-board' },
  },
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Resolves with stdout, or null on failure. `okCodes` lists non-zero exit
// codes that still mean success (git diff --no-index exits 1 on a difference).
// With a hundred sessions the hub would otherwise start a git process per
// event; a small pool keeps it from starving the agents it is watching.
const MAX_PROCS = 4;
let procs = 0;
const waiting = [];
const slot = () => (procs < MAX_PROCS ? (procs += 1, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const free = () => { const next = waiting.shift(); if (next) next(); else procs -= 1; };
const run = async (cmd, args, { okCodes = [], ...opts } = {}) => {
  await slot();
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 16 << 20, ...opts }, (err, out) => {
      free();
      resolve(err && !okCodes.includes(err.code) ? null : out);
    });
  });
};
const git = async (cwd, args) => (await run('git', ['-C', cwd, ...args]))?.trim() || null;

export function createHub({
  dbPath = ':memory:',
  token = null,
  now = () => Date.now(),
  localHost = null, // the host label this machine's hooks report as
  allowedHosts = [], // extra Host names the UI may be reached under
  holdMs = HOLD_MS,
  agents = liveAgents, // injectable for tests
  history = scanHistory,
  github = createGitHub(),
  launch = (cmd, args, cwd) => spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' }).unref(),
} = {}) {
  const store = new Store(dbPath);
  const clients = new Set();
  const held = new Map(); // request id -> { res, key, tool, timer }
  const hostNames = new Set([...LOCAL_NAMES, ...allowedHosts]);

  const isLocal = (s) => s.runtime !== 'cloud' && !!localHost && s.host === localHost;
  // How a message typed in the board can reach this session, if at all.
  // Keys typed into a terminal go to whatever it is showing. While the agent
  // is asking for permission or putting a question, "text + Enter" would be
  // taken as the answer to that prompt, so typing is refused until it clears.
  const promptOpen = (s) => s.requests.some((r) => r.kind === 'permission' || r.kind === 'question');
  const replyRoute = (s) => {
    if (!isLocal(s)) return null;
    if (s.tmux?.pane) return promptOpen(s) ? null : 'tmux';
    if (s.exited || s.imported) return 'headless';
    return null;
  };

  // How an open request can still be answered: 'live' (its hook is waiting on
  // us), 'message' (only by sending the session a message), or 'terminal'
  // (only in the agent's own UI).
  const capability = (s, r) => (r.id && held.has(r.id) ? 'live' : r.kind === 'pr' && replyRoute(s) ? 'message' : 'terminal');
  const ATTENTION = new Set(['needs_input', 'review', 'failed', 'unknown']);
  const full = (s) => ({
    ...s,
    requests: s.requests.map((r) => ({ ...r, decidable: !!r.id && held.has(r.id), capability: capability(s, r) })),
    waiting: s.waiting && { ...s.waiting, decidable: !!s.waiting.id && held.has(s.waiting.id), capability: capability(s, s.waiting) },
    quiet: s.state === 'working' && now() - s.last_event_ts > QUIET_MS,
    local: isLocal(s),
    reply: replyRoute(s),
    reply_blocked: isLocal(s) && !!s.tmux?.pane && promptOpen(s),
    // Something the human has not looked at since it came up.
    unseen: ATTENTION.has(s.state) && s.since > s.seen_ts,
    snoozed: !!s.snoozed_until && now() < s.snoozed_until,
    // A reply that the agent has not confirmed receiving.
    undelivered: !!s.outgoing && now() - s.outgoing.ts > UNDELIVERED_MS,
  });
  // The board row: everything a card, the queue and the office need, and
  // nothing else. Long text and file lists come with the detail request for
  // the one session that is open. test/more.test.js holds this to a budget.
  const short = (t) => (typeof t === 'string' && t.length > ROW_TEXT ? `${t.slice(0, ROW_TEXT - 1)}…` : t);
  const view = (s) => {
    const { files, transcript, auto_allow, acked, start_head, pr_alert, ...row } = full(s);
    return { ...row, last_prompt: short(row.last_prompt), last_message: short(row.last_message), files_count: files.length };
  };
  let rules = store.rules(); // global: [{ tool, detail }]
  const snapshot = () => {
    const sessions = store.list().filter((s) => !s.archived).map(view);
    return { now: now(), sessions, queue: attentionQueue(sessions, now()).map((s) => s.key), rules: rules.length };
  };

  // Live updates are deltas: a client gets the full picture once, then only
  // the sessions that changed since the last tick. With hundreds of sessions
  // the full snapshot is hundreds of KB, and something changes many times a
  // second.
  let pending = null;
  const dirty = new Set();
  const sent = new Map(); // key -> last JSON sent, to drop no-op updates
  const TICK_MS = 120;
  const broadcast = (s) => {
    if (s?.key) dirty.add(s.key);
    else for (const x of store.list()) dirty.add(x.key); // unknown scope: recheck all
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const changed = [];
      const removed = [];
      for (const key of dirty) {
        const x = store.get(key);
        if (!x || x.archived) {
          sent.delete(key);
          removed.push(key);
          continue;
        }
        const v = view(x);
        const json = JSON.stringify(v);
        if (sent.get(key) === json) continue;
        sent.set(key, json);
        changed.push(v);
      }
      dirty.clear();
      if (!clients.size || (!changed.length && !removed.length)) return;
      const live = store.list().filter((x) => !x.archived).map(view);
      const msg = `data: ${JSON.stringify({ now: now(), changed, removed, queue: attentionQueue(live, now()).map((x) => x.key), rules: rules.length })}\n\n`;
      for (const res of clients) res.write(msg);
    }, TICK_MS);
  };
  store.onChange(broadcast);
  // A request answered somewhere else (in the terminal, or swept away by the
  // turn ending) must not stay answerable here.
  store.onChange((s) => {
    for (const [id, h] of [...held]) {
      if (h.key === s.key && !s.requests.some((r) => r.id === id)) release(id);
    }
  });
  // Re-send periodically so "quiet" flags and timers stay honest without events.
  const tick = setInterval(() => clients.size && broadcast(), 30_000); // rechecks "quiet" flags
  tick.unref();

  const emit = (s, type, data = {}) =>
    store.append({ ts: now(), agent: s.agent, session_id: s.session_id, type, data });

  // --- enrichment -----------------------------------------------------------
  // Repo/branch are looked up from the session's cwd when it exists on this
  // machine. Remote hosts can send them explicitly with a meta.updated event.
  const looked = new Map();
  async function refreshGitMeta(s) {
    if (!s.cwd || !existsSync(s.cwd)) return;
    if (now() - (looked.get(s.key) || 0) < 15_000) return;
    looked.set(s.key, now());
    const [top, branch, head] = await Promise.all([
      git(s.cwd, ['rev-parse', '--show-toplevel']),
      git(s.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      s.start_head ? null : git(s.cwd, ['rev-parse', 'HEAD']),
    ]);
    const repo = top ? basename(top) : basename(s.cwd);
    if (repo !== s.repo || branch !== s.branch || (head && !s.start_head)) {
      emit(s, 'meta.updated', { repo, branch, ...(head ? { head } : {}) });
    }
  }

  // Usage and cost come from the agent's own session file, read at turn ends.
  const USAGE_AT = new Set(['turn.completed', 'turn.failed', 'session.ended']);
  async function refreshUsage(s) {
    if (!s.transcript || !existsSync(s.transcript)) return;
    const usage = await usageFor(s.agent, s.transcript);
    if (usage && JSON.stringify({ ...s.usage, ...usage }) !== JSON.stringify(s.usage)) {
      emit(s, 'usage.updated', usage);
    }
  }

  // Pull request for the session's branch. The agent can open, push to or
  // merge a PR with a shell command and nothing tells us, and a human can merge
  // on github.com, so this is read at turn ends and then polled.
  const prAsked = new Map();
  async function refreshPr(s, { force = false } = {}) {
    if (!s.branch || (!isLocal(s) && !s.github)) return false;
    if (isLocal(s) && (!s.cwd || !existsSync(s.cwd))) return false;
    if (!force && now() - (prAsked.get(s.key) || 0) < PR_POLL_MS) return false;
    prAsked.set(s.key, now());
    const [owner, repo] = (s.github || '').split('/');
    const found = await github.findPr({
      cwd: isLocal(s) ? s.cwd : null,
      slug: owner && repo ? { owner, repo } : null,
      branch: s.branch,
    });
    if (found === undefined) return false; // could not ask: keep what we knew
    const { updated, ...pr } = found || {};
    const next = found ? pr : null;
    const changed = JSON.stringify(next) !== JSON.stringify(s.pr);
    // A problem noticed while the agent was mid-turn was held back; if it is
    // still there now that the turn is over, say so.
    const overdue = force && prAlertKey(next) && prAlertKey(next) !== s.pr_alert;
    if (!changed && !overdue) return false;
    emit(s, 'pr.updated', { pr: next });
    return changed;
  }

  function ingest(events) {
    let last = null;
    for (const ev of events) {
      last = store.append(ev) || last;
      if (last && USAGE_AT.has(ev.type)) {
        refreshUsage(last).catch(() => {});
        const s = last;
        // After the branch lookup that the same event triggers.
        refreshGitMeta(s).catch(() => {}).then(() => refreshPr(store.get(s.key), { force: true })).catch(() => {});
      }
    }
    if (last) refreshGitMeta(last).catch(() => {});
    return last;
  }

  // --- permission round-trip --------------------------------------------------
  // A PermissionRequest hook is a request/response: whatever we answer is the
  // decision. We answer at once when a rule covers it or nobody has the board
  // open (the agent then shows its own prompt), and otherwise hold the request
  // until the human decides here.
  function release(id, body = {}) {
    const h = held.get(id);
    if (!h) return false;
    held.delete(id);
    clearTimeout(h.timer);
    if (!h.res.writableEnded) json(h.res, 200, body);
    broadcast({ key: h.key });
    return true;
  }
  function decide(id, decision, { message, remember, answers } = {}) {
    const h = held.get(id);
    if (!h) return false;
    const s = store.get(h.key);
    if (decision === 'terminal') return release(id); // let the agent ask in its own UI
    if (decision === 'answer') {
      // { question text: chosen label | free text | [labels] }
      const clean = {};
      for (const [q, a] of Object.entries(answers || {})) {
        const text = Array.isArray(a) ? a.join(', ') : String(a ?? '');
        if (text.trim()) clean[q] = text.trim();
      }
      if (!Object.keys(clean).length) return false;
      release(id, answerBody(h.input, clean));
      emit(s, 'request.resolved', { id, decision: 'answer', by: 'human' });
      return true;
    }
    if (remember && decision === 'allow' && h.tool) emit(s, 'rule.added', { tool: h.tool });
    release(id, decisionBody(decision, message));
    emit(s, 'request.resolved', { id, decision, by: 'human' });
    return true;
  }
  function holdPermission(req, res, event, input) {
    const id = randomUUID().slice(0, 8);
    event.data.request_id = id;
    const s = ingest([event]);
    if (!s) return json(res, 200, {});
    const asked = s.requests.find((r) => r.id === id);
    const standing = asked && !asked.risky &&
      rules.some((r) => r.tool === asked.tool && r.detail === asked.detail);
    if ((event.data.tool && s.auto_allow.includes(event.data.tool)) || standing) {
      emit(s, 'request.resolved', { id, decision: 'allow', by: standing ? 'standing rule' : 'rule' });
      return json(res, 200, decisionBody('allow'));
    }
    // Claude Code keeps showing its own prompt while the hook is pending and
    // takes whichever answer comes first (verified, v2.1.330), so holding costs
    // the terminal nothing. That is not verified for other agents: for them we
    // only hold while someone actually has the board open.
    const parallel = event.agent === 'claude';
    if (!parallel && !clients.size) return json(res, 200, {});
    const timer = setTimeout(() => release(id), holdMs);
    timer.unref();
    held.set(id, { res, key: s.key, tool: event.data.tool || null, input: input || {}, timer, parallel });
    // The agent gave up on the hook (answered in its own UI, interrupted, died).
    res.on('close', () => held.delete(id) && (clearTimeout(timer), broadcast({ key: s.key })));
    broadcast({ key: s.key });
  }
  // Nobody is watching the board any more: hand open requests back.
  let orphanTimer = null;
  function clientsChanged() {
    clearTimeout(orphanTimer);
    if (clients.size || !held.size) return;
    orphanTimer = setTimeout(() => {
      if (!clients.size) for (const [id, h] of [...held]) if (!h.parallel) release(id);
    }, 5000);
    orphanTimer.unref();
  }

  // --- talking back -------------------------------------------------------
  // A double click or a client retry must not type the message twice.
  const commands = new Map(); // command id -> result
  async function sendMessage(s, text, commandId) {
    if (commandId && commands.has(commandId)) return commands.get(commandId);
    const done = (result) => {
      if (commandId) {
        commands.set(commandId, result);
        if (commands.size > 500) commands.delete(commands.keys().next().value);
      }
      // Recorded as sent; it becomes "delivered" only when the agent's own
      // hook reports this prompt.
      emit(s, 'reply.sent', { text, via: result.via });
      return result;
    };
    const route = replyRoute(s);
    if (route === 'tmux') {
      const t = ['-S', s.tmux.socket];
      const alive = await run('tmux', [...t, 'display-message', '-p', '-t', s.tmux.pane, '#{pane_id}']);
      if (alive == null) throw Object.assign(new Error('the tmux pane this session ran in is gone'), { status: 409 });
      // -l sends the text literally; Enter is a separate key so it is not typed.
      if ((await run('tmux', [...t, 'send-keys', '-t', s.tmux.pane, '-l', '--', text])) == null ||
          (await run('tmux', [...t, 'send-keys', '-t', s.tmux.pane, 'Enter'])) == null) {
        throw Object.assign(new Error('tmux refused the keys'), { status: 502 });
      }
      return done({ via: 'tmux' });
    }
    if (route === 'headless') {
      if (!s.cwd || !existsSync(s.cwd)) throw Object.assign(new Error('the session directory no longer exists'), { status: 409 });
      // The agent process is gone, so continue the same session without a
      // terminal. Its hooks report back here like any other turn.
      const [cmd, args] = s.agent === 'claude'
        ? ['claude', ['-p', text, '--resume', s.session_id]]
        : ['codex', ['exec', 'resume', s.session_id, text]];
      launch(cmd, args, s.cwd);
      return done({ via: 'headless' });
    }
    throw Object.assign(
      new Error(isLocal(s) && s.tmux?.pane
        ? 'the terminal is showing a prompt; typing now would answer it. Deal with the open request first'
        : 'this session is open in a terminal the board cannot type into (not tmux, not on this machine)'),
      { status: 409 },
    );
  }

  // scope 'session' narrows everything to the files this session's edit
  // tools touched. Changes it made through shell commands are not attributed,
  // so the whole-tree view stays one click away.
  async function workingTree(s, scope = 'all') {
    if (!isLocal(s) || !s.cwd || !existsSync(s.cwd)) return { available: false };
    const own = scope === 'session' && s.files.length ? ['--', ...s.files] : [];
    const [status, stat, tracked] = await Promise.all([
      git(s.cwd, ['status', '--porcelain', '-uall', ...own]),
      git(s.cwd, ['diff', 'HEAD', '--stat', ...own]),
      run('git', ['-C', s.cwd, 'diff', 'HEAD', ...own]),
    ]);
    if (status == null && tracked == null) return { available: false };
    // New files are not in `git diff HEAD`; show them as additions too.
    const fresh = (status || '').split('\n').filter((l) => l.startsWith('?? ')).map((l) => l.slice(3)).slice(0, 30);
    const added = await Promise.all(
      fresh.map((f) => run('git', ['-C', s.cwd, 'diff', '--no-index', '--', '/dev/null', f], { okCodes: [1] })),
    );
    const diff = [tracked, ...added].filter(Boolean).join('\n');
    return {
      available: true,
      scope: own.length ? 'session' : 'all',
      attributed: s.files.length,
      status: status || '',
      stat: stat || '',
      diff: diff.slice(0, MAX_DIFF),
      truncated: diff.length > MAX_DIFF,
    };
  }

  // --- upkeep -----------------------------------------------------------------
  // Reconciliation: a session we show as active, on this machine, silent for a
  // while, with no agent process behind it, is marked unknown instead of
  // being left "working" forever. Runs at startup and then every minute.
  async function reconcile() {
    const suspects = store.list().filter(
      (s) => !s.archived && isLocal(s) && (s.state === 'working' || s.state === 'needs_input') &&
        now() - s.last_event_ts > SETTLE_MS,
    );
    if (!suspects.length) return 0;
    const procs = await agents();
    let lost = 0;
    for (const s of suspects) {
      const reason = orphanReason(s, procs);
      if (!reason) continue;
      emit(s, 'session.lost', { reason });
      lost += 1;
    }
    return lost;
  }
  // Settlement: outcomes the hub can establish from recorded facts are closed
  // without waiting for a click, whether or not anyone has the board open.
  //  - merged:   a reviewed-pending branch whose commits are now in the default
  //              branch has been accepted by whoever merged it.
  //  - inactive: a finished session nobody has touched for a week is archived.
  // Squash and rebase merges rewrite commits, so git alone cannot see them: for
  // those the pull request's own state is the evidence. A PR counts only when
  // what was merged is exactly what this session left on its branch (same head
  // commit), so an old merged PR from a reused branch name settles nothing.
  async function mergedInto(cwd, branch) {
    const base = (await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) ||
      (await git(cwd, ['rev-parse', '--verify', '--quiet', '--abbrev-ref', 'main'])) ||
      (await git(cwd, ['rev-parse', '--verify', '--quiet', '--abbrev-ref', 'master']));
    if (!base || base === branch || base.endsWith(`/${branch}`)) return null;
    const tip = await git(cwd, ['rev-parse', '--verify', '--quiet', branch]);
    if (!tip) return null;
    const merged = await run('git', ['-C', cwd, 'merge-base', '--is-ancestor', tip, base]);
    return merged == null ? null : { tip, base };
  }
  async function pollPrs() {
    let changed = 0;
    for (const s of store.list()) {
      if (s.archived || now() - s.last_event_ts > PR_WATCH_MS) continue;
      // Worth asking while something can still change: work awaiting review,
      // or a PR we know to be open.
      if (s.state !== 'review' && s.pr?.state !== 'open') continue;
      if (await refreshPr(s).catch(() => false)) changed += 1;
    }
    return changed;
  }
  async function settle() {
    await pollPrs();
    let settled = 0;
    for (const s of store.list()) {
      if (s.archived) continue;
      if (s.state === 'ended' && now() - s.last_event_ts > STALE_MS) {
        emit(s, 'session.settled', { reason: 'inactive' });
        settled += 1;
      } else if (s.state === 'review' && isLocal(s) && s.cwd && s.branch && s.start_head && existsSync(s.cwd)) {
        const tip = await git(s.cwd, ['rev-parse', '--verify', '--quiet', s.branch]);
        // The branch must have moved since we first saw it: a branch with no
        // new commits is trivially "in" the default branch.
        if (!tip || tip === s.start_head) continue;
        const m = await mergedInto(s.cwd, s.branch);
        if (m) {
          emit(s, 'session.settled', { reason: 'merged', into: m.base, by: 'git' });
          settled += 1;
        } else if (s.pr?.state === 'merged' && s.pr.head_sha === tip) {
          emit(s, 'session.settled', { reason: 'merged', into: s.pr.base, by: 'pull request', pr: s.pr.number });
          settled += 1;
        }
      }
    }
    return settled;
  }

  const reconciler = setInterval(() => {
    reconcile().catch(() => {});
    settle().catch(() => {});
  }, 60_000);
  reconciler.unref();

  // Backfill: sessions found in the agents' history files that the hub has
  // never seen (they predate the hooks). Imported as history, never as live.
  async function backfill({ days = 7 } = {}) {
    const found = await history({ days, now: now() });
    let imported = 0;
    for (const f of found) {
      const id = { agent: f.agent, session_id: String(f.summary.session_id) };
      if (store.get(`${id.agent}:${id.session_id}`)) continue;
      const { session_id, cwd, ...data } = f.summary;
      store.append({ ...id, ts: f.mtime, host: localHost, cwd, transcript: f.path, type: 'session.imported', data });
      if (f.usage) store.append({ ...id, ts: f.mtime, type: 'usage.updated', data: f.usage });
      imported += 1;
    }
    return { scanned: found.length, imported };
  }

  // --- http -----------------------------------------------------------------
  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  // The board can approve commands, so a web page in the same browser must not
  // be able to drive it. Without a token we only answer requests addressed to
  // a local name (stops DNS rebinding) and refuse cross-origin ones (stops
  // CSRF). With a token, the token is the gate.
  function guard(req, url) {
    if (token) {
      const header = req.headers.authorization || '';
      return header === `Bearer ${token}` || url.searchParams.get('token') === token ? null : 401;
    }
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!hostNames.has(host)) return 403;
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return 403;
      } catch {
        return 403;
      }
    }
    return null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const body = async () => JSON.parse((await readBody(req)) || '{}');

    if (path.startsWith('/ingest/') || path.startsWith('/api/')) {
      const denied = guard(req, url);
      if (denied) return json(res, denied, { error: denied === 401 ? 'unauthorized' : 'forbidden' });
    }

    // --- ingest ---------------------------------------------------------
    const hook = path.match(/^\/ingest\/(claude|codex)$/);
    if (hook && req.method === 'POST') {
      // A hook must never fail because of us: anything unreadable gets the
      // empty "no opinion" answer.
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return json(res, 200, {});
      }
      const q = url.searchParams;
      const tmux = q.get('tmux_pane') && q.get('tmux_socket')
        ? { socket: q.get('tmux_socket'), pane: q.get('tmux_pane') }
        : null;
      const events = fromHook(hook[1], payload, {
        host: q.get('host'),
        runtime: q.get('runtime'),
        now: now(),
        seq: q.has('seq') ? Number(q.get('seq')) : null,
        source: q.get('source'),
        tmux,
      });
      if (payload.hook_event_name === 'PermissionRequest' && events.length) {
        return holdPermission(req, res, events[0], payload.tool_input);
      }
      ingest(events);
      return json(res, 200, {});
    }
    if (path === '/ingest/event' && req.method === 'POST') {
      // Normalized events from anything else (cloud sessions, other agents).
      const sent = await body();
      const list = (Array.isArray(sent) ? sent : [sent]).filter(
        (e) => e && e.agent && e.session_id && typeof e.type === 'string',
      );
      ingest(list.map(({ id, ...e }) => ({ ...e, ...(id != null ? { eid: String(id) } : {}), ts: now(), session_id: String(e.session_id) })));
      return json(res, 200, { accepted: list.length });
    }

    // --- api ------------------------------------------------------------
    if (path === '/api/sessions' && req.method === 'GET') return json(res, 200, snapshot());
    if (path === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      clientsChanged();
      req.on('close', () => {
        clients.delete(res);
        clientsChanged();
      });
      return;
    }
    if (path === '/api/backfill' && req.method === 'POST') {
      const { days } = await body();
      return json(res, 200, await backfill({ days: Number(days) > 0 ? Number(days) : 7 }));
    }
    if (path === '/api/reconcile' && req.method === 'POST') {
      return json(res, 200, { lost: await reconcile(), settled: await settle() });
    }

    // Decide once, apply everywhere: the same request open in many sessions is
    // answered in one call, optionally becoming a standing rule.
    if (path === '/api/requests/batch' && req.method === 'POST') {
      const { ids, decision: d, remember } = await body();
      if (!Array.isArray(ids) || !['allow', 'deny'].includes(d)) return json(res, 400, { error: 'ids and decision (allow|deny) required' });
      let rule = null;
      if (remember && d === 'allow') {
        const h = held.get(ids.find((id) => held.has(id)));
        const r = h && store.get(h.key).requests.find((x) => held.get(x.id) === h);
        if (r?.tool && r.detail && !r.risky) {
          store.addRule(r.tool, r.detail, now());
          rules = store.rules();
          rule = { tool: r.tool, detail: r.detail };
        }
      }
      const done = ids.filter((id) => decide(id, d)).length;
      return json(res, 200, { decided: done, rule });
    }
    if (path === '/api/rules') {
      if (req.method === 'GET') return json(res, 200, rules);
      const { tool, detail } = await body();
      if (typeof tool !== 'string' || typeof detail !== 'string') return json(res, 400, { error: 'tool and detail required' });
      if (req.method === 'POST') {
        if (isRisky(detail)) return json(res, 400, { error: 'this looks drastic; it must be approved each time' });
        store.addRule(tool, detail, now());
      } else if (req.method === 'DELETE') store.removeRule(tool, detail);
      else return json(res, 405, { error: 'method not allowed' });
      rules = store.rules();
      broadcast();
      return json(res, 200, rules);
    }

    const decision = path.match(/^\/api\/requests\/([^/]+)$/);
    if (decision && req.method === 'POST') {
      const { decision: d, message, remember, answers } = await body();
      if (!['allow', 'deny', 'terminal', 'answer'].includes(d)) return json(res, 400, { error: 'decision must be allow, deny, answer or terminal' });
      return decide(decision[1], d, { message, remember, answers })
        ? json(res, 200, { ok: true })
        : json(res, 410, { error: 'this request is no longer waiting on the board' });
    }

    const act = path.match(/^\/api\/sessions\/([^/]+)\/(ack|unack|archive|unarchive|seen|unseen|snooze|unsnooze|events|message|diff|rule|detail)$/);
    if (act) {
      const key = decodeURIComponent(act[1]);
      const s = store.get(key);
      if (!s) return json(res, 404, { error: 'no such session' });
      const verb = act[2];
      if (req.method === 'GET') {
        if (verb === 'events') return json(res, 200, store.events(key));
        if (verb === 'detail') return json(res, 200, full(s));
        if (verb === 'diff') return json(res, 200, await workingTree(s, url.searchParams.get('scope') || 'all'));
      }
      if (req.method === 'POST') {
        if (verb === 'message') {
          const { text, command_id } = await body();
          if (typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'empty message' });
          return json(res, 200, await sendMessage(s, text.trim(), command_id));
        }
        if (verb === 'rule') {
          const { tool, allow } = await body();
          if (typeof tool !== 'string') return json(res, 400, { error: 'tool required' });
          emit(s, allow === false ? 'rule.removed' : 'rule.added', { tool });
          return json(res, 200, view(store.get(key)));
        }
        if (verb === 'snooze') {
          const { minutes, until } = await body();
          const at = Number(until) || now() + (Number(minutes) > 0 ? Number(minutes) : 60) * 60_000;
          emit(s, 'human.snoozed', { until: at });
          return json(res, 200, view(store.get(key)));
        }
        const filing = {
          ack: 'human.acknowledged', unack: 'human.unacknowledged', archive: 'human.archived', unarchive: 'human.unarchived',
          seen: 'human.seen', unseen: 'human.unseen', unsnooze: 'human.unsnoozed',
        }[verb];
        if (filing) {
          emit(s, filing);
          return json(res, 200, view(store.get(key)));
        }
      }
    }

    // --- static ---------------------------------------------------------
    if (req.method === 'GET') {
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      const file = join(PUBLIC, rel);
      if (file.startsWith(PUBLIC) && MIME[extname(file)]) {
        try {
          const data = await readFile(file);
          res.writeHead(200, { 'content-type': MIME[extname(file)], 'cache-control': 'no-cache' });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }
    json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, err.status || 400, { error: String(err.message || err) });
      else res.end();
    });
  });
  // Held permission requests legitimately stay open for minutes.
  server.requestTimeout = 0;

  return {
    store,
    server,
    snapshot,
    ingest,
    reconcile,
    settle,
    refreshPr: (key, opts) => refreshPr(store.get(key), opts),
    backfill,
    decide,
    listen: (port, host) => new Promise((ok) => server.listen(port, host, () => ok(server.address()))),
    close: () =>
      new Promise((ok) => {
        clearInterval(tick);
        clearInterval(reconciler);
        clearTimeout(pending);
        clearTimeout(orphanTimer);
        for (const id of [...held.keys()]) release(id);
        for (const res of clients) res.end();
        server.close(() => {
          store.close();
          ok();
        });
        server.closeAllConnections?.();
      }),
  };
}
