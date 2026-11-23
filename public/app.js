// The board is a pure render of the hub's snapshot; all state lives server-side.
// Layout: a list of sessions on the left, and on the right one "workbench"
// where the selected session can be read, answered, reviewed and replied to
// without leaving the page.
import { t, lang, langPref, setLangPref, translatePage } from '/i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...kids.flat().filter((k) => k != null && k !== false));
  return node;
};

const TOKEN = new URLSearchParams(location.search).get('token');
const api = (path) => (TOKEN ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}` : path);
const call = async (path, body) => {
  const res = await fetch(api(path), body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || t('Request failed ({status})', { status: res.status }));
  return out;
};

let snap = { now: Date.now(), sessions: [], queue: [], rules: 0 };
const all = new Map(); // key -> session, kept current from the hub's deltas
let skew = 0; // hub clock minus browser clock
let selected = null; // session key shown in the workbench
let pinned = false; // true once the human picked a session themselves
let notice = null; // { key, text } transient message in the workbench
const seen = new Map(); // key -> state signature, to detect new requests
const extra = new Map(); // key -> { sig, diff, events } lazily loaded detail
const drafts = new Map(); // key -> unsent reply text
const picks = new Map(); // request id -> { question: { chosen: Set, other: string } }
const scopes = new Map(); // key -> 'session' | 'all' for the diff view

const prefs = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const byKey = (key) => all.get(key);

function age(ts) {
  const s = Math.max(0, Math.round((Date.now() + skew - ts) / 1000));
  if (s < 60) return t('{n}s', { n: s });
  if (s < 3600) return t('{n}m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{h}h {m}m', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
  return t('{n}d', { n: Math.floor(s / 86400) });
}
// verb is one of the "…{age}" phrases, or empty for "<age> ago".
const ageText = (verb, since) => t(verb || '{age} ago', { age: age(since) });
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function rawColumn(s) {
  if (s.snoozed) return 'rest'; // filed away until later, whatever its state
  if (s.state === 'needs_input' || s.state === 'failed' || s.state === 'unknown') return 'attention';
  if (s.state === 'review') return 'review';
  if (s.state === 'working') return 'working';
  return 'rest';
}

// A session that leaves the queue for "working" and comes straight back (one
// request answered, the next one already open) should not jump around: the
// move away is shown only once it has held for a moment.
const HOLD_MS = 400;
const placed = new Map(); // key -> { col, leaving }
function column(s) {
  const raw = rawColumn(s);
  const p = placed.get(s.key);
  const settledAway = !p || p.col === raw || raw !== 'working' || (p.col !== 'attention' && p.col !== 'review');
  if (settledAway) {
    placed.set(s.key, { col: raw, leaving: 0 });
    return raw;
  }
  const t = performance.now();
  if (!p.leaving) {
    p.leaving = t;
    setTimeout(render, HOLD_MS + 20);
  }
  if (t - p.leaving < HOLD_MS) return p.col;
  placed.set(s.key, { col: raw, leaving: 0 });
  return raw;
}

function describe(s) {
  if (s.snoozed) {
    const at = new Date(s.snoozed_until - skew).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return { ...describeState(s), tone: 'rest', what: t('Snoozed until {at}', { at }) };
  }
  return describeState(s);
}

function describeState(s) {
  switch (s.state) {
    case 'needs_input':
      if (s.waiting?.kind === 'pr') {
        return { tone: 'urgent', what: prWhat(s.waiting.detail), detail: s.pr ? `PR #${s.pr.number}　${s.pr.title || ''}` : null, verb: '{age}' };
      }
      return s.waiting?.kind === 'permission'
        ? { tone: 'urgent', what: s.waiting.tool ? t('Needs permission: {tool}', { tool: s.waiting.tool }) : t('Needs permission'), detail: s.waiting.detail, code: true, verb: 'waiting {age}' }
        : { tone: 'urgent', what: t('Asking you'), detail: s.waiting?.detail, verb: 'waiting {age}' };
    case 'failed':
      return { tone: 'urgent', what: s.rate_limited ? t('Stopped: rate limited or out of quota') : t('Stopped on an error'), detail: s.error, verb: 'stopped {age}' };
    case 'unknown':
      return { tone: 'urgent', what: t('Lost: its process is gone'), detail: s.error, verb: '{age}' };
    case 'review':
      return { tone: 'review', what: s.exited ? t('Finished and exited, awaiting review') : t('Finished, awaiting review'), detail: s.last_message, verb: 'waiting {age}' };
    case 'working':
      if (s.background) return { tone: 'working', what: t('Waiting on its own background task ({task})', { task: s.background }), detail: s.last_message, verb: '{age}' };
      return {
        tone: 'working',
        what: s.current_tool ? t('Using {tool}', { tool: s.current_tool.tool }) : t('Thinking'),
        detail: s.current_tool?.detail || s.last_prompt,
        code: !!s.current_tool?.detail,
        verb: '{age}',
      };
    case 'ended':
      return { tone: 'rest', what: s.settled === 'merged' ? t('Merged, counted as accepted') : s.imported ? t('Past session (imported)') : t('Ended'), detail: s.last_message, verb: '' };
    default:
      return { tone: 'rest', what: s.settled === 'merged' ? t('Merged, counted as accepted') : t('Idle, waiting for work'), detail: s.last_message, verb: '{age}' };
  }
}

const where = (s) => [s.host, s.repo || (s.cwd || '').split('/').pop(), s.branch].filter(Boolean).join(' · ');
const agentName = (s) => (s.agent === 'claude' ? 'Claude' : s.agent === 'codex' ? 'Codex' : s.agent);
const resumeCommand = (s) => {
  const cd = s.cwd ? `cd ${JSON.stringify(s.cwd)} && ` : '';
  return s.agent === 'claude' ? `${cd}claude --resume ${s.session_id}` : `${cd}codex resume ${s.session_id}`;
};
const prWhat = (problem) => ({
  checks: t('PR checks failing'), review: t('PR changes requested'), 'checks+review': t('PR checks failing and changes requested'),
}[problem] || t('PR needs attention'));
const prFixText = (s) => {
  const n = s.pr.number;
  switch (s.waiting.detail) {
    case 'checks': return t('PR #{n}: the checks failed. Look at why, fix it, and push.', { n });
    case 'review': return t('PR #{n}: a reviewer requested changes. Read the review comments, fix them, and push.', { n });
    case 'checks+review': return t('PR #{n}: the checks failed and a reviewer requested changes. Look at both, fix them, and push.', { n });
    default: return t('PR #{n} needs attention. Take a look, fix it, and push.', { n });
  }
};
const PR_STATE = { open: t('Open'), merged: t('Merged'), closed: t('Closed (not merged)') };
const PR_CHECKS = { passing: t('Checks passing'), failing: t('Checks failing'), pending: t('Checks running') };
const PR_REVIEW = { approved: t('Approved'), changes_requested: t('Changes requested'), review_required: t('Review required') };
const prLine = (pr) => [
  `PR #${pr.number}`, pr.draft && pr.state === 'open' ? t('Draft') : PR_STATE[pr.state],
  pr.state === 'open' ? PR_CHECKS[pr.checks] : null, pr.state === 'open' ? PR_REVIEW[pr.review] : null,
].filter(Boolean).join(' · ');
const prTone = (pr) => (pr.state === 'merged' ? 'ok' : pr.checks === 'failing' || pr.review === 'changes_requested' ? 'bad' : '');
const usageLine = (s) => {
  const u = s.usage;
  if (!u) return null;
  return [
    u.model,
    u.context_tokens ? t('context {n}', { n: tokens(u.context_tokens) }) : null,
    u.output_tokens ? t('output {n}', { n: tokens(u.output_tokens) }) : null,
    u.cost_usd != null ? `$${u.cost_usd.toFixed(2)}` : null,
  ].filter(Boolean).join(' · ');
};

// ---------------------------------------------------------------- actions --

function say(key, text) {
  notice = { key, text };
  render();
  setTimeout(() => { if (notice?.text === text) { notice = null; render(); } }, 6000);
}

// After the human deals with one session, move straight to the next one that
// is waiting, so clearing the queue is one continuous pass.
function advance(fromKey) {
  const rest = snap.queue.filter((k) => k !== fromKey);
  pinned = false;
  if (rest.length) select(rest[0], false);
}

async function act(s, fn, { thenNext = true } = {}) {
  try {
    await fn();
    if (thenNext) advance(s.key);
  } catch (err) {
    say(s.key, err.message);
  }
}

const decide = (s, decision, remember = false) =>
  act(s, () => call(`/api/requests/${s.waiting.id}`, { decision, remember }), { thenNext: decision !== 'terminal' });
