// The hub: receives hook events, keeps the projection, serves the board, and
// carries the human's decisions back to the agents.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { fromHook } from './adapters/hooks.js';
import { attentionQueue, prAlertKey } from './reduce.js';
import { liveAgents, orphanReason } from './reconcile.js';
import { scanHistory, usageFor } from './transcripts.js';
import { createGitHub } from './github.js';
import { ruleMatches, ruleProblem, stemOf } from './rules.js';
import { createNotifier } from './notify.js';
import { groupTasks } from './tasks.js';
import { lsRemote, readRemote, branchFiles, branchConflicts, branchDiff, remoteOf } from './cloudgit.js';
import { parseRemote } from './github.js';

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
// "cse_01ABC…" and "session_01ABC…" name the same cloud session.
export const cloudSuffix = (id) => {
  const m = /^(?:cse|session)_([A-Za-z0-9]{8,})$/.exec(String(id || '').trim());
  return m ? m[1] : null;
};
const BUCKET = { WORKING: 'working', BLOCKED: 'blocked', REVIEW_READY: 'review', COMPLETED: 'completed', FAILED: 'failed' };
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'login']);

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
  notifier = null, // injectable; built from the environment by default
  boardUrl = '',
  ignoreCwds = [], // sessions running here are not shown (the triage runner's own)
  codexApp = null, // { poll: async () => ({ threads, limits }) | null } reads Codex's own local server
  cloudGit = null, // { cacheRoot, dirs: () => [...] } turns on finding cloud sessions through git
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
    // A Claude cloud session takes messages through the CLI's own --cloud.
    // A cloud session that is mid-turn takes a message through its own hooks;
    // an idle one through the CLI's --cloud.
    if (s.runtime === 'cloud' && s.agent === 'claude' && hookRoute(s)) return 'hook';
    if (s.runtime === 'cloud' && s.agent === 'claude' && s.cloud_id) return 'cloud';
    if (!isLocal(s)) return null;
    // Codex has an official way to hand a message to an existing session
    // (`codex queue`), so it needs neither tmux nor a guess about the terminal.
    if (s.agent === 'codex' && !s.imported) return 'queue';
    if (s.tmux?.pane) return promptOpen(s) ? null : 'tmux';
    if (s.exited || s.imported) return 'headless';
    return hookRoute(s);
  };
  // No terminal to type into, but its hooks talk to us: a message can wait for
  // the end of its current turn and be handed over then.
  const hookRoute = (s) => (s.agent === 'claude' && s.hooked && !s.exited && (s.state === 'working' || s.state === 'needs_input') ? 'hook' : null);

  // How an open request can still be answered: 'live' (its hook is waiting on
  // us), 'message' (only by sending the session a message), or 'terminal'
  // (only in the agent's own UI).
  const capability = (s, r) => (r.id && held.has(r.id) ? 'live' : r.kind === 'pr' && replyRoute(s) ? 'message' : 'terminal');
  const ATTENTION = new Set(['needs_input', 'review', 'failed', 'unknown']);
  const full = (s) => ({
    ...s,
    requests: s.requests.map((r) => ({ ...r, decidable: !!r.id && held.has(r.id), capability: capability(s, r) })),
    waiting: s.waiting && {
      ...s.waiting, decidable: !!s.waiting.id && held.has(s.waiting.id), capability: capability(s, s.waiting),
      // The kind of command this is, when a rule for the whole kind is possible.
      stem: s.waiting.kind === 'permission' ? stemOf(s.waiting.detail) : null,
    },
    quiet: s.state === 'working' && now() - s.last_event_ts > QUIET_MS,
    local: isLocal(s),
    reply: replyRoute(s),
    reply_blocked: isLocal(s) && !!s.tmux?.pane && promptOpen(s),
    // Something the human has not looked at since it came up.
    unseen: ATTENTION.has(s.state) && s.since > s.seen_ts,
    snoozed: !!s.snoozed_until && now() < s.snoozed_until,
    // A reply that the agent has not confirmed receiving.
    undelivered: !!s.outgoing && s.outgoing.via !== 'hook' && now() - s.outgoing.ts > UNDELIVERED_MS,
    // Stopping works through hooks, so only for sessions that have them and are doing something.
    can_stop: s.agent === 'claude' && s.hooked && !s.exited && (s.state === 'working' || s.state === 'needs_input'),
    // Which task this belongs to, when it shares one with other sessions.
    task: tasks.get(s.key)?.size > 1 ? { id: tasks.get(s.key).id, size: tasks.get(s.key).size, why: tasks.get(s.key).why } : null,
    context_pct: contextPct.get(s.key) ?? null,
    overlap: overlaps.has(s.key) ? {
      files: overlaps.get(s.key).count, file: overlaps.get(s.key).file.split('/').pop(),
      with: [...overlaps.get(s.key).others.values()].slice(0, 2), sessions: overlaps.get(s.key).others.size,
    } : null,
    // A triage note counts only for the item it was written about.
    triage: s.triage && s.triage.for === itemId(s) ? s.triage : null,
  });
  // What a triage note is about: this state of this session, since this moment.
  const itemId = (s) => `${s.key}@${s.waiting?.kind || s.state}@${s.since}`;
  // The board row: everything a card, the queue and the office need, and
  // nothing else. Long text and file lists come with the detail request for
  // the one session that is open. test/more.test.js holds this to a budget.
  const short = (t) => (typeof t === 'string' && t.length > ROW_TEXT ? `${t.slice(0, ROW_TEXT - 1)}…` : t);
  const view = (s) => {
    const { files, transcript, auto_allow, acked, start_head, pr_alert, repo_id, viewed, baseline, first_prompt, commits, ...row } = full(s);
    return { ...row, last_prompt: short(row.last_prompt), last_message: short(row.last_message), files_count: files.length };
  };
  // Task membership depends on every session, so it is recomputed as a whole
  // and the sessions whose task changed are re-sent.
  // Two live sessions editing the same file in the same repository are heading
  // for a conflict; say so while it is still cheap to sort out.
  let overlaps = new Map(); // key -> { count, file, with: [titles] }
  function refreshOverlaps(live) {
    const byFile = new Map();
    for (const s of live) {
      if (s.state === 'ended' || !s.files.length) continue;
      const repo = s.repo_id || s.repo || s.cwd;
      for (const full of s.files) {
        // Local sessions record absolute paths, cloud ones paths in the repository.
        const f = s.cwd && full.startsWith(`${s.cwd}/`) ? full.slice(s.cwd.length + 1) : full;
        (byFile.get(`${repo}\n${f}`) || byFile.set(`${repo}\n${f}`, []).get(`${repo}\n${f}`)).push(s);
      }
    }
    const next = new Map();
    for (const [k, group] of byFile) {
      if (group.length < 2) continue;
      const file = k.split('\n')[1];
      for (const s of group) {
        const o = next.get(s.key) || next.set(s.key, { count: 0, file, others: new Map() }).get(s.key);
        o.count += 1;
        for (const other of group) if (other.key !== s.key) o.others.set(other.key, other.title || other.session_id);
      }
    }
    const changed = [];
    for (const key of new Set([...next.keys(), ...overlaps.keys()])) {
      const a = next.get(key);
      const b = overlaps.get(key);
      if ((a?.count || 0) !== (b?.count || 0) || (a?.others.size || 0) !== (b?.others.size || 0)) changed.push(key);
    }
    overlaps = next;
    return changed;
  }

  let tasks = new Map();
  function refreshTasks() {
    const next = groupTasks(store.list().filter((s) => !s.archived));
    const changed = [];
    for (const [key, t] of next) {
      const was = tasks.get(key);
      if ((was?.size > 1 ? was.id : null) !== (t.size > 1 ? t.id : null) || (was?.size || 1) !== t.size) changed.push(key);
    }
    tasks = next;
    return [...changed, ...refreshOverlaps(store.list().filter((s) => !s.archived))];
  }
  // Spend over the last five hours, from the agents' own running totals. This
  // is what was used, not what is left: the hub does not know anyone's limits.
  const BURN_MS = 5 * 60 * 60 * 1000;
  let burnCache = { at: 0, value: null };
  function burn() {
    if (now() - burnCache.at < 30_000) return burnCache.value;
    const first = new Map();
    const last = new Map();
    for (const row of store.db.prepare("SELECT key, body FROM events WHERE type = 'usage.updated' AND ts > ? ORDER BY id").iterate(now() - BURN_MS)) {
      const cost = JSON.parse(row.body).data?.cost_usd;
      if (cost == null) continue;
      if (!first.has(row.key)) first.set(row.key, cost);
      last.set(row.key, cost);
    }
    let usd = 0;
    for (const [key, cost] of last) {
      // A session that began inside the window spent its whole total in it.
      const began = store.get(key)?.created_ts > now() - BURN_MS;
      usd += began ? cost : Math.max(0, cost - first.get(key));
    }
    burnCache = { at: now(), value: last.size ? { usd: Math.round(usd * 100) / 100, sessions: last.size, hours: 5 } : null };
    return burnCache.value;
  }
  // Usage-limit windows, as the agent itself reports them to its status line
  // (Claude Code, subscribers only). One account, so one value for the fleet.
  let quota = null; // { five_hour: { used, resets_at }, seven_day: {...}, at }
  const contextPct = new Map(); // session key -> % of the context window in use
  function noteStatus(agent, p) {
    const key = p.session_id ? `${agent}:${p.session_id}` : null;
    const pct = p.context_window?.used_percentage;
    if (key && Number.isFinite(pct) && Math.round(pct) !== contextPct.get(key)) {
      contextPct.set(key, Math.round(pct));
      if (store.get(key)) broadcast({ key });
    }
    const win = (w) => (w && Number.isFinite(w.used_percentage) ? { used: Math.round(w.used_percentage), resets_at: Number(w.resets_at) * 1000 || null } : null);
    const next = { five_hour: win(p.rate_limits?.five_hour), seven_day: win(p.rate_limits?.seven_day) };
    if (!next.five_hour && !next.seven_day) return;
    const same = JSON.stringify(next) === JSON.stringify({ five_hour: quota?.five_hour || null, seven_day: quota?.seven_day || null });
    quota = { ...next, at: now() };
    if (!same) { dirty.add('__quota__'); broadcast({}); }
  }
  // A window whose reset time has passed is no longer true.
  const liveQuota = () => {
    if (!quota) return null;
    const ok = (w) => (w && (!w.resets_at || w.resets_at > now()) ? w : null);
    const q = { five_hour: ok(quota.five_hour), seven_day: ok(quota.seven_day), at: quota.at };
    return q.five_hour || q.seven_day ? q : null;
  };
  const allQuota = () => {
    const claude = liveQuota();
    const ok = (w) => (w && (!w.resets_at || w.resets_at > now()) ? w : null);
    const codex = codexLimits && (ok(codexLimits.primary) || ok(codexLimits.secondary)) ? { primary: ok(codexLimits.primary), secondary: ok(codexLimits.secondary) } : null;
    return claude || codex ? { ...(claude || {}), codex } : null;
  };
  let rules = store.rules(); // global: [{ tool, detail, mode }]
  // Someone is "present" while a board page has reported itself visible lately.
  let lookedAt = 0;
  const present = () => now() - lookedAt < 75_000;
  const push = notifier || createNotifier({ boardUrl, isPresent: present });
  store.onChange((s) => push.consider(s));
  const snapshot = () => {
    refreshTasks();
    const sessions = store.list().filter((s) => !s.archived).map(view);
    return { now: now(), sessions, queue: attentionQueue(sessions, now()).map((s) => s.key), rules: rules.length, burn: burn(), quota: allQuota() };
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
    else if (!s || Object.keys(s).length) for (const x of store.list()) dirty.add(x.key); // unknown scope: recheck all
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      for (const key of refreshTasks()) dirty.add(key);
      const changed = [];
      const removed = [];
      const quotaChanged = dirty.delete('__quota__');
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
      if (!clients.size || (!changed.length && !removed.length && !quotaChanged)) return;
      const live = store.list().filter((x) => !x.archived).map(view);
      const msg = `data: ${JSON.stringify({ now: now(), changed, removed, queue: attentionQueue(live, now()).map((x) => x.key), rules: rules.length, burn: burn(), quota: allQuota() })}\n\n`;
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
    const [top, branch, head, remote, common] = await Promise.all([
      git(s.cwd, ['rev-parse', '--show-toplevel']),
      git(s.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      s.start_head ? null : git(s.cwd, ['rev-parse', 'HEAD']),
      s.repo_id ? null : git(s.cwd, ['remote', 'get-url', 'origin']),
      s.repo_id ? null : git(s.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    // A snapshot of the working tree as it was when we first saw the session,
    // uncommitted changes included. `git stash create` writes a commit object
    // and nothing else: no ref, no change to the index or the files.
    const baseline = s.baseline || !head ? null : (await git(s.cwd, ['stash', 'create', 'session-board baseline'])) || head;
    const repo = top ? basename(top) : basename(s.cwd);
    // Worktrees of one repository have different folders but share a remote
    // (or at least a git directory): that is what makes them the same repo.
    const repoId = s.repo_id ? null : (remote ? remote.replace(/\/\/[^@/]*@/, '//') : common);
    if (repo !== s.repo || branch !== s.branch || (head && !s.start_head) || repoId) {
      emit(s, 'meta.updated', { repo, branch, ...(head ? { head } : {}), ...(repoId ? { repo_id: repoId } : {}), ...(baseline ? { baseline } : {}) });
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
    if (!s.branch || (!isLocal(s) && !s.github && !s.cloud_id)) return false;
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

  // Shared folders: when two live sessions work in one directory, a diff of
  // the directory cannot say who changed what. So around each shell command
  // of a session in a shared folder we note what the working tree looked like
  // before and after, and credit the difference to that session. (Two
  // commands running at the same moment can still both be credited.)
  const shared = (s) => isLocal(s) && s.cwd && existsSync(s.cwd) &&
    store.list().some((o) => o.key !== s.key && !o.archived && o.cwd === s.cwd && o.host === s.host && o.state !== 'ended' && now() - o.last_event_ts < QUIET_MS * 6);
  async function treeState(cwd) {
    const [tree, head, untracked] = await Promise.all([
      git(cwd, ['stash', 'create', 'session-board attribution']),
      git(cwd, ['rev-parse', 'HEAD']),
      git(cwd, ['ls-files', '--others', '--exclude-standard']),
    ]);
    return { tree: tree || head, untracked: new Set((untracked || '').split('\n').filter(Boolean)) };
  }
  const before = new Map(); // tool_use_id -> tree state when the command began
  async function noteShellStart(s, id) {
    if (!id || !shared(s)) return;
    const state = await Promise.race([treeState(s.cwd), new Promise((r) => setTimeout(() => r(null), 1500))]);
    if (state?.tree) before.set(id, state);
    if (before.size > 200) before.delete(before.keys().next().value);
  }
  async function noteShellEnd(s, id) {
    const was = before.get(id);
    if (!was) return;
    before.delete(id);
    const is = await treeState(s.cwd);
    if (!is.tree) return;
    const changed = ((await git(s.cwd, ['diff', '--name-only', was.tree, is.tree])) || '').split('\n').filter(Boolean);
    const created = [...is.untracked].filter((f) => !was.untracked.has(f));
    const files = [...new Set([...changed, ...created])].slice(0, 100).map((f) => join(s.cwd, f));
    if (files.length) emit(store.get(s.key), 'files.attributed', { files, via: 'shell' });
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
    const standing = asked && rules.some((r) => ruleMatches(r, asked.tool, asked.detail));
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
      // Asked separately: tmux rewrites control characters in its output, so
      // the two values cannot be told apart reliably on one line.
      const show = (what) => run('tmux', [...t, 'display-message', '-p', '-t', s.tmux.pane, what]);
      const [shown, where] = await Promise.all([show('#{pane_current_command}'), show('#{pane_current_path}')]);
      if (shown == null) throw Object.assign(new Error('the tmux pane this session ran in is gone'), { status: 409 });
      // Keys go to whatever is in the pane now. If the agent has exited, that
      // is a shell and our text would be run as a command; if the pane was
      // recorded wrongly (a hook fired from a shared daemon), it is someone
      // else's terminal. Either way: do not type.
      const command = shown.trim();
      const path = (where || '').trim();
      if (SHELLS.has(command)) throw Object.assign(new Error(`the agent is no longer running in that tmux pane (it shows ${command}); typing there would run as a shell command`), { status: 409 });
      const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
      if (s.cwd && path && !related(path, s.cwd)) throw Object.assign(new Error('that tmux pane is in a different directory from this session; refusing to type into it'), { status: 409 });
      // -l sends the text literally; Enter is a separate key so it is not typed.
      if ((await run('tmux', [...t, 'send-keys', '-t', s.tmux.pane, '-l', '--', text])) == null ||
          (await run('tmux', [...t, 'send-keys', '-t', s.tmux.pane, 'Enter'])) == null) {
        throw Object.assign(new Error('tmux refused the keys'), { status: 502 });
      }
      return done({ via: 'tmux' });
    }
    if (route === 'hook') {
      emit(s, 'reply.queued', { text });
      return done({ via: 'hook' });
    }
    if (route === 'cloud') {
      const out = await new Promise((resolve) => execFile('claude', ['-p', text, '--cloud', `https://claude.ai/code/session_${s.cloud_id}`],
        { timeout: 60_000 }, (err, stdout, stderr) => resolve({ err, text: `${stdout || ''}${stderr || ''}`.trim() })));
      if (out.err) throw Object.assign(new Error(`could not reach the cloud session: ${out.text.split('\n').pop() || out.err.message}`), { status: 502 });
      return done({ via: 'cloud' });
    }
    if (route === 'queue') {
      const out = await new Promise((resolve) => execFile('codex', ['queue', '--thread', s.session_id, '--message', text, '--resume'],
        { cwd: s.cwd && existsSync(s.cwd) ? s.cwd : undefined, timeout: 20_000 }, (err, stdout, stderr) => resolve({ err, text: `${stdout || ''}${stderr || ''}`.trim() })));
      if (out.err) throw Object.assign(new Error(`codex queue failed: ${out.text.split('\n').pop() || out.err.message}`), { status: 502 });
      return done({ via: 'queue' });
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
  // Three ways to cut the diff:
  //   since    everything that changed in the working tree since the session
  //            was first seen, whoever or whatever changed it (shell commands
  //            included). Exact when the session has the directory to itself.
  //   session  only the files this session's edit tools touched
  //   all      the whole working tree against the last commit
  async function workingTree(s, scope = 'all') {
    if (!isLocal(s) && s.cloud_id) return branchReview(s);
    if (!isLocal(s) || !s.cwd || !existsSync(s.cwd)) return { available: false };
    const sinceOk = scope === 'since' && !!s.baseline && (await run('git', ['-C', s.cwd, 'cat-file', '-e', `${s.baseline}^{commit}`])) != null;
    const base = sinceOk ? s.baseline : 'HEAD';
    const own = scope === 'session' && s.files.length ? ['--', ...s.files] : [];
    const [status, stat, tracked] = await Promise.all([
      git(s.cwd, ['status', '--porcelain', '-uall', ...own]),
      git(s.cwd, ['diff', base, '--stat', ...own]),
      run('git', ['-C', s.cwd, 'diff', base, ...own]),
    ]);
    if (status == null && tracked == null) return { available: false };
    // New files are not in `git diff HEAD`; show them as additions too.
    const fresh = (status || '').split('\n').filter((l) => l.startsWith('?? ')).map((l) => l.slice(3)).slice(0, 30);
    const added = await Promise.all(
      fresh.map((f) => run('git', ['-C', s.cwd, 'diff', '--no-index', '--', '/dev/null', f], { okCodes: [1] })),
    );
    const diff = [tracked, ...added].filter(Boolean).join('\n');
    // Per file: its current content hash, and whether the human has reviewed
    // exactly this content (a later change makes it unreviewed again).
    const paths = [...new Set([...diff.matchAll(/^diff --git a\/.* b\/(.*)$/gm)].map((m) => m[1]))].slice(0, 200);
    const present = paths.filter((p) => existsSync(join(s.cwd, p)));
    const hashes = present.length ? ((await git(s.cwd, ['hash-object', '--', ...present])) || '').split('\n') : [];
    const hashOf = new Map(present.map((p, i) => [p, hashes[i] || null]));
    const files = paths.map((p) => {
      const hash = hashOf.get(p) || 'deleted';
      return { path: p, hash, viewed: s.viewed[p] === hash, changed_since_viewed: !!s.viewed[p] && s.viewed[p] !== hash };
    });
    return {
      available: true,
      scope: sinceOk ? 'since' : own.length ? 'session' : 'all',
      baseline: !!s.baseline,
      files,
      attributed: s.files.length,
      status: status || '',
      stat: stat || '',
      diff: diff.slice(0, MAX_DIFF),
      truncated: diff.length > MAX_DIFF,
    };
  }

  // Coming back to a session cold: what was asked, and what has happened
  // since the human last looked, counted from the event log.
  function brief(s, since) {
    const events = store.events(s.key, 3000).filter((e) => e.ts > since && !e.late);
    const count = (type, pred = () => true) => events.filter((e) => e.type === type && pred(e)).length;
    const decisions = events.filter((e) => e.type === 'request.resolved' && e.data?.decision).map((e) => ({ decision: e.data.decision, by: e.data.by }));
    return {
      first_prompt: s.first_prompt,
      since,
      turns: count('prompt.submitted'),
      tools: count('tool.started'),
      failed_commands: count('tool.finished', (e) => e.data?.ok === false),
      requests: count('permission.requested') + count('question.asked'),
      allowed: decisions.filter((d) => d.decision === 'allow' || d.decision === 'answer').length,
      denied: decisions.filter((d) => d.decision === 'deny').length,
      by_rule: decisions.filter((d) => d.by && d.by !== 'human').length,
      compactions: count('context.compacted'),
      total_compactions: s.compactions,
    };
  }

  // Would this session's branch merge cleanly with the branches of the other
  // live sessions in the same repository? A dry run: nothing is written.
  async function conflicts(s) {
    if (!isLocal(s) || !s.cwd || !s.branch || s.branch === 'HEAD' || !existsSync(s.cwd)) return [];
    const repo = s.repo_id || s.repo;
    const others = store.list().filter((o) => o.key !== s.key && !o.archived && o.state !== 'ended' &&
      (o.repo_id || o.repo) === repo && o.branch && o.branch !== s.branch && o.branch !== 'HEAD');
    const out = [];
    for (const branch of [...new Set(others.map((o) => o.branch))].slice(0, 6)) {
      const res = await new Promise((resolve) => execFile('git', ['-C', s.cwd, 'merge-tree', '--write-tree', '--name-only', s.branch, branch],
        { timeout: 8000, maxBuffer: 4 << 20 }, (err, stdout) => resolve({ code: err ? err.code : 0, stdout: stdout || '' })));
      if (res.code !== 1) continue; // 0 = clean; anything else = could not tell
      const files = res.stdout.split('\n').slice(1).filter((l) => l && !l.includes(' ')).slice(0, 8);
      out.push({ branch, with: others.filter((o) => o.branch === branch).map((o) => o.title || o.session_id).slice(0, 2), files });
    }
    return out;
  }

  // Cloud sessions through git. Once a minute each known remote is asked, in
  // one small request, where its session branches point. Only when something
  // moved is anything fetched and worked out again (changed files, distance
  // from the default branch, whether it would conflict).
  const RECENT_MS = 30 * 60 * 1000;
  const remotes = new Map(); // url -> { sig, baseSha, dir, base, branches: Map(cloud id -> branch facts) }
  const cloudRef = new Map(); // session key -> { url, dir, ref } for showing its diff
  async function knownRemotes() {
    const dirs = new Set([...store.list().filter((s) => isLocal(s) && s.cwd).map((s) => s.cwd), ...(cloudGit.dirs ? cloudGit.dirs() : [])]);
    const urls = new Set(cloudGit.urls ? await cloudGit.urls() : []);
    for (const dir of [...dirs].slice(0, 80)) {
      const url = await remoteOf(dir);
      if (url) urls.add(url);
    }
    return [...urls].slice(0, 40);
  }
  async function scanCloudBranches() {
    if (!cloudGit) return { remotes: 0, sessions: 0 };
    const urls = await knownRemotes();
    let found = 0;
    for (const url of urls) {
      const seen = await lsRemote(url);
      if (!seen) continue;
      const sig = `${seen.base}@${seen.baseSha}|${[...seen.heads].sort().join(',')}`;
      let st = remotes.get(url);
      if (!st || st.sig !== sig) {
        const read = await readRemote(url, cloudGit.cacheRoot, seen);
        if (!read) continue;
        const branches = new Map();
        for (const b of read.branches) {
          const was = st?.branches.get(b.cloud_id);
          if (was && was.sha === b.sha && st.baseSha === seen.baseSha) Object.assign(b, { files: was.files, conflicts: was.conflicts });
          else {
            // Trees are fetched on demand for these; do them only when the branch moved.
            b.files = await branchFiles(read.dir, b.ref).catch(() => null);
            b.conflicts = seen.base ? await branchConflicts(read.dir, b.ref).catch(() => null) : null;
          }
          branches.set(b.cloud_id, b);
        }
        // A branch that is gone from the remote: merged and deleted, or abandoned.
        for (const [id] of st?.branches || []) {
          if (branches.has(id)) continue;
          const s = store.list().find((x) => x.cloud_id === id);
          if (s) emit(s, 'cloud.branch.gone', {});
        }
        st = { sig, baseSha: seen.baseSha, dir: read.dir, base: read.base, branches };
        remotes.set(url, st);
      }
      const slug = parseRemote(url);
      const repo = url.replace(/\.git\/?$/, '').split(/[/:]/).pop();
      const repoId = url.replace(/\/\/[^@/]*@/, '//');
      const byCloud = new Map(store.list().filter((x) => x.cloud_id).map((x) => [x.cloud_id, x]));
      for (const b of st.branches.values()) {
        const have = byCloud.get(b.cloud_id);
        const ref = have ? { agent: have.agent, session_id: have.session_id } : { agent: 'claude', session_id: `session_${b.cloud_id}` };
        const recent = now() - b.ts < RECENT_MS;
        const moved = !have || have.tip !== b.sha;
        const s = store.append({
          ...ref, ts: now(), host: 'claude-cloud', runtime: 'cloud', cloud_id: b.cloud_id,
          eid: `git:${b.sha}:${st.baseSha}:${recent}`, type: 'cloud.branch',
          data: {
            branch: b.branch, repo, repo_id: repoId, github: slug ? `${slug.owner}/${slug.repo}` : null, tip: b.sha, subject: b.subject, ts: b.ts, recent,
            url: `https://claude.ai/code/session_${b.cloud_id}`, base: st.base, ahead: b.ahead, behind: b.behind,
            files: b.files, conflicts: b.conflicts, commits: b.commits,
          },
        });
        if (s) {
          cloudRef.set(s.key, { url, dir: st.dir, ref: b.ref });
          refreshPr(s, { force: moved }).catch(() => {});
        }
        found += 1;
      }
    }
    return { remotes: urls.length, sessions: found };
  }
  const cloudScanner = cloudGit ? setInterval(() => scanCloudBranches().catch(() => {}), 60_000) : null;
  cloudScanner?.unref();

  // A cloud session's work, read from the hub's own copy of its branch.
  async function branchReview(s) {
    const at = cloudRef.get(s.key);
    if (!at) return { available: false };
    const d = await branchDiff(at.dir, at.ref);
    if (!d) return { available: false };
    return {
      available: true, scope: 'branch', base: s.base_branch, baseline: true, attributed: d.files.length, status: '', stat: d.stat, diff: d.diff, truncated: d.truncated,
      files: d.files.map((f) => ({ ...f, viewed: s.viewed[f.path] === f.hash, changed_since_viewed: !!s.viewed[f.path] && s.viewed[f.path] !== f.hash })),
    };
  }
  // Would it conflict with the other session branches on the same remote?
  async function branchClashes(s) {
    const at = cloudRef.get(s.key);
    if (!at) return [];
    const out = [];
    for (const [key, other] of cloudRef) {
      if (key === s.key || other.url !== at.url || out.length >= 5) continue;
      const o = store.get(key);
      if (!o || o.archived || o.state === 'ended') continue;
      const files = await branchConflicts(at.dir, at.ref, other.ref);
      if (files?.length) out.push({ branch: o.branch, with: [o.title || o.session_id], files });
    }
    return out;
  }

  // Codex through its own local server: every Codex thread on this machine,
  // from any client, plus the account's usage windows.
  async function scanCodex() {
    if (!codexApp) return null;
    const snap = await codexApp.poll().catch(() => null);
    if (!snap) return null;
    for (const t of snap.threads) {
      // Old, stopped threads are history, not something to put on the board now.
      const fresh = t.status === 'active' || (t.updated && now() - t.updated < 3 * 86_400_000) || store.get(`codex:${t.id}`);
      if (!fresh) continue;
      const data = { title: t.title, cwd: t.cwd, branch: t.branch, repo_id: t.repo_id, client: t.client, status: t.status, waiting: t.waiting, unread: t.unread };
      store.append({ agent: 'codex', session_id: t.id, ts: now(), host: localHost, cwd: t.cwd, eid: `app:${JSON.stringify(data)}`, type: 'codex.thread', data });
    }
    if (snap.limits && JSON.stringify(snap.limits) !== JSON.stringify(codexLimits)) {
      codexLimits = snap.limits;
      dirty.add('__quota__');
      broadcast({});
    }
    return { threads: snap.threads.length, limits: !!snap.limits };
  }
  let codexLimits = null;
  const codexScanner = codexApp ? setInterval(() => scanCodex().catch(() => {}), 15_000) : null;
  codexScanner?.unref();

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

  async function handle(req, res, { admitted = false } = {}) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const body = async () => JSON.parse((await readBody(req)) || '{}');

    if (!admitted && (path.startsWith('/ingest/') || path.startsWith('/api/'))) {
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
      // The triage runner is itself an agent session; it stays off the board.
      if (payload.cwd && ignoreCwds.includes(payload.cwd)) return json(res, 200, {});
      const q = url.searchParams;
      const tmux = q.get('tmux_pane') && q.get('tmux_socket')
        ? { socket: q.get('tmux_socket'), pane: q.get('tmux_pane') }
        : null;
      // A hook running inside a Claude Code cloud container names its cloud
      // session in a header (empty everywhere else).
      const cloudId = cloudSuffix(req.headers['x-cloud-session']) || cloudSuffix(q.get('cloud'));
      // Hooks committed to a repository for its cloud sessions also load when
      // the repository is opened locally, where the machine's own hooks
      // already report. Those are marked only=cloud and ignored off-cloud.
      if (q.get('only') === 'cloud' && !cloudId) return json(res, 200, {});
      const events = fromHook(hook[1], payload, {
        host: cloudId ? 'claude-cloud' : q.get('host'),
        runtime: q.get('runtime'),
        cloudId,
        now: now(),
        seq: q.has('seq') ? Number(q.get('seq')) : null,
        source: q.get('source'),
        tmux,
      });
      if (payload.hook_event_name === 'PermissionRequest' && events.length) {
        return holdPermission(req, res, events[0], payload.tool_input);
      }
      const s = ingest(events);
      // Hooks are a two-way street. The answer to one can tell the agent to
      // stop, or, when its turn has just ended, hand it what the human
      // queued so that it carries on. (Claude Code; verified on 2.1.330.)
      if (s && hook[1] === 'claude') {
        if (s.stop_requested) {
          emit(s, 'human.stopped');
          return json(res, 200, { continue: false, stopReason: 'Stopped from session-board by the user.' });
        }
        if (payload.hook_event_name === 'Stop' && s.queued.length) {
          const text = s.queued.map((m) => m.text).join('\n\n');
          emit(s, 'reply.delivered');
          emit(store.get(s.key), 'prompt.submitted', { prompt: text, via: 'board' });
          return json(res, 200, { decision: 'block', reason: text });
        }
      }
      // Shell commands in a shared folder: look before the command runs (the
      // hook's answer waits for that, a few tens of milliseconds) and after.
      const shell = s && payload.tool_use_id && ['Bash', 'shell', 'local_shell', 'exec_command'].includes(payload.tool_name);
      if (shell && payload.hook_event_name === 'PreToolUse') await noteShellStart(s, payload.tool_use_id).catch(() => {});
      else if (shell && /^PostToolUse/.test(payload.hook_event_name)) noteShellEnd(s, payload.tool_use_id).catch(() => {});
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
    // --- triage: an agent may read what is open and attach advice; nothing more.
    if (path === '/api/triage' && req.method === 'GET') {
      const live = store.list().filter((s) => !s.archived);
      const open = attentionQueue(live, now()).filter((s) => s.triage?.for !== itemId(s)).slice(0, 12);
      return json(res, 200, open.map((s) => ({
        item: itemId(s),
        kind: s.waiting?.kind || s.state,
        agent: s.agent,
        repo: s.repo,
        task: s.title,
        tool: s.waiting?.tool || null,
        request: s.waiting?.detail || null,
        looks_drastic: !!s.waiting?.risky,
        error: s.error,
        last_instruction: s.last_prompt,
        last_reply: s.state === 'review' || s.state === 'failed' ? s.last_message : null,
        files_edited: s.files.length,
      })));
    }
    if (path === '/api/triage' && req.method === 'POST') {
      const { item, summary, suggestion } = await body();
      const s = store.get(String(item || '').split('@')[0]);
      if (!s || itemId(s) !== item) return json(res, 409, { error: 'that item is no longer open' });
      if (typeof summary !== 'string' || !summary.trim()) return json(res, 400, { error: 'summary required' });
      if (!['allow', 'deny', 'look', 'none'].includes(suggestion || 'none')) return json(res, 400, { error: 'suggestion must be allow, deny, look or none' });
      emit(s, 'triage.noted', { for: item, summary: summary.trim(), suggestion: suggestion || 'none' });
      return json(res, 200, { ok: true });
    }

    // --- tasks: accept a whole task at once, optionally adopting one version.
    const task = path.match(/^\/api\/tasks\/([^/]+)\/ack$/);
    if (task && req.method === 'POST') {
      const id = decodeURIComponent(task[1]);
      const { adopt } = await body();
      refreshTasks();
      const members = [...new Set([...tasks.values()].filter((t) => t.id === id).flatMap((t) => t.members))];
      if (!members.length) return json(res, 404, { error: 'no such task' });
      if (adopt && !members.includes(adopt)) return json(res, 400, { error: 'that session is not part of this task' });
      const acked = [];
      const archived = [];
      for (const key of members) {
        const s = store.get(key);
        if (['review', 'failed', 'unknown'].includes(s.phase)) { emit(s, 'human.acknowledged'); acked.push(key); }
        // Adopting one version files the others away; work still running is left alone.
        if (adopt && key !== adopt && store.get(key).state !== 'working' && store.get(key).state !== 'needs_input') {
          emit(store.get(key), 'human.archived');
          archived.push(key);
        }
      }
      return json(res, 200, { acked, archived });
    }

    if (path === '/ingest/cloud' && req.method === 'POST') {
      // The vendor's own list of the account's cloud sessions, as a cloud
      // session can read it. Accepts the list as that tool returns it.
      const sent = await body();
      const rows = Array.isArray(sent) ? sent : sent?.sessions || sent?.ccr?.data || sent?.data || [];
      const byCloud = new Map(store.list().filter((x) => x.cloud_id).map((x) => [x.cloud_id, x]));
      let taken = 0;
      const parents = [];
      for (const r of rows) {
        const id = cloudSuffix(r?.id);
        if (!id) continue;
        const have = byCloud.get(id);
        const ref = have ? { agent: have.agent, session_id: have.session_id } : { agent: 'claude', session_id: `session_${id}` };
        const bucket = BUCKET[String(r.status_bucket || '').replace('SESSION_STATUS_BUCKET_', '')] ||
          (/RUNNING/.test(r.session_status) ? 'working' : /IDLE/.test(r.session_status) ? 'completed' : null);
        const data = {
          bucket, title: r.title || null, unread: !!r.unread, url: `https://claude.ai/code/session_${id}`,
          summary: r.post_turn_summary?.recent_action || null,
          activity: r.task_summary || r.post_turn_summary?.needs_action || null,
        };
        const next = store.append({ ...ref, ts: now(), host: 'claude-cloud', runtime: 'cloud', cloud_id: id, eid: `snap:${JSON.stringify(data)}`, type: 'cloud.snapshot', data });
        if (next) byCloud.set(id, next);
        if (r.parent_session_id) parents.push([id, cloudSuffix(r.parent_session_id)]);
        taken += 1;
      }
      // Sessions a parent session spawned belong with it.
      for (const [child, parent] of parents) {
        const c = byCloud.get(child);
        const p = byCloud.get(parent);
        if (c && p && c.task_manual !== p.key && c.task_manual !== 'solo') emit(c, 'task.assigned', { task: p.key, reason: 'parent' });
      }
      return json(res, 200, { accepted: taken });
    }
    if (path === '/ingest/status' && req.method === 'POST') {
      // From the status line bridge: quota windows and context fill.
      const p = await body().catch(() => ({}));
      noteStatus(url.searchParams.get('agent') || 'claude', p || {});
      return json(res, 200, {});
    }
    if (path === '/api/presence' && req.method === 'POST') {
      const { visible } = await body();
      lookedAt = visible ? now() : 0;
      return json(res, 200, { ok: true });
    }
    if (path === '/api/backfill' && req.method === 'POST') {
      const { days } = await body();
      return json(res, 200, await backfill({ days: Number(days) > 0 ? Number(days) : 7 }));
    }
    if (path === '/api/cloud-scan' && req.method === 'POST') return json(res, 200, await scanCloudBranches());
    if (path === '/api/reconcile' && req.method === 'POST') {
      return json(res, 200, { lost: await reconcile(), settled: await settle() });
    }

    // Decide once, apply everywhere: the same request open in many sessions is
    // answered in one call, optionally becoming a standing rule.
    if (path === '/api/requests/batch' && req.method === 'POST') {
      // `remember` is a rule to add ({ tool, detail, mode }), or true for
      // "exactly this command" taken from the first request.
      const { ids, decision: d, remember } = await body();
      if (!Array.isArray(ids) || !['allow', 'deny'].includes(d)) return json(res, 400, { error: 'ids and decision (allow|deny) required' });
      let rule = null;
      if (remember && d === 'allow') {
        const h = held.get(ids.find((id) => held.has(id)));
        const r = h && store.get(h.key).requests.find((x) => held.get(x.id) === h);
        const wanted = remember === true ? r && { tool: r.tool, detail: r.detail, mode: 'exact' } : remember;
        // The rule must cover the request it is being made from.
        if (wanted && !ruleProblem(wanted) && r && ruleMatches(wanted, r.tool, r.detail)) {
          store.addRule(wanted.tool, wanted.detail, now(), wanted.mode || 'exact');
          rules = store.rules();
          rule = { tool: wanted.tool, detail: wanted.detail, mode: wanted.mode || 'exact' };
        }
      }
      const done = ids.filter((id) => decide(id, d)).length;
      return json(res, 200, { decided: done, rule });
    }
    if (path === '/api/rules') {
      if (req.method === 'GET') return json(res, 200, rules);
      const { tool, detail, mode = 'exact' } = await body();
      if (typeof tool !== 'string' || typeof detail !== 'string') return json(res, 400, { error: 'tool and detail required' });
      if (req.method === 'POST') {
        const problem = ruleProblem({ tool, detail, mode });
        if (problem) return json(res, 400, { error: problem });
        store.addRule(tool, detail, now(), mode);
        // Requests already waiting that the new rule covers are answered now.
        for (const [id, h] of [...held]) {
          const r = store.get(h.key).requests.find((x) => x.id === id);
          if (r && ruleMatches({ tool, detail, mode }, r.tool, r.detail)) {
            release(id, decisionBody('allow'));
            emit(store.get(h.key), 'request.resolved', { id, decision: 'allow', by: 'standing rule' });
          }
        }
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

    const act = path.match(/^\/api\/sessions\/([^/]+)\/(ack|unack|archive|unarchive|seen|unseen|snooze|unsnooze|events|message|diff|rule|detail|task|rename|viewed|stop)$/);
    if (act) {
      const key = decodeURIComponent(act[1]);
      const s = store.get(key);
      if (!s) return json(res, 404, { error: 'no such session' });
      const verb = act[2];
      if (req.method === 'GET') {
        if (verb === 'events') return json(res, 200, store.events(key));
        if (verb === 'detail') {
          const since = Number(url.searchParams.get('since')) || 0;
          return json(res, 200, { ...full(s), brief: brief(s, since), conflicts: isLocal(s) ? await conflicts(s) : await branchClashes(s) });
        }
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
        if (verb === 'stop') {
          emit(s, 'human.stop_requested');
          // A request it is blocked on would keep it from ever reaching its next hook.
          for (const r of store.get(key).requests) if (r.id && held.has(r.id)) decide(r.id, 'deny', { message: 'Stopped from session-board by the user.' });
          return json(res, 200, view(store.get(key)));
        }
        if (verb === 'rename') {
          const { title } = await body();
          if (typeof title !== 'string' || !title.trim()) return json(res, 400, { error: 'title required' });
          emit(s, 'human.renamed', { title });
          return json(res, 200, view(store.get(key)));
        }
        if (verb === 'viewed') {
          // { path, hash } marks that content as reviewed; hash null takes it back.
          const { path: file, hash } = await body();
          if (typeof file !== 'string') return json(res, 400, { error: 'path required' });
          emit(s, 'human.viewed', { path: file, hash: hash || null });
          return json(res, 200, { ok: true });
        }
        if (verb === 'task') {
          // { join: <session key> } puts it with that session's task; { join: null } pulls it out.
          const { join } = await body();
          if (join && (!store.get(join) || join === key)) return json(res, 400, { error: 'no such session to join' });
          emit(s, 'task.assigned', { task: join || 'solo' });
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

  // The drop box: a second, separate door for machines that are not this one
  // (cloud sessions, another computer). It accepts event deliveries and
  // nothing else. Nothing can be read through it and nothing can be decided,
  // replied, archived or changed: those all live behind the main door, which
  // can stay on 127.0.0.1. So what is exposed to a tunnel is write-only, and
  // the worst a leaked drop-box token allows is fake cards on the board.
  const sameToken = (a, b) => {
    const [x, y] = [a, b].map((v) => createHash('sha256').update(String(v)).digest());
    return timingSafeEqual(x, y);
  };
  let dropBox = null;
  function listenDropBox(port, host, dropToken, { perMinute = 6000 } = {}) {
    if (!dropToken || String(dropToken).length < 16) throw new Error('the drop box needs a token of at least 16 characters');
    let windowStart = 0;
    let count = 0;
    dropBox = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      // Only deliveries. Everything else does not exist here.
      if (req.method !== 'POST' || !/^\/ingest\/(claude|codex|event|cloud|status)$/.test(url.pathname)) return json(res, 404, { error: 'not found' });
      const sent = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!sameToken(sent, dropToken)) return json(res, 401, { error: 'unauthorized' });
      if (now() - windowStart > 60_000) { windowStart = now(); count = 0; }
      if ((count += 1) > perMinute) return json(res, 429, { error: 'too many deliveries' });
      handle(req, res, { admitted: true }).catch((err) => {
        if (!res.headersSent) json(res, err.status || 400, { error: 'bad delivery' });
        else res.end();
      });
    });
    dropBox.requestTimeout = 0;
    return new Promise((ok) => dropBox.listen(port, host, () => ok(dropBox.address())));
  }

  return {
    store,
    server,
    snapshot,
    ingest,
    reconcile,
    scanCodex,
    scanCloudBranches,
    settle,
    refreshPr: (key, opts) => refreshPr(store.get(key), opts),
    backfill,
    decide,
    listen: (port, host) => new Promise((ok) => server.listen(port, host, () => ok(server.address()))),
    listenDropBox,
    close: () =>
      new Promise((ok) => {
        clearInterval(tick);
        clearInterval(reconciler);
        clearInterval(cloudScanner);
        clearInterval(codexScanner);
        clearTimeout(pending);
        clearTimeout(orphanTimer);
        for (const id of [...held.keys()]) release(id);
        for (const res of clients) res.end();
        dropBox?.close();
        dropBox?.closeAllConnections?.();
        server.close(() => {
          store.close();
          ok();
        });
        server.closeAllConnections?.();
      }),
  };
}