// Multiple-choice questions are answered here with the same choices the
// agent's own terminal offers; free text stands in for "type something".
function answersFor(s) {
  const mine = picks.get(s.waiting.id) || {};
  const out = {};
  for (const q of s.waiting.questions) {
    const p = mine[q.question];
    const chosen = [...(p?.chosen || [])];
    const other = (p?.other || '').trim();
    if (other) chosen.push(other);
    if (chosen.length) out[q.question] = q.multiSelect ? chosen : chosen[chosen.length - 1];
  }
  return out;
}
const answer = (s) => {
  const answers = answersFor(s);
  if (Object.keys(answers).length < s.waiting.questions.length) return say(s.key, t('Pick or type an answer for every question.'));
  return act(s, () => call(`/api/requests/${s.waiting.id}`, { decision: 'answer', answers }));
};
// Every filing action can be taken back for a few seconds.
let toastTimer = 0;
function toast(text, undo) {
  const box = $('#toast');
  clearTimeout(toastTimer);
  box.replaceChildren(text, ...(undo ? [el('button', { textContent: t('Undo'), onclick: async () => { box.hidden = true; await undo().catch(() => {}); } })] : []));
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}
const file = (s, verb, reverse, text, body = {}) => act(s, async () => {
  const k = encodeURIComponent(s.key);
  await call(`/api/sessions/${k}/${verb}`, body);
  toast(text, () => call(`/api/sessions/${k}/${reverse}`, {}).then(() => select(s.key, true)));
});
const ack = (s) => file(s, 'ack', 'unack', s.state === 'review' ? t('Accepted.') : t('Noted.'));
const archive = (s) => file(s, 'archive', 'unarchive', t('Archived.'));
const tomorrow = () => { const d = new Date(Date.now() + skew); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); };
const snooze = (s, body, label) => file(s, 'snooze', 'unsnooze', t('Snoozed until {label}. It comes back early if something new happens.', { label }), body);
const markUnread = (s) => call(`/api/sessions/${encodeURIComponent(s.key)}/unseen`, {}).then(() => { reading = null; advance(s.key); }).catch((e) => say(s.key, e.message));

async function send(s) {
  const text = (drafts.get(s.key) || '').trim();
  if (!text) return;
  try {
    // The id makes a retry or double click harmless.
    await call(`/api/sessions/${encodeURIComponent(s.key)}/message`, { text, command_id: crypto.randomUUID() });
    drafts.delete(s.key);
    advance(s.key);
  } catch (err) {
    say(s.key, err.message);
  }
}

function copy(text, button) {
  navigator.clipboard?.writeText(text).then(() => {
    const old = button.textContent;
    button.textContent = t('Copied');
    setTimeout(() => (button.textContent = old), 1200);
  });
}

// ------------------------------------------------------------------ lists --
// Built for hundreds of sessions: cards are keyed and only the ones whose
// content changed are rebuilt; the groups that need nothing from you fold
// into a per-project summary; identical requests are offered as one decision.

const GROUPS = [
  ['attention', t('Needs you'), t('Permissions, questions, failures, lost sessions, PR problems. Higher means more urgent.')],
  ['review', t('To review'), t('The agent says it is done and you have not looked yet.')],
  ['working', t('Working'), t('Does not need you, unless it has been quiet too long.')],
  ['rest', t('Idle / ended'), t('Waiting for your next job, or already exited.')],
];
const MANY = 12; // past this many sessions, the working group starts folded

let filter = '';
const repoOf = (s) => s.repo || (s.cwd || '').split('/').pop() || t('(unknown project)');
const matches = (s) => !filter ||
  [s.title, s.repo, s.cwd, s.host, s.agent, s.branch].filter(Boolean).join(' ').toLowerCase().includes(filter);
const visible = () => (filter ? snap.sessions.filter(matches) : snap.sessions);
const folded = (name) => {
  const saved = prefs.get(`fold:${name}`);
  if (saved) return saved === '1';
  // The list is an inbox: what needs nothing from you stays out of the way.
  return name === 'rest' || (name === 'working' && snap.sessions.length > MANY);
};

// Move/insert only what differs, so focus and scroll survive live updates.
function reconcile(container, items) {
  const old = new Map();
  for (const n of container.children) old.set(n.dataset.key, n);
  const nodes = items.map((it) => {
    const have = old.get(it.key);
    if (have && have.dataset.sig === it.sig) return have;
    const fresh = it.make();
    fresh.dataset.key = it.key;
    fresh.dataset.sig = it.sig;
    if (have && have === document.activeElement) queueMicrotask(() => fresh.focus());
    return fresh;
  });
  nodes.forEach((n, i) => { if (container.children[i] !== n) container.insertBefore(n, container.children[i] || null); });
  while (container.children.length > nodes.length) container.lastChild.remove();
}

const ageSpan = (s, d) => el('span', {
  className: 'age', dataset: { since: s.since, verb: d.verb }, textContent: ageText(d.verb, s.since),
});
function tickAges() {
  for (const n of document.querySelectorAll('.age[data-since]')) {
    const since = Number(n.dataset.since);
    n.textContent = ageText(n.dataset.verb, since);
  }
}

// A triage agent's note: advice, clearly marked as such.
const SUGGEST = { allow: t('Suggest allow'), deny: t('Suggest deny'), look: t('Needs a look'), none: '' };
const triageLine = (s) => s.triage && el('div', { className: `triage ${s.triage.suggestion}` },
  SUGGEST[s.triage.suggestion] && el('b', { textContent: SUGGEST[s.triage.suggestion] }), s.triage.summary);

// ---- tasks: several sessions that are attempts at the same thing ----
const COL_ORDER = ['attention', 'review', 'working', 'rest'];
const siblings = (s) => (s.task ? snap.sessions.filter((x) => x.task?.id === s.task.id) : [s]);

// Sessions that share a task become one entry, placed in the column of the
// member that needs the most from you.
function stack(groups) {
  const members = new Map();
  for (const name of COL_ORDER) for (const s of groups[name]) if (s.task) (members.get(s.task.id) || members.set(s.task.id, []).get(s.task.id)).push(s);
  const done = new Set();
  const out = {};
  for (const name of COL_ORDER) {
    out[name] = [];
    for (const s of groups[name]) {
      const group = s.task && members.get(s.task.id);
      if (!group || group.length < 2) { out[name].push(s); continue; }
      if (done.has(s.task.id)) continue;
      done.add(s.task.id); // first met in column order = its most urgent member's column
      out[name].push({ task: s.task.id, members: group, lead: group[0] });
    }
  }
  return out;
}

function taskCard(entry) {
  const tone = describe(entry.lead).tone;
  const agents = [...new Set(entry.members.map(agentName))].join(' + ');
  return el('div', { className: 'card task', dataset: { tone } },
    el('div', { className: 'meta' }, el('span', { className: 'tasktag', textContent: t('Task · {n} sessions', { n: entry.members.length }) }),
      el('span', { className: 'where', textContent: [agents, repoOf(entry.lead)].join(' · ') })),
    el('div', { className: 'title', textContent: entry.lead.title || t('(no task description yet)') }),
    el('div', { className: 'members' }, entry.members.map((m) => {
      const d = describe(m);
      return el('button', {
          className: 'member', type: 'button', dataset: { tone: d.tone }, ariaCurrent: String(m.key === selected), onclick: () => select(m.key, true),
        },
        m.unseen && el('span', { className: 'dot' }),
        el('span', { className: `badge ${m.agent}`, textContent: agentName(m) }),
        el('span', { className: 'what', textContent: d.what }),
        m.triage && SUGGEST[m.triage.suggestion] && el('span', { className: `chip-s ${m.triage.suggestion}`, textContent: SUGGEST[m.triage.suggestion] }),
        ageSpan(m, d));
    })));
}

// On a finished session's card: was the work checked, in one glance.
function checkLine(s) {
  const test = (s.checks || []).filter((c) => c.kind === 'test').at(-1);
  if (!test) return el('div', { className: 'peek', textContent: t('No test run seen') });
  if (!test.ok) return el('div', { className: 'warn', textContent: t('Last test run failed') });
  if (s.last_edit_ts > test.ts) return el('div', { className: 'warn', textContent: t('Edited after the last test run') });
  return el('div', { className: 'pr ok', textContent: t('Tests passed after the last edit') });
}

const cardSig = (s) => JSON.stringify([
  s.state, s.since, s.title, s.host, s.repo, s.cwd, s.branch, s.runtime, s.agent, s.subagents, s.requests.length,
  s.waiting && [s.waiting.kind, s.waiting.tool, s.waiting.detail, s.waiting.risky],
  s.current_tool, s.background, s.quiet, s.pr, s.error, s.exited, s.settled, s.imported, s.rate_limited,
  s.state === 'working' ? s.last_prompt?.slice(0, 90) : s.last_message?.slice(0, 90), s.key === selected,
  s.unseen, s.snoozed && s.snoozed_until, column(s), s.triage, s.overlap, s.checks, s.last_edit_ts,
]);

function card(s) {
  const d = describe(s);
  return el('button', {
      className: 'card', type: 'button', onclick: () => select(s.key, true),
      dataset: { tone: d.tone }, ariaCurrent: s.key === selected ? 'true' : 'false',
    },
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: agentName(s) }),
      el('span', { className: 'where', textContent: where(s) }),
      s.runtime === 'cloud' && el('span', { textContent: t('Cloud') }),
      s.subagents > 0 && el('span', { textContent: t('{n} subagents', { n: s.subagents }) }),
    ),
    el('div', { className: 'title' }, s.unseen && el('span', { className: 'dot', title: t('Not seen yet') }), s.title || t('(no task description yet)')),
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what + (s.requests.length > 1 ? t(' ({n} requests)', { n: s.requests.length }) : '') }),
      ageSpan(s, d),
    ),
    s.waiting?.risky && el('div', { className: 'warn', textContent: t('Risky command, confirm on its own') }),
    d.detail && el('div', { className: 'peek', textContent: d.detail.split('\n')[0] }),
    triageLine(s),
    s.overlap && el('div', { className: 'warn', textContent: t('Same file as {who}: {file}', { who: s.overlap.with[0], file: s.overlap.file }) }),
    s.state === 'review' && checkLine(s),
    s.pr && el('div', { className: `pr ${prTone(s.pr)}`, textContent: prLine(s.pr) }),
    s.quiet && el('div', { className: 'warn', textContent: t('No activity for over 10 minutes') }),
  );
}

// The same permission request open in several sessions: one decision for all.
// Drastic-looking commands are never batched.
function batches(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const w = s.waiting;
    if (s.state !== 'needs_input' || w?.kind !== 'permission' || !w.decidable || w.risky || !w.tool || !w.detail) continue;
    const k = `${w.tool}\n${w.detail}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }
  const exact = [...groups.values()].filter((g) => g.length > 1);
  // What is left may still be the same kind of command with different
  // arguments ("git push origin <branch>"): offer those as one decision too.
  const taken = new Set(exact.flat().map((s) => s.key));
  const kinds = new Map();
  for (const s of sessions) {
    const w = s.waiting;
    if (taken.has(s.key) || s.state !== 'needs_input' || w?.kind !== 'permission' || !w.decidable || w.risky || !w.stem) continue;
    const k = `${w.tool}\n${w.stem}`;
    (kinds.get(k) || kinds.set(k, []).get(k)).push(s);
  }
  const alike = [...kinds.values()].filter((g) => g.length > 2).map((g) => Object.assign(g, { stem: g[0].waiting.stem }));
  return [...exact, ...alike].sort((a, b) => b.length - a.length);
}

// Sessions that stopped at the usage limit are one event, not N failures.
const limited = (sessions) => sessions.filter((s) => s.state === 'failed' && s.rate_limited);
function limitCard(group) {
  const can = group.filter((s) => s.reply);
  const each = (list, fn) => Promise.allSettled(list.map(fn));
  return el('div', { className: 'card batch', dataset: { tone: 'urgent' } },
    el('div', { className: 'status' }, el('span', { className: 'what', textContent: t('{n} sessions stopped at the usage limit', { n: group.length }) })),
    el('div', { className: 'meta', textContent: t('Nothing is wrong with the work. When the limit resets they can pick up where they stopped.') }),
    el('div', { className: 'actions' },
      can.length > 0 && el('button', { className: 'primary', textContent: t('Tell {n} to continue', { n: can.length }), title: t('Sends “continue” to the ones the board can reach. Use it once the limit has reset.'),
        onclick: async () => {
          const out = await each(can, (s) => call(`/api/sessions/${encodeURIComponent(s.key)}/message`, { text: t('Continue where you left off.'), command_id: crypto.randomUUID() }));
          toast(t('Sent to {n} session(s).', { n: out.filter((r) => r.status === 'fulfilled').length }));
        } }),
      el('button', { textContent: t('Acknowledge all ({n})', { n: group.length }), onclick: async () => {
        await each(group, (s) => call(`/api/sessions/${encodeURIComponent(s.key)}/ack`, {}));
        toast(t('Acknowledged {n}.', { n: group.length }), () => each(group, (s) => call(`/api/sessions/${encodeURIComponent(s.key)}/unack`, {})));
      } })));
}

async function decideBatch(group, decision, remember = false) {
  try {
    const out = await call('/api/requests/batch', { ids: group.map((s) => s.waiting.id), decision, remember });
    pinned = false;
    toast(out.rule ? (out.rule.mode === 'prefix'
      ? t('Handled {n}. “{cmd} …” commands are now allowed automatically.', { n: out.decided, cmd: out.rule.detail })
      : t('Handled {n}. This command is now allowed automatically.', { n: out.decided })) : t('Handled {n}.', { n: out.decided }),
      out.rule && (() => fetch(api('/api/rules'), { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out.rule) })));
  } catch (err) {
    say(selected, err.message);
  }
}

function batchCard(group) {
  const w = group[0].waiting;
  const repos = [...new Set(group.map(repoOf))];
  if (group.stem) {
    const rule = { tool: w.tool, detail: group.stem, mode: 'prefix' };
    const cmds = [...new Set(group.map((s) => s.waiting.detail.split('\n')[0]))];
    return el('div', { className: 'card batch', dataset: { tone: 'urgent' } },
      el('div', { className: 'status' }, el('span', { className: 'what', textContent: t('{n} sessions are asking for the same kind of command: {tool}', { n: group.length, tool: w.tool }) })),
      el('div', { className: 'peek code', textContent: `${group.stem} …` }),
      el('ul', { className: 'cmds' }, cmds.slice(0, 4).map((c) => el('li', { textContent: c })), cmds.length > 4 && el('li', { textContent: t('…and {n} more', { n: cmds.length - 4 }) })),
      el('div', { className: 'actions' },
        el('button', { className: 'primary', textContent: t('Allow all ({n})', { n: group.length }), onclick: () => decideBatch(group, 'allow') }),
        el('button', { textContent: t('Allow all, and auto-allow this kind from now on'), title: t('From now on “{stem} ” with any arguments is allowed automatically; commands with ; | && or risky forms still ask. Undo in “Auto rules”.', { stem: group.stem }), onclick: () => decideBatch(group, 'allow', rule) }),
        el('button', { className: 'danger', textContent: t('Deny all'), onclick: () => decideBatch(group, 'deny') }),
      ));
  }
  return el('div', { className: 'card batch', dataset: { tone: 'urgent' } },
    el('div', { className: 'status' }, el('span', { className: 'what', textContent: t('{n} sessions are asking for the same thing: {tool}', { n: group.length, tool: w.tool }) })),
    el('div', { className: 'peek code', textContent: w.detail.split('\n')[0] }),
    el('div', { className: 'meta', textContent: repos.length > 4 ? t('{list} and others ({n} projects)', { list: repos.slice(0, 4).join(t(', ')), n: repos.length }) : repos.join(t(', ')) }),
    el('div', { className: 'actions' },
      el('button', { className: 'primary', textContent: t('Allow all ({n})', { n: group.length }), onclick: () => decideBatch(group, 'allow') }),
      el('button', { textContent: t('Allow all, and auto-allow from now on'), title: t('Applies to this exact command only. Undo in “Auto rules”.'), onclick: () => decideBatch(group, 'allow', true) }),
      el('button', { className: 'danger', textContent: t('Deny all'), onclick: () => decideBatch(group, 'deny') }),
    ));
}

function grouped() {
  const rank = new Map(snap.queue.map((k, i) => [k, i]));
  const groups = { attention: [], review: [], working: [], rest: [] };
  for (const s of visible()) groups[column(s)].push(s);
  groups.attention.sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
  groups.review.sort((a, b) => a.since - b.since);
  groups.working.sort((a, b) => Number(b.quiet) - Number(a.quiet) || a.since - b.since);
  groups.rest.sort((a, b) => b.last_event_ts - a.last_event_ts);
  return groups;
}

const rollup = (list) => {
  const by = new Map();
  for (const s of list) by.set(repoOf(s), (by.get(repoOf(s)) || 0) + 1);
  const top = [...by].sort((a, b) => b[1] - a[1]);
  return top.slice(0, 8).map(([r, n]) => `${r} ${n}`).join(' · ') + (top.length > 8 ? t(' · {n} more projects', { n: top.length - 8 }) : '');
};

function renderLists(groups) {
  const shown = stack(groups);
  const lists = $('#lists');
  if (!lists.children.length) {
    lists.replaceChildren(...GROUPS.map(([name, label, hint]) =>
      el('div', { className: 'group', dataset: { col: name } },
        el('h2', {}, el('button', {
          className: 'fold', type: 'button', onclick: () => { prefs.set(`fold:${name}`, folded(name) ? '0' : '1'); render(); },
        }, el('span', { className: 'caret' }), label, el('span', { className: 'count' }))),
        el('p', { className: 'hint', textContent: hint }),
        el('p', { className: 'rollup' }),
        el('div', { className: 'cards' }))));
  }
  for (const [name] of GROUPS) {
    const sec = $(`.group[data-col="${name}"]`, lists);
    const list = shown[name];
    const fold = folded(name) && list.length > 0;
    sec.dataset.folded = String(fold);
    $('.count', sec).textContent = list.length || '';
    $('.fold', sec).setAttribute('aria-expanded', String(!fold));
    $('.rollup', sec).textContent = fold ? rollup(groups[name]) : '';
    const items = fold ? [] : list.map((e) => (e.task
      ? { key: e.task, sig: e.members.map(cardSig).join('|'), make: () => taskCard(e) }
      : { key: e.key, sig: cardSig(e), make: () => card(e) }));
    if (name === 'attention' && !fold) {
      items.unshift(...batches(groups.attention).map((g) => ({
        key: `batch:${g[0].waiting.tool}:${g.stem ? `kind:${g.stem}` : g[0].waiting.detail}`, sig: g.map((s) => s.waiting.id).join(','), make: () => batchCard(g),
      })));
    }
    if (name === 'attention' && !fold && limited(groups.attention).length > 1) {
      const g = limited(groups.attention);
      items.unshift({ key: 'limit', sig: g.map((s) => `${s.key}${s.reply}`).join(','), make: () => limitCard(g) });
    }
    if (!items.length && !fold) {
      items.push({ key: 'empty', sig: `${name}:${filter}`, make: () => el('div', {
        className: 'empty', textContent: filter ? t('No matching sessions.') : name === 'attention' ? t('Nobody is waiting for you.') : '—' }) });
    }
    reconcile($('.cards', sec), items);
  }
}

// ----------------------------------------------------------------- office --
// The same snapshot drawn as a room. Positions follow state only:
//   at its own desk        -> working / idle (nothing for you to do)
//   queued at your desk    -> needs you; the queue order is the attention order
//   paper in your in-tray  -> finished, waiting for review
// Desks are grouped into one room per project. Past a couple of dozen
// sessions the desks shrink to a compact grid: you read the rooms' totals and
// the queue, not a hundred nameplates.

const SPRITE = `<svg viewBox="0 0 22 26" aria-hidden="true">
  <rect x="10" y="0" width="2" height="3" fill="#8a8f96"/><rect x="9" y="0" width="4" height="1" fill="#8a8f96"/>
  <rect x="5" y="3" width="12" height="9" fill="#d5d8dc"/><rect x="6" y="5" width="10" height="4" fill="#2b2f36"/>
  <rect class="eye" x="8" y="6" width="2" height="2"/><rect class="eye" x="12" y="6" width="2" height="2"/>
  <rect class="body" x="5" y="13" width="12" height="8"/>
  <rect class="body arm-l" x="2" y="14" width="2" height="6"/><rect class="body arm-r" x="18" y="14" width="2" height="6"/>
  <rect class="leg-l" x="6" y="21" width="4" height="5" fill="#4a4e55"/><rect class="leg-r" x="12" y="21" width="4" height="5" fill="#4a4e55"/>
</svg>`;
const DESK = `<svg viewBox="0 0 60 32" aria-hidden="true">
  <g class="smoke" fill="#8a8f96"><rect x="27" y="0" width="3" height="3"/><rect x="31" y="3" width="2" height="2"/></g>
  <rect x="20" y="6" width="20" height="13" fill="#5b6068"/><rect class="screen" x="22" y="8" width="16" height="9"/>
  <rect x="28" y="19" width="4" height="3" fill="#5b6068"/>
  <rect x="2" y="22" width="56" height="5" fill="#b08a5e"/><rect x="5" y="27" width="4" height="5" fill="#8a6a45"/><rect x="51" y="27" width="4" height="5" fill="#8a6a45"/>
</svg>`;
const MY_DESK = `<svg width="150" height="70" viewBox="0 0 75 35" aria-hidden="true">
  <rect x="0" y="14" width="75" height="7" fill="#8a6a45"/><rect x="4" y="21" width="5" height="14" fill="#6d5236"/><rect x="66" y="21" width="5" height="14" fill="#6d5236"/>
  <rect x="48" y="6" width="22" height="8" fill="none" stroke="#5b6068" stroke-width="2"/>
</svg>`;

const ROOMY = { w: 150, h: 128, seat: { x: 4, y: 2 } };
const COMPACT = { w: 62, h: 52, seat: { x: 0, y: 4 } };
const COMPACT_OVER = 16; // more sessions than this: compact desks
const ROOM = { head: 26, pad: 8, gap: 12 };
const LOBBY = 150; // height of the strip in front of your desk
const QUEUE = { w: 84, h: 114 }; // one standing place in the queue
const QUEUE_ROWS = 2; // the queue never takes more rows than this
const agentNodes = new Map();

const bubbleFor = (s) => {
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? t('Needs permission') : s.waiting?.kind === 'pr' ? prWhat(s.waiting.detail) : t('Has a question');
  if (s.state === 'failed') return s.rate_limited ? t('Rate limited') : t('Hit an error');
  if (s.state === 'unknown') return t('Lost');
  return null;
};

function renderOffice() {
  const office = $('#office');
  const floor = $('.floor', office);
  const present = visible().filter((s) => s.state !== 'ended');
  const width = Math.max(320, office.clientWidth - 38);
  const compact = present.length > COMPACT_OVER;
  const cell = compact ? COMPACT : ROOMY;
  floor.classList.toggle('compact', compact);

  // Rooms: one per project, biggest first, packed left to right.
  const byRepo = new Map();
  for (const s of present) (byRepo.get(repoOf(s)) || byRepo.set(repoOf(s), []).get(repoOf(s))).push(s);
  const rooms = [...byRepo].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const maxCols = Math.max(2, Math.floor((width - 16 - 2 * ROOM.pad) / cell.w));
  const seat = new Map();
  const desks = [];
  const roomBoxes = [];
  let x = 12;
  let y = 12;
  let rowH = 0;
  for (const [repo, list] of rooms) {
    list.sort((a, b) => a.created_ts - b.created_ts);
    const cols = Math.min(maxCols, Math.max(compact ? 3 : 1, Math.ceil(Math.sqrt(list.length * (compact ? 2.2 : 1.6)))));
    const rows = Math.ceil(list.length / cols);
    const w = cols * cell.w + 2 * ROOM.pad;
    const h = ROOM.head + rows * cell.h + ROOM.pad;
    if (x > 12 && x + w > width) { x = 12; y += rowH + ROOM.gap; rowH = 0; }
    const n = (col) => list.filter((s) => column(s) === col).length;
    roomBoxes.push({ repo, x, y, w, h, wait: n('attention'), review: n('review'), work: n('working'), total: list.length });
    list.forEach((s, i) => {
      const dx = x + ROOM.pad + (i % cols) * cell.w;
      const dy = y + ROOM.head + Math.floor(i / cols) * cell.h;
      seat.set(s.key, { x: dx + cell.seat.x, y: dy + cell.seat.y });
      desks.push({ s, x: dx, y: dy });
    });
    x += w + ROOM.gap;
    rowH = Math.max(rowH, h);
  }
  const lobbyTop = y + rowH + 14;

  // The queue stands beside your desk, wraps when the room is narrow (on a
  // phone it forms up above the desk), and is capped: beyond the cap, agents
  // wait at their desks with a flag and the queue ends in "+N".
  const queue = snap.queue.map(byKey).filter((s) => s && column(s) === 'attention' && matches(s));
  const narrow = width < 560;
  const queueX = narrow ? 34 : 300;
  const perRow = Math.max(1, Math.floor((width - queueX - 8) / QUEUE.w));
  const cap = perRow * QUEUE_ROWS - (queue.length > perRow * QUEUE_ROWS ? 1 : 0);
  const queued = new Map(queue.slice(0, cap).map((s, i) => [s.key, i]));
  const overflow = queue.length - queued.size;
  const queueRows = Math.max(1, Math.ceil((queued.size + (overflow ? 1 : 0)) / perRow));
  const lobby = LOBBY + (queueRows - 1) * QUEUE.h + (narrow && queue.length ? QUEUE.h + 30 : 0);
  // Your desk and the queue go at the top: with a hundred desks below, the one
  // part of the room that needs you must not be a scroll away.
  for (const r of roomBoxes) r.y += lobby;
  for (const d of desks) d.y += lobby;
  for (const p of seat.values()) p.y += lobby;
  const height = Math.max(lobbyTop + lobby, office.clientHeight - 60);
  floor.style.height = `${height}px`;
  const myY = lobby - 92;
  const queueSlot = (q) => ({
    x: queueX + (q % perRow) * QUEUE.w,
    y: myY - 2 - (narrow ? QUEUE.h : 0) - (queueRows - 1 - Math.floor(q / perRow)) * QUEUE.h,
  });
  const waitingAtDesk = new Set(queue.slice(cap).map((s) => s.key));

  // Static scenery: rooms, the lobby, labels.
  const more = overflow ? queueSlot(queued.size) : null;
  $('.scene', floor).replaceChildren(...[
    el('div', { className: 'zone', style: `top:0;height:${lobby}px` }),
    el('div', { className: 'zone-label', style: 'left:14px;top:6px', textContent: t('At your desk: queued for you') }),
    ...roomBoxes.map((r) => el('div', { className: 'room', style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` },
      el('div', { className: 'room-label' },
        el('b', { textContent: r.repo }),
        r.wait > 0 && el('span', { className: 'n wait', textContent: t('{n} waiting', { n: r.wait }) }),
        r.review > 0 && el('span', { className: 'n review', textContent: t('{n} to review', { n: r.review }) }),
        el('span', { className: 'n', textContent: t('{n}/{total} working', { n: r.work, total: r.total }) })))),
    more && el('button', {
      className: 'queue-more', type: 'button', style: `left:${more.x}px;top:${more.y + 6}px`,
      textContent: `+${overflow}`, title: t('{n} more are waiting for you, holding up signs at their desks', { n: overflow }), onclick: () => setView('inbox'),
    }),
    !present.length && el('div', { className: 'empty-office', textContent: filter ? t('No matching sessions.') : t('Nobody is in the office yet. Start any Claude Code or Codex session and it will walk in by itself.') }),
  ].filter(Boolean));

  // Desks, keyed so that only changed ones are rebuilt.
  reconcile($('.desks', floor), desks.map(({ s, x: dx, y: dy }) => {
    const d = describe(s);
    const flag = waitingAtDesk.has(s.key) ? ['wait', '!'] : s.state === 'review' ? ['done', compact ? '✓' : t('Done')]
      : s.quiet ? ['quiet', compact ? '…' : t('Quiet for long')] : !compact && s.subagents > 0 ? ['', t('+{n} helpers', { n: s.subagents })] : null;
    return {
      key: s.key,
      sig: JSON.stringify([dx, dy, compact, s.state, queued.has(s.key), flag, s.title, s.agent, s.repo, s.runtime, d.what]),
      make: () => {
        const node = el('button', {
            className: 'desk', type: 'button', style: `left:${dx}px;top:${dy}px`, title: t('{a}: {b}', { a: s.title || s.session_id, b: d.what }),
            dataset: { state: s.state, away: String(queued.has(s.key)) }, onclick: () => select(s.key, true),
          },
          flag && el('span', { className: `flag ${flag[0]}`, textContent: flag[1] }));
        node.insertAdjacentHTML('beforeend', DESK);
        if (!compact) {
          node.append(el('span', { className: 'plate' }, s.title || t('(no task yet)'),
            el('small', { textContent: [s.runtime === 'cloud' ? t('Cloud') : null, agentName(s)].filter(Boolean).join(' · ') })));
        }
        return node;
      },
    };
  }));

  // Your desk, with the in-tray of finished work.
  const reviews = present.filter((s) => s.state === 'review').sort((a, b) => a.since - b.since);
  const you = $('.you', floor);
  you.style.cssText = `left:18px;top:${myY}px`;
  you.innerHTML = MY_DESK;
  you.append(...[
    el('div', { className: 'plate', textContent: t('You') }),
    el('div', { className: 'tray', style: 'left:96px;bottom:54px' },
      reviews.slice(0, 5).map((s) => el('button', {
        className: 'paper', type: 'button', title: t('To review: {title}', { title: s.title || s.session_id }),
        ariaLabel: t('To review: {title}', { title: s.title || s.session_id }), ariaCurrent: String(s.key === selected), onclick: () => select(s.key, true),
      })),
      reviews.length > 5 && el('span', { className: 'paper more', textContent: `+${reviews.length - 5}` })),
    reviews.length > 0 && el('div', { className: 'tray-label', style: 'left:96px;bottom:86px', textContent: t('To review {n}', { n: reviews.length }) }),
  ].filter(Boolean));

  // Agents: kept across renders so moving between desk and queue animates.
  const layer = $('.agents', floor);
  const alive = new Set(present.map((s) => s.key));
  for (const [key, node] of agentNodes) {
    if (!alive.has(key)) { node.remove(); agentNodes.delete(key); }
  }
  for (const s of present) {
    const d = describe(s);
    const q = queued.get(s.key);
    const pos = q === undefined ? seat.get(s.key) : queueSlot(q);
    let node = agentNodes.get(s.key);
    const target = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
    if (!node) {
      node = el('button', { className: 'agent', type: 'button', onclick: () => select(s.key, true) });
      node.innerHTML = `<span class="ring"></span>${SPRITE}`;
      node.append(el('span', { className: 'bubble' }), el('span', { className: 'tag' }));
      node.addEventListener('transitionend', () => node.classList.remove('walking'));
      node.style.transform = `translate(${width + 20}px, ${Math.round(pos.y)}px)`; // walks in from the door
      layer.append(node);
      agentNodes.set(s.key, node);
      node.getBoundingClientRect(); // commit the start position before moving
    }
    if (node.style.transform !== target) {
      node.classList.add('walking');
      node.style.transform = target;
    }
    const sig = [s.agent, d.tone, s.state, q !== undefined, compact && q === undefined, s.key === selected, s.title, d.what, bubbleFor(s), s.since].join('|');
    if (node.dataset.sig === sig) continue;
    Object.assign(node.dataset, { sig, agent: s.agent, tone: d.tone, state: s.state, queued: String(q !== undefined), small: String(compact && q === undefined) });
    node.setAttribute('aria-current', String(s.key === selected));
    node.setAttribute('aria-label', t('{agent}: {title}, {what}', { agent: agentName(s), title: s.title || s.session_id, what: d.what }));
    node.title = t('{a}: {b}', { a: s.title || s.session_id, b: d.what });
    const label = q === undefined ? null : bubbleFor(s);
    $('.bubble', node).replaceChildren(...(label ? [label, el('small', { className: 'age', dataset: { since: s.since, verb: 'waited {age}' }, textContent: ageText('waited {age}', s.since) })] : []));
    $('.tag', node).textContent = s.title || s.session_id;
  }
}

// -------------------------------------------------------------- workbench --

// ---- review: evidence first, then the changes file by file ----
const CHECK_NAME = { test: 'tests', types: 'type check', lint: 'lint', build: 'build' };
function evidence(s) {
  const tests = s.checks?.filter((c) => c.kind === 'test') || [];
  const lastTest = tests.at(-1);
  return el('div', { className: 'evidence' },
    (s.checks || []).map((c) => el('span', { className: `check ${c.ok ? 'ok' : 'bad'}`, title: c.cmd },
      `${c.ok ? '✓' : '✗'} ${t(CHECK_NAME[c.kind])} · ${t('{age} ago', { age: age(c.ts) })}`)),
    !lastTest && el('span', { className: 'check none', textContent: t('No test run seen in this session') }),
    lastTest && s.last_edit_ts > lastTest.ts && el('span', { className: 'check bad', textContent: t('Edited again after the last test run') }));
}

function briefBlock(s, b) {
  if (!b) return null;
  const parts = [
    b.turns && t('{n} new instruction(s) from you', { n: b.turns }),
    b.tools && t('{n} tool calls', { n: b.tools }),
    b.failed_commands && t('{n} failed command(s)', { n: b.failed_commands }),
    b.requests && t('{n} request(s) to you ({a} allowed, {d} denied, {r} by rule)', { n: b.requests, a: b.allowed, d: b.denied, r: b.by_rule }),
    b.compactions && t('context compacted {n} time(s): it may have forgotten early details', { n: b.compactions }),
  ].filter(Boolean);
  const asked = b.first_prompt && b.first_prompt !== s.last_prompt ? b.first_prompt : null;
  if (!parts.length && !asked) return null;
  return el('div', { className: 'brief' },
    asked && el('div', {}, el('b', { textContent: t('Originally asked: ') }), el('span', { className: 'prose', textContent: asked })),
    parts.length > 0 && el('div', {}, el('b', { textContent: b.since ? t('Since you last looked: ') : t('So far: ') }), parts.join(' · ')));
}

function conflictBlock(s, conflicts) {
  return el('div', {},
    s.overlap && el('div', { className: 'warn' }, t('Also being edited by {n} other live session(s) ({who}): {file}{more}', {
      n: s.overlap.sessions, who: s.overlap.with.join(', '), file: s.overlap.file, more: s.overlap.files > 1 ? t(' and {n} more file(s)', { n: s.overlap.files - 1 }) : '' })),
    (conflicts || []).map((c) => el('div', { className: 'warn' },
      t('Would conflict when merged with branch {branch} ({who}): {files}', { branch: c.branch, who: c.with.join(', '), files: c.files.join(', ') || '?' }))));
}

function reviewPanel(s, diff, scope) {
  if (!diff?.available) return null;
  const mark = (f, on) => call(`/api/sessions/${encodeURIComponent(s.key)}/viewed`, { path: f.path, hash: on ? f.hash : null })
    .then(() => { reviewTick += 1; render(); }).catch((e) => say(s.key, e.message));
  const files = diff.files || [];
  const done = files.filter((f) => f.viewed).length;
  // Split the unified diff into one block per file.
  const blocks = new Map();
  for (const part of (diff.diff || '').split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/.* b\/(.*)$/m.exec(part);
    if (m) blocks.set(m[1], part);
  }
  const SCOPES = [
    ['since', t('Since it started'), t('Everything that changed in the working tree since this session began, shell commands included. Other sessions in the same folder show up too.')],
    ['session', t('Its own edits'), t('Only files this session’s edit tools touched. Misses what it changed through shell commands.')],
    ['all', t('Whole workspace'), t('Everything uncommitted, whoever changed it.')],
  ];
  return el('div', { className: 'review' },
    el('h3', { textContent: t('Review') }),
    evidence(s),
    el('div', { className: 'actions', style: 'margin-top:8px' },
      el('div', { className: 'seg' }, SCOPES.map(([id, label, tip]) => el('button', {
        textContent: label, title: tip, ariaPressed: String(diff.scope === id),
        onclick: () => { scopes.set(s.key, id); render(); },
      }))),
      scope === 'since' && diff.scope !== 'since' && el('span', { className: 'note', textContent: t('No snapshot from when it started, showing the whole workspace.') }),
      files.length > 0 && el('span', { className: 'note', textContent: t('{done} of {n} files reviewed', { done, n: files.length }) })),
    !files.length && el('p', { className: 'note', textContent: t('No changes.') }),
    files.map((f) => el('details', { className: 'file', open: !f.viewed && files.length <= 12 },
      el('summary', {},
        el('input', { type: 'checkbox', checked: f.viewed, title: t('Mark as reviewed'), onclick: (e) => { e.stopPropagation(); mark(f, e.target.checked); } }),
        el('code', { textContent: f.path }),
        f.changed_since_viewed && el('span', { className: 'check bad', textContent: t('changed since you reviewed it') }),
        s.reply && el('button', { className: 'mini', textContent: t('Comment'), title: t('Start a reply about this file'), onclick: (e) => {
          e.preventDefault();
          drafts.set(s.key, `${drafts.get(s.key) ? drafts.get(s.key) + '\n' : ''}${f.path}: `);
          render();
          setTimeout(() => $('#reply')?.focus(), 30);
        } })),
      blocks.has(f.path) ? diffView(blocks.get(f.path)) : el('p', { className: 'note', textContent: t('(binary or too large to show)') }))),
    diff.truncated && el('p', { className: 'note', textContent: t('The diff was too long and is cut off.') }));
}

function diffView(diff) {
  const cls = (l) =>
    l.startsWith('diff --git') ? 'file' : l.startsWith('@@') ? 'hunk'
      : l.startsWith('+') && !l.startsWith('+++') ? 'add'
        : l.startsWith('-') && !l.startsWith('---') ? 'del' : '';
  return el('pre', { className: 'diff' }, diff.split('\n').map((l) => el('span', { className: cls(l), textContent: l || ' ' })));
}

function replyBox(s) {
  if (!s.reply) {
    if (s.reply_blocked) return el('p', { className: 'note', textContent: t('Its terminal is stopped on the request above: anything typed there now would be taken as the answer to it. Handle the request first, then reply.') });
    if (s.runtime === 'cloud' || !s.local) return el('p', { className: 'note', textContent: t('This session is not on this machine; reply from its own interface.') });
    return el('div', {},
      el('p', { className: 'note', textContent: t('It runs in a terminal the board cannot type into (not tmux). Sessions started inside tmux can be replied to from here.') }),
      el('div', { className: 'actions' },
        el('button', { textContent: t('Copy attach command'), title: resumeCommand(s), onclick: (e) => copy(resumeCommand(s), e.currentTarget) })),
    );
  }
  const area = el('textarea', {
    id: 'reply', placeholder: t('Tell it what to do next…'), value: drafts.get(s.key) || '',
    oninput: (e) => drafts.set(s.key, e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(s); } },
  });
  return el('div', { className: 'reply' }, area,
    el('div', { className: 'actions' },
      el('button', { className: 'primary', textContent: t('Send'), onclick: () => send(s) }),
      el('span', { className: 'note', textContent: (s.reply === 'tmux'
        ? t('Goes straight into its tmux window.') : t('Its process has exited: this resumes the same session for another round in the background.')) + t(' Ctrl/⌘ + Enter to send') }),
    ));
}

function questionForm(s) {
  const id = s.waiting.id;
  const mine = picks.get(id) || picks.set(id, {}).get(id);
  const single = s.waiting.questions.length === 1 && !s.waiting.questions[0].multiSelect;
  return el('div', { className: 'questions' }, s.waiting.questions.map((q, i) => {
    const p = (mine[q.question] ||= { chosen: new Set(), other: '' });
    return el('fieldset', {},
      el('legend', { textContent: q.question }),
      q.multiSelect && el('div', { className: 'note', textContent: t('Multiple choice') }),
      el('div', { className: 'options' }, q.options.map((o) => el('button', {
        type: 'button', className: 'option', ariaPressed: String(p.chosen.has(o.label)),
        onclick: () => {
          if (q.multiSelect) p.chosen.has(o.label) ? p.chosen.delete(o.label) : p.chosen.add(o.label);
          else { p.chosen.clear(); p.chosen.add(o.label); p.other = ''; }
          if (single) answer(s); else render();
        },
      }, el('b', { textContent: o.label }), o.description && el('span', { textContent: o.description })))),
      el('input', {
        id: `other-${id}-${i}`, type: 'text', placeholder: t('Or write your own answer…'), value: p.other,
        oninput: (e) => { p.other = e.target.value; if (!q.multiSelect && p.other) p.chosen.clear(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(s); } },
      }),
    );
  }));
}

// Accept by task: all its sessions at once, or adopt one version and file the rest.
async function ackTask(s, adopt) {
  try {
    const out = await call(`/api/tasks/${encodeURIComponent(s.task.id)}/ack`, adopt ? { adopt } : {});
    const undo = () => Promise.all([
      ...out.archived.map((k) => call(`/api/sessions/${encodeURIComponent(k)}/unarchive`, {})),
      ...out.acked.map((k) => call(`/api/sessions/${encodeURIComponent(k)}/unack`, {})),
    ]);
    toast(adopt ? t('Adopted this version: accepted {a}, archived the other {b}.', { a: out.acked.length, b: out.archived.length }) : t('Accepted {n} sessions of this task.', { n: out.acked.length }), undo);
    advance(s.key);
  } catch (err) {
    say(s.key, err.message);
  }
}

function taskStrip(s) {
  const group = siblings(s);
  if (!s.task || group.length < 2) return null;
  const reviewable = group.filter((m) => ['review', 'failed', 'unknown'].includes(m.state));
  return el('div', { className: 'taskstrip' },
    el('div', { className: 'note', textContent: t('{n} sessions of the same task (same instruction or same branch). Click a row to switch, compare them one by one, then accept by task.', { n: group.length }) }),
    el('div', { className: 'members' }, group.map((m) => {
      const d = describe(m);
      return el('button', { className: 'member wide', type: 'button', dataset: { tone: d.tone }, ariaCurrent: String(m.key === s.key), onclick: () => select(m.key, true) },
        el('span', { className: `badge ${m.agent}`, textContent: agentName(m) }),
        el('span', { className: 'what', textContent: d.what }),
        el('span', { className: 'facts', textContent: [m.branch, m.files_count ? t('{n} files changed', { n: m.files_count }) : null, m.pr && prLine(m.pr), m.usage?.cost_usd != null ? `$${m.usage.cost_usd.toFixed(2)}` : null].filter(Boolean).join(' · ') }));
    })),
    el('div', { className: 'actions' },
      s.state === 'review' && el('button', { className: 'primary', textContent: t('Adopt this one, archive the rest'), title: t('Accept this session and archive the task’s other stopped sessions; ones still working are left alone'), onclick: () => ackTask(s, s.key) }),
      reviewable.length > 0 && el('button', { textContent: t('Accept all ({n})', { n: reviewable.length }), onclick: () => ackTask(s) }),
      el('button', { textContent: t('Split this session off'), title: t('It is actually a different task'), onclick: () => call(`/api/sessions/${encodeURIComponent(s.key)}/task`, { join: null }).catch((e) => say(s.key, e.message)) }),
    ));
}

function nowBlock(s, d) {
  const asking = s.state === 'needs_input' && s.waiting.kind === 'question';
  const form = asking && s.waiting.decidable && s.waiting.questions?.length;
  const kids = [
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what }),
      el('span', { className: 'age', textContent: ageText(d.verb, s.since) })),
    !form && d.detail && el('div', { className: `box${d.code ? ' code' : ' prose'}`, textContent: d.detail }),
    form && questionForm(s),
    s.triage && el('div', { className: `triage big ${s.triage.suggestion}` },
      el('b', { textContent: SUGGEST[s.triage.suggestion] || t('Triage note') }), s.triage.summary,
      el('span', { className: 'note', textContent: t(' Advice from the triage agent, not a decision') })),
  ];
  const actions = el('div', { className: 'actions' });
  if (s.state === 'needs_input' && s.waiting.kind === 'pr') {
    actions.append(...[
      s.reply && s.pr && el('button', {
        className: 'primary', textContent: t('Have it fix this'), title: prFixText(s),
        onclick: () => { drafts.set(s.key, prFixText(s)); send(s); },
      }),
      s.pr && el('button', { textContent: t('Open PR'), onclick: () => window.open(s.pr.url, '_blank', 'noreferrer') }),
      el('button', { textContent: t('Got it (E)'), title: t('Leave it for now; the same problem will not remind you again'), onclick: () => ack(s) }),
    ].filter(Boolean));
  } else if (form) {
    actions.append(
      el('button', { className: 'primary', textContent: t('Answer'), onclick: () => answer(s) }),
      el('button', { textContent: t('Hand back to terminal'), title: t('Do not answer here; let it ask in its own terminal'), onclick: () => decide(s, 'terminal') }),
    );
  } else if (asking) {
    actions.append(el('span', { className: 'note', textContent: t('This question can only be answered in its own terminal right now.') }));
  } else if (s.state === 'needs_input' && s.waiting.kind === 'permission') {
    if (s.waiting.decidable) {
      actions.append(
        el('button', { className: 'primary', textContent: t('Allow (A)'), onclick: () => decide(s, 'allow') }),
        el('button', { className: 'danger', textContent: t('Deny (D)'), onclick: () => decide(s, 'deny') }),
        s.waiting.tool && el('button', { textContent: t('Allow {tool} for this session', { tool: s.waiting.tool }), onclick: () => decide(s, 'allow', true) }),
        el('button', { textContent: t('Hand back to terminal'), title: t('Do not decide here; let it ask in its own terminal'), onclick: () => decide(s, 'terminal') }),
      );
      // Decide it for every session, now and later.
      if (!s.waiting.risky && s.waiting.tool && s.waiting.detail) {
        const always = (rule, label) => call('/api/rules', rule)
          .then(() => { toast(t('{label} will be allowed automatically in every session from now on.', { label }), () => fetch(api('/api/rules'), { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rule) })); advance(s.key); })
          .catch((e) => say(s.key, e.message));
        kids.push(el('div', { className: 'actions rules-row' },
          el('span', { className: 'note', textContent: t('Auto-allow in every session from now on:') }),
          el('button', { textContent: t('This one'), title: s.waiting.detail, onclick: () => always({ tool: s.waiting.tool, detail: s.waiting.detail, mode: 'exact' }, t('this command')) }),
          s.waiting.stem && el('button', { textContent: `${s.waiting.stem} …`, title: t('With any arguments; commands with ; | && or risky forms still ask'), onclick: () => always({ tool: s.waiting.tool, detail: s.waiting.stem, mode: 'prefix' }, `“${s.waiting.stem} …”`) }),
        ));
      }
    } else {
      actions.append(el('span', { className: 'note', textContent: t('This request can only be answered in its own terminal right now (the board was not open when it was sent, or it was handed back).') }));
    }
  } else if (s.state === 'review') {
    actions.append(el('button', { className: 'primary', textContent: t('Accepted (E)'), onclick: () => ack(s) }));
  } else if (s.state === 'failed' || s.state === 'unknown') {
    actions.append(el('button', { className: 'primary', textContent: t('Got it (E)'), onclick: () => ack(s) }));
  } else if (column(s) === 'rest') {
    actions.append(el('button', { textContent: t('Archive'), onclick: () => archive(s) }));
  }
  // Not now: out of the queue until later, back early if it needs you.
  const deferrable = !s.snoozed && (s.state === 'review' || s.state === 'failed' || s.state === 'unknown' || s.waiting?.kind === 'pr');
  if (deferrable) {
    actions.append(
      el('button', { textContent: t('In 1 hour'), onclick: () => snooze(s, { minutes: 60 }, t('1 hour from now')) }),
      el('button', { textContent: t('Tomorrow morning'), onclick: () => snooze(s, { until: tomorrow() }, t('tomorrow 9:00')) }),
      el('button', { textContent: t('Mark unread'), title: t('Keep it in the queue, look again later'), onclick: () => markUnread(s) }),
    );
  }
  if (s.snoozed) actions.append(el('button', { className: 'primary', textContent: t('Handle now'), onclick: () => call(`/api/sessions/${encodeURIComponent(s.key)}/unsnooze`, {}).catch((e) => say(s.key, e.message)) }));
  if (s.quiet) kids.push(el('div', { className: 'warn', textContent: t('No activity for {age}: the process is still there; it may be on a long task or stuck.', { age: age(s.last_event_ts) }) }));
  if (s.requests.length > 1) kids.push(el('div', { className: 'note', textContent: t('{n} more requests are queued behind this one.', { n: s.requests.length - 1 }) }));
  if (actions.childNodes.length) kids.push(actions);
  return el('div', { className: 'now', dataset: { tone: d.tone } }, kids);
}

function renderBench() {
  const bench = $('#bench');
  let s = byKey(selected);
  if (!s) {
    bench.replaceChildren(el('div', { className: 'blank' },
      el('b', { textContent: snap.sessions.length ? t('Nobody is waiting for you') : t('No sessions yet') }),
      snap.sessions.length ? t('Pick a session on the left to look at it, or go do something else: it shows up here by itself when someone needs you.')
        : t('Start any Claude Code or Codex session and it will show up here by itself.')));
    return;
  }
  const row = s;
  const more = extra.get(row.key) || {};
  // The row carries clipped text; the detail request brings the rest.
  const detail = more.full || {};
  s = { ...row, files: detail.files || [], auto_allow: detail.auto_allow || [],
    last_prompt: detail.last_prompt ?? row.last_prompt, last_message: detail.last_message ?? row.last_message };
  const d = describe(s);
  // Typing must survive live re-renders.
  const active = document.activeElement;
  const typing = active?.id && active.matches('input[type="text"], textarea')
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const scope = scopeOf(s);

  const diff = more.diff;
  const changed = diff?.available && (diff.status || diff.diff);
  bench.replaceChildren(...[
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: agentName(s) }),
      el('span', { className: 'where', textContent: [where(s), t('turn {n}', { n: s.turns }), usageLine(s)].filter(Boolean).join(' · ') }),
      s.runtime === 'cloud' && el('span', { textContent: t('☁ Cloud') })),
    el('h2', {}, s.title || s.session_id, el('button', { className: 'mini', textContent: t('Rename'), onclick: () => {
      const title = prompt(t('Name this session'), s.title || '');
      if (title?.trim()) call(`/api/sessions/${encodeURIComponent(s.key)}/rename`, { title }).catch((e) => say(s.key, e.message));
    } })),
    s.pr && el('p', { className: `pr ${prTone(s.pr)}` },
      el('a', { href: s.pr.url, target: '_blank', rel: 'noreferrer', textContent: prLine(s.pr) }),
      s.pr.title ? `　${s.pr.title}` : '', s.pr.base ? ` → ${s.pr.base}` : ''),
    notice?.key === s.key && el('div', { className: 'warn', textContent: notice.text }),
    taskStrip(s),
    nowBlock(s, d),

    s.last_prompt && el('h3', { textContent: t('What you said last') }),
    s.last_prompt && el('div', { className: 'prose', textContent: s.last_prompt }),
    s.last_message && s.state !== 'review' && el('h3', { textContent: t('What it said last') }),
    s.last_message && s.state !== 'review' && el('div', { className: 'prose', textContent: s.last_message }),

    briefBlock(s, detail.brief),
    conflictBlock(s, detail.conflicts),
    reviewPanel(s, diff, scope),

    el('h3', { textContent: t('Reply') }),
    s.outgoing && el('div', { className: s.undelivered ? 'warn' : 'note' },
      s.undelivered
        ? t('The message you sent has not been received yet ({why}):', { why: s.outgoing.via === 'tmux' ? t('its terminal may be stopped on another prompt, take a look') : t('the background process may not have started') })
        : t('Sent, waiting for it to receive:'),
      el('span', { className: 'prose', textContent: ` ${s.outgoing.text}` })),
    replyBox(s),

    s.auto_allow.length > 0 && el('h3', { textContent: t('Tools auto-allowed in this session') }),
    s.auto_allow.length > 0 && el('div', {}, s.auto_allow.map((tool) =>
      el('span', { className: 'chip' }, tool, el('button', {
        textContent: '✕', title: t('Stop auto-allowing'),
        onclick: () => call(`/api/sessions/${encodeURIComponent(s.key)}/rule`, { tool, allow: false }).catch((e) => say(s.key, e.message)),
      })))),

    more.events && el('details', {},
      el('summary', { textContent: t('Event log (latest {n})', { n: more.events.length }) }),
      el('ul', { className: 'timeline' }, more.events.filter((e) => e.type !== 'meta.updated').map((e) => {
        const x = e.data || {};
        return el('li', {}, el('time', { textContent: new Date(e.ts).toLocaleTimeString() }),
          el('span', { textContent: [e.type, x.tool, x.kind, x.decision, x.by, x.source, x.reason, x.error, e.late && t('(late, not used)')].filter(Boolean).join(' · ') }));
      }))),
  ].filter(Boolean));

  if (typing) {
    const field = document.getElementById(typing.id);
    if (field) { field.focus(); field.setSelectionRange(typing.start, typing.end); }
  }
}

// Diff and event history are fetched when a session is opened and again
// whenever it changes state.
// The default cut of the diff: everything since the session began, unless it
// shares its directory with another live session, where that would mix them.
const sharesDir = (s) => snap.sessions.some((o) => o.key !== s.key && o.cwd === s.cwd && o.host === s.host && o.state !== 'ended');
const scopeOf = (s) => scopes.get(s.key) || (sharesDir(s) && s.files_count ? 'session' : 'since');
const openedAt = new Map(); // key -> the seen mark when the session was opened, for "since you last looked"

async function loadExtra(s) {
  const scope = scopeOf(s);
  const sig = `${s.state}:${s.last_event_ts}:${scope}:${reviewTick}`;
  const have = extra.get(s.key);
  if (have?.sig === sig) return;
  extra.set(s.key, { ...have, sig });
  if (!openedAt.has(s.key)) openedAt.set(s.key, s.seen_ts || 0);
  const key = encodeURIComponent(s.key);
  const [diff, events, full] = await Promise.all([
    call(`/api/sessions/${key}/diff?scope=${scope}`).catch(() => null),
    call(`/api/sessions/${key}/events`).catch(() => null),
    call(`/api/sessions/${key}/detail?since=${openedAt.get(s.key)}`).catch(() => null),
  ]);
  extra.set(s.key, { sig, diff, events, full });
  if (selected === s.key) render();
}
let reviewTick = 0; // bumped when a file is marked reviewed, to refetch the diff

// Looking at a session marks it seen (stored by the hub, so every device
// agrees), but only after a moment and only while the page is in view.
let reading = null;
function noteReading() {
  const s = byKey(selected);
  const want = s?.unseen && !document.hidden && $('#app').dataset.view !== 'board' ? s.key : null;
  if (reading?.key === want) return;
  clearTimeout(reading?.timer);
  reading = want && { key: want, timer: setTimeout(() => {
    if (selected === want && !document.hidden) call(`/api/sessions/${encodeURIComponent(want)}/seen`, {}).catch(() => {});
  }, 1500) };
}
document.addEventListener('visibilitychange', () => noteReading());

function select(key, byHuman) {
  selected = key;
  if (byHuman) {
    pinned = true;
    if ($('#app').dataset.view === 'board') setView('inbox'); // the board has no workbench
  }
  render();
  $(`.card[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
}

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; paint(); });
}

function paint() {
  if (wanted && all.has(wanted)) {
    selected = wanted;
    pinned = true;
    wanted = null;
    history.replaceState(null, '', location.pathname + location.search);
    if ($('#app').dataset.view === 'board') setView('inbox');
  }
  // Follow the queue until the human picks something; never yank a session
  // they chose out from under them.
  const current = byKey(selected);
  if (!current || (!pinned && column(current) !== 'attention' && snap.queue.length)) {
    selected = snap.queue[0] || (current ? selected : snap.sessions[0]?.key) || null;
    if (!current) pinned = false;
  }
  const groups = grouped();
  const office = $('#app').dataset.view === 'office';
  if (office) renderOffice(); else renderLists(groups);
  const s = byKey(selected);
  // The workbench is rebuilt only when what it shows has changed.
  const more = extra.get(selected) || {};
  const benchSig = JSON.stringify([s, reviewTick, more.diff?.files, more.full?.brief, more.full?.conflicts, s && siblings(s).map((m) => [m.key, m.state, m.since, m.files_count, m.pr]), more.sig, !!more.diff, !!more.events, !!more.full, notice, scopes.get(selected), snap.sessions.length > 0]);
  if (benchSig !== paint.bench) { paint.bench = benchSig; renderBench(); }
  if (s) loadExtra(s);
  noteReading();

  const count = { attention: 0, review: 0, working: 0 };
  for (const x of snap.sessions) if (column(x) in count) count[column(x)] += 1;
  $('#summary').replaceChildren(
    count.attention ? el('b', { textContent: t('{n} waiting for you', { n: count.attention }) }) : t('Nothing is waiting for you'),
    t(', {r} to review, {w} working', { r: count.review, w: count.working }),
    filter ? t(' (filtered: showing {v} / {t})', { v: visible().length, t: snap.sessions.length }) : '',
    snap.burn ? el('span', { className: 'burn', title: t('What the agents report having spent, added up. It is what was used, not what is left: the board does not know your limits.'),
      textContent: t(' · ${usd} in the last {h}h across {n} session(s)', { usd: snap.burn.usd.toFixed(2), h: snap.burn.hours, n: snap.burn.sessions }) }) : '',
  );
  $('#rules').textContent = t('Auto rules {n}', { n: snap.rules || 0 });
  document.title = `${count.attention ? `(${count.attention}) ` : ''}Session Board`;
}

// ---------------------------------------------------------- notifications --

function alertNew(sessions) {
  for (const s of sessions) {
    const sig = `${s.state}:${s.waiting?.kind || ''}:${s.since}`;
    const before = seen.get(s.key);
    seen.set(s.key, sig);
    if (before === undefined || before === sig) continue;
    // Only interrupt for things that block the agent. Finished work is
    // batchable: it shows up in the count, not as a popup.
    if (column(s) !== 'attention') continue;
    const d = describe(s);
    if (prefs.get('sound') === '1') beep();
    if (prefs.get('notify') === '1' && document.hidden && Notification.permission === 'granted') {
      const n = new Notification(`${s.title || s.session_id}`, { body: `${d.what}${d.detail ? '\n' + d.detail : ''}`, tag: s.key });
      n.onclick = () => { window.focus(); select(s.key, true); };
    }
  }
}

let audio;
function beep() {
  try {
    audio ||= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.35);
  } catch { /* audio blocked until first interaction */ }
}

// ------------------------------------------------------------------- wiring --

function setView(view) {
  $('#app').dataset.view = view;
  $('#view-inbox').setAttribute('aria-pressed', String(view === 'inbox'));
  $('#view-board').setAttribute('aria-pressed', String(view === 'board'));
  $('#view-office').setAttribute('aria-pressed', String(view === 'office'));
  prefs.set('view', view);
  render();
}

function connect() {
  const es = new EventSource(api('/api/stream'));
  const conn = $('#conn');
  es.onopen = () => { conn.textContent = t('Live'); conn.className = 'conn ok'; };
  es.onerror = () => { conn.textContent = t('Disconnected, reconnecting…'); conn.className = 'conn bad'; };
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.sessions) { // full picture, on (re)connect
      all.clear();
      for (const s of msg.sessions) all.set(s.key, s);
    } else { // delta
      for (const s of msg.changed) all.set(s.key, s);
      for (const key of msg.removed) all.delete(key);
    }
    snap = { now: msg.now, sessions: [...all.values()], queue: msg.queue, rules: msg.rules, burn: msg.burn };
    skew = snap.now - Date.now();
    alertNew(msg.sessions ? snap.sessions : msg.changed);
    render();
  };
}

$('#view-inbox').onclick = () => setView('inbox');
$('#view-board').onclick = () => setView('board');
$('#view-office').onclick = () => setView('office');
addEventListener('resize', render);
$('#backfill').onclick = async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    const out = await call('/api/backfill', { days: 7 });
    button.textContent = out.imported ? t('Imported {n}', { n: out.imported }) : t('No new past sessions');
  } catch (err) {
    button.textContent = err.message;
  }
  setTimeout(() => { button.textContent = t('Import history'); button.disabled = false; }, 2500);
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.id === 'filter') { e.target.value = ''; filter = ''; e.target.blur(); return render(); }
  if (e.target.matches('input[type="text"], input[type="search"], textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = byKey(selected);
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); return $('#filter').focus(); }
  if (k === 'n') {
    if (!snap.queue.length) return;
    const i = snap.queue.indexOf(selected);
    select(snap.queue[(i + 1) % snap.queue.length], true);
  } else if (!s) {
    return;
  } else if (k === 'a' && s.waiting?.decidable) decide(s, 'allow');
  else if (k === 'd' && s.waiting?.decidable) decide(s, 'deny');
  else if (k === 'e' && (['review', 'failed', 'unknown'].includes(s.state) || s.waiting?.kind === 'pr')) ack(s);
  else if (k === 'r' && $('#reply')) { e.preventDefault(); $('#reply').focus(); }
});

$('#filter').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); render(); };

// Standing rules: commands that are approved automatically in every session.
$('#rules').onclick = async () => {
  const dialog = $('#rules-dialog');
  const show = (rules) => $('article', dialog).replaceChildren(
    el('h3', { textContent: t('Auto rules') }),
    el('p', { className: 'note', textContent: t('Commands that match are allowed automatically whenever any session asks. A rule is either one exact command or a kind of command with any arguments. Commands joined with ; | && never match a “kind” rule, and anything that looks risky is always confirmed one by one.') }),
    rules.length ? el('ul', { className: 'rules' }, rules.map((r) => el('li', {},
      el('code', { textContent: `${r.tool}: ${r.detail}${r.mode === 'prefix' ? t(' … (any arguments)') : ''}` }),
      el('button', { textContent: t('Undo'), onclick: async () => show(await fetch(api('/api/rules'), {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }).then((x) => x.json())) }))))
      : el('p', { className: 'empty', textContent: t('No rules yet.') }),
    el('div', { className: 'actions' }, el('button', { textContent: t('Close'), onclick: () => dialog.close() })));
  show(await call('/api/rules'));
  dialog.showModal();
};

// Settings: currently just the language.
$('#settings').onclick = () => {
  const dialog = $('#settings-dialog');
  const pick = el('select', { id: 'lang-select', onchange: (e) => { setLangPref(e.target.value); location.reload(); } },
    ...[['auto', t('Follow system')], ['en', 'English'], ['zh', '简体中文']].map(([value, label]) => el('option', { value, textContent: label, selected: value === langPref() })));
  $('article', dialog).replaceChildren(
    el('h3', { textContent: t('Settings') }),
    el('label', { className: 'setting' }, el('span', { textContent: t('Language') }), pick),
    el('p', { className: 'note', textContent: t('Language changes apply right away. “Follow system” uses your browser’s language: Chinese if it is Chinese, English otherwise.') }),
    el('div', { className: 'actions' }, el('button', { textContent: t('Close'), onclick: () => dialog.close() })));
  dialog.showModal();
};

for (const id of ['notify', 'sound']) {
  const box = $(`#${id}`);
  box.checked = prefs.get(id) === '1';
  box.onchange = async () => {
    if (id === 'notify' && box.checked && Notification.permission !== 'granted') {
      box.checked = (await Notification.requestPermission()) === 'granted';
    }
    if (id === 'sound' && box.checked) beep();
    prefs.set(id, box.checked ? '1' : '0');
  };
}
// Tell the hub whether anyone is looking, so it knows when to push to a phone.
const presence = () => fetch(api('/api/presence'), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visible: !document.hidden }), keepalive: true,
}).catch(() => {});
document.addEventListener('visibilitychange', presence);
setInterval(() => !document.hidden && presence(), 30_000);
presence();

// A link from a notification opens that session: /#<session key>
let wanted = decodeURIComponent(location.hash.slice(1)) || null;
addEventListener('hashchange', () => { wanted = decodeURIComponent(location.hash.slice(1)) || null; render(); });

translatePage();
setView(['board', 'office'].includes(prefs.get('view')) ? prefs.get('view') : 'inbox');
setInterval(tickAges, 5000); // waiting timers tick without re-rendering anything // keep timers ticking
connect();
