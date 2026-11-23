// The board is a pure render of the hub's snapshot; all state lives server-side.
// Layout: a list of sessions on the left, and on the right one "workbench"
// where the selected session can be read, answered, reviewed and replied to
// without leaving the page.
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
  if (!res.ok) throw new Error(out.error || `请求失败 (${res.status})`);
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
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 86400)} 天`;
}
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
    return { ...describeState(s), tone: 'rest', what: `稍后处理（到 ${at}）` };
  }
  return describeState(s);
}

function describeState(s) {
  switch (s.state) {
    case 'needs_input':
      if (s.waiting?.kind === 'pr') {
        return { tone: 'urgent', what: prWhat(s.waiting.detail), detail: s.pr ? `PR #${s.pr.number}　${s.pr.title || ''}` : null, verb: '已' };
      }
      return s.waiting?.kind === 'permission'
        ? { tone: 'urgent', what: `要权限${s.waiting.tool ? '：' + s.waiting.tool : ''}`, detail: s.waiting.detail, code: true, verb: '已等' }
        : { tone: 'urgent', what: '在问你', detail: s.waiting?.detail, verb: '已等' };
    case 'failed':
      return { tone: 'urgent', what: s.rate_limited ? '被限流或额度用完，停下了' : '出错停下了', detail: s.error, verb: '已停' };
    case 'unknown':
      return { tone: 'urgent', what: '失联：找不到它的进程了', detail: s.error, verb: '已' };
    case 'review':
      return { tone: 'review', what: s.exited ? '做完并退出了，待验收' : '做完了，待验收', detail: s.last_message, verb: '已等' };
    case 'working':
      if (s.background) return { tone: 'working', what: `等它自己的后台任务（${s.background}）`, detail: s.last_message, verb: '已' };
      return {
        tone: 'working',
        what: s.current_tool ? `在用 ${s.current_tool.tool}` : '在想',
        detail: s.current_tool?.detail || s.last_prompt,
        code: !!s.current_tool?.detail,
        verb: '已',
      };
    case 'ended':
      return { tone: 'rest', what: s.settled === 'merged' ? '已合并，自动算作验收' : s.imported ? '历史会话（导入）' : '已结束', detail: s.last_message, verb: '' };
    default:
      return { tone: 'rest', what: s.settled === 'merged' ? '已合并，自动算作验收' : '空闲，等你派活', detail: s.last_message, verb: '已' };
  }
}

const where = (s) => [s.host, s.repo || (s.cwd || '').split('/').pop(), s.branch].filter(Boolean).join(' · ');
const agentName = (s) => (s.agent === 'claude' ? 'Claude' : s.agent === 'codex' ? 'Codex' : s.agent);
const resumeCommand = (s) => {
  const cd = s.cwd ? `cd ${JSON.stringify(s.cwd)} && ` : '';
  return s.agent === 'claude' ? `${cd}claude --resume ${s.session_id}` : `${cd}codex resume ${s.session_id}`;
};
const prWhat = (problem) => ({ checks: 'PR 检查失败', review: 'PR 被要求修改', 'checks+review': 'PR 检查失败，并被要求修改' }[problem] || 'PR 需要处理');
const prFixText = (s) => `PR #${s.pr.number} ${{ checks: '的检查失败了，请查看失败原因', review: '被评审要求修改，请查看评审意见', 'checks+review': '的检查失败了，并且被评审要求修改，请查看失败原因和评审意见' }[s.waiting.detail] || '需要处理，请查看'}，修好后推送。`;
const PR_STATE = { open: '开着', merged: '已合并', closed: '已关闭（未合并）' };
const PR_CHECKS = { passing: '检查通过', failing: '检查失败', pending: '检查进行中' };
const PR_REVIEW = { approved: '已批准', changes_requested: '要求修改', review_required: '等评审' };
const prLine = (pr) => [
  `PR #${pr.number}`, pr.draft && pr.state === 'open' ? '草稿' : PR_STATE[pr.state],
  pr.state === 'open' ? PR_CHECKS[pr.checks] : null, pr.state === 'open' ? PR_REVIEW[pr.review] : null,
].filter(Boolean).join(' · ');
const prTone = (pr) => (pr.state === 'merged' ? 'ok' : pr.checks === 'failing' || pr.review === 'changes_requested' ? 'bad' : '');
const usageLine = (s) => {
  const u = s.usage;
  if (!u) return null;
  return [
    u.model,
    u.context_tokens ? `上下文 ${tokens(u.context_tokens)}` : null,
    u.output_tokens ? `输出 ${tokens(u.output_tokens)}` : null,
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
  if (Object.keys(answers).length < s.waiting.questions.length) return say(s.key, '每个问题都要选一个或填一个答案。');
  return act(s, () => call(`/api/requests/${s.waiting.id}`, { decision: 'answer', answers }));
};
// Every filing action can be taken back for a few seconds.
let toastTimer = 0;
function toast(text, undo) {
  const box = $('#toast');
  clearTimeout(toastTimer);
  box.replaceChildren(text, ...(undo ? [el('button', { textContent: '撤销', onclick: async () => { box.hidden = true; await undo().catch(() => {}); } })] : []));
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}
const file = (s, verb, reverse, text, body = {}) => act(s, async () => {
  const k = encodeURIComponent(s.key);
  await call(`/api/sessions/${k}/${verb}`, body);
  toast(text, () => call(`/api/sessions/${k}/${reverse}`, {}).then(() => select(s.key, true)));
});
const ack = (s) => file(s, 'ack', 'unack', s.state === 'review' ? '已验收。' : '已知悉。');
const archive = (s) => file(s, 'archive', 'unarchive', '已归档。');
const tomorrow = () => { const d = new Date(Date.now() + skew); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); };
const snooze = (s, body, label) => file(s, 'snooze', 'unsnooze', `已推迟到${label}。期间它有新情况会提前回来。`, body);
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
    button.textContent = '已复制';
    setTimeout(() => (button.textContent = old), 1200);
  });
}

// ------------------------------------------------------------------ lists --
// Built for hundreds of sessions: cards are keyed and only the ones whose
// content changed are rebuilt; the groups that need nothing from you fold
// into a per-project summary; identical requests are offered as one decision.

const GROUPS = [
  ['attention', '等你回应', '权限、提问、失败、失联、PR 出问题。越靠上越该先处理。'],
  ['review', '待验收', 'agent 说做完了，你还没看。'],
  ['working', '工作中', '不需要你，除非它安静太久。'],
  ['rest', '空闲 / 已结束', '等你派下一件事，或已退出。'],
];
const MANY = 12; // past this many sessions, the working group starts folded

let filter = '';
const repoOf = (s) => s.repo || (s.cwd || '').split('/').pop() || '(未知项目)';
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
  className: 'age', dataset: { since: s.since, verb: d.verb }, textContent: d.verb ? `${d.verb} ${age(s.since)}` : `${age(s.since)}前`,
});
function tickAges() {
  for (const n of document.querySelectorAll('.age[data-since]')) {
    const since = Number(n.dataset.since);
    n.textContent = n.dataset.verb ? `${n.dataset.verb} ${age(since)}` : `${age(since)}前`;
  }
}

const cardSig = (s) => JSON.stringify([
  s.state, s.since, s.title, s.host, s.repo, s.cwd, s.branch, s.runtime, s.agent, s.subagents, s.requests.length,
  s.waiting && [s.waiting.kind, s.waiting.tool, s.waiting.detail, s.waiting.risky],
  s.current_tool, s.background, s.quiet, s.pr, s.error, s.exited, s.settled, s.imported, s.rate_limited,
  s.state === 'working' ? s.last_prompt?.slice(0, 90) : s.last_message?.slice(0, 90), s.key === selected,
  s.unseen, s.snoozed && s.snoozed_until, column(s),
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
      s.runtime === 'cloud' && el('span', { textContent: '云端' }),
      s.subagents > 0 && el('span', { textContent: `${s.subagents} 个子 agent` }),
    ),
    el('div', { className: 'title' }, s.unseen && el('span', { className: 'dot', title: '还没看过' }), s.title || '(还没有任务描述)'),
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what + (s.requests.length > 1 ? `（共 ${s.requests.length} 个请求）` : '') }),
      ageSpan(s, d),
    ),
    s.waiting?.risky && el('div', { className: 'warn', textContent: '高风险命令，请单独确认' }),
    d.detail && el('div', { className: 'peek', textContent: d.detail.split('\n')[0] }),
    s.pr && el('div', { className: `pr ${prTone(s.pr)}`, textContent: prLine(s.pr) }),
    s.quiet && el('div', { className: 'warn', textContent: '超过 10 分钟没有任何动静' }),
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
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}

async function decideBatch(group, decision, remember = false) {
  try {
    const out = await call('/api/requests/batch', { ids: group.map((s) => s.waiting.id), decision, remember });
    pinned = false;
    say(selected, out.rule ? `已处理 ${out.decided} 个，以后这条命令自动允许。` : `已处理 ${out.decided} 个。`);
  } catch (err) {
    say(selected, err.message);
  }
}

function batchCard(group) {
  const w = group[0].waiting;
  const repos = [...new Set(group.map(repoOf))];
  return el('div', { className: 'card batch', dataset: { tone: 'urgent' } },
    el('div', { className: 'status' }, el('span', { className: 'what', textContent: `${group.length} 个会话在请求同一件事：${w.tool}` })),
    el('div', { className: 'peek code', textContent: w.detail.split('\n')[0] }),
    el('div', { className: 'meta', textContent: repos.slice(0, 4).join('、') + (repos.length > 4 ? ` 等 ${repos.length} 个项目` : '') }),
    el('div', { className: 'actions' },
      el('button', { className: 'primary', textContent: `全部允许（${group.length}）`, onclick: () => decideBatch(group, 'allow') }),
      el('button', { textContent: '全部允许，以后也自动允许', title: '只对完全相同的这条命令生效，可在“自动规则”里撤销', onclick: () => decideBatch(group, 'allow', true) }),
      el('button', { className: 'danger', textContent: '全部拒绝', onclick: () => decideBatch(group, 'deny') }),
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
  return top.slice(0, 8).map(([r, n]) => `${r} ${n}`).join(' · ') + (top.length > 8 ? ` · 另有 ${top.length - 8} 个项目` : '');
};

function renderLists(groups) {
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
    const list = groups[name];
    const fold = folded(name) && list.length > 0;
    sec.dataset.folded = String(fold);
    $('.count', sec).textContent = list.length || '';
    $('.fold', sec).setAttribute('aria-expanded', String(!fold));
    $('.rollup', sec).textContent = fold ? rollup(list) : '';
    const items = fold ? [] : list.map((s) => ({ key: s.key, sig: cardSig(s), make: () => card(s) }));
    if (name === 'attention' && !fold) {
      items.unshift(...batches(list).map((g) => ({
        key: `batch:${g[0].waiting.tool}:${g[0].waiting.detail}`, sig: g.map((s) => s.waiting.id).join(','), make: () => batchCard(g),
      })));
    }
    if (!items.length && !fold) {
      items.push({ key: 'empty', sig: `${name}:${filter}`, make: () => el('div', {
        className: 'empty', textContent: filter ? '没有匹配的会话。' : name === 'attention' ? '没有人在等你。' : '—' }) });
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
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? '要权限' : s.waiting?.kind === 'pr' ? prWhat(s.waiting.detail) : '有问题问你';
  if (s.state === 'failed') return s.rate_limited ? '被限流了' : '出错了';
  if (s.state === 'unknown') return '失联';
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
    el('div', { className: 'zone-label', style: 'left:14px;top:6px', textContent: '你的桌前：排队等你的' }),
    ...roomBoxes.map((r) => el('div', { className: 'room', style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` },
      el('div', { className: 'room-label' },
        el('b', { textContent: r.repo }),
        r.wait > 0 && el('span', { className: 'n wait', textContent: `${r.wait} 等你` }),
        r.review > 0 && el('span', { className: 'n review', textContent: `${r.review} 待验收` }),
        el('span', { className: 'n', textContent: `${r.work}/${r.total} 在干活` })))),
    more && el('button', {
      className: 'queue-more', type: 'button', style: `left:${more.x}px;top:${more.y + 6}px`,
      textContent: `+${overflow}`, title: `还有 ${overflow} 个在等你，在各自工位上举着牌子`, onclick: () => setView('inbox'),
    }),
    !present.length && el('div', { className: 'empty-office', textContent: filter ? '没有匹配的会话。' : '办公室里还没有人。启动任意一个 Claude Code 或 Codex 会话，它会自己走进来。' }),
  ].filter(Boolean));

  // Desks, keyed so that only changed ones are rebuilt.
  reconcile($('.desks', floor), desks.map(({ s, x: dx, y: dy }) => {
    const d = describe(s);
    const flag = waitingAtDesk.has(s.key) ? ['wait', '!'] : s.state === 'review' ? ['done', compact ? '✓' : '做完了']
      : s.quiet ? ['quiet', compact ? '…' : '很久没动静'] : !compact && s.subagents > 0 ? ['', `+${s.subagents} 帮手`] : null;
    return {
      key: s.key,
      sig: JSON.stringify([dx, dy, compact, s.state, queued.has(s.key), flag, s.title, s.agent, s.repo, s.runtime, d.what]),
      make: () => {
        const node = el('button', {
            className: 'desk', type: 'button', style: `left:${dx}px;top:${dy}px`, title: `${s.title || s.session_id}：${d.what}`,
            dataset: { state: s.state, away: String(queued.has(s.key)) }, onclick: () => select(s.key, true),
          },
          flag && el('span', { className: `flag ${flag[0]}`, textContent: flag[1] }));
        node.insertAdjacentHTML('beforeend', DESK);
        if (!compact) {
          node.append(el('span', { className: 'plate' }, s.title || '(还没有任务)',
            el('small', { textContent: [s.runtime === 'cloud' ? '云端' : null, agentName(s)].filter(Boolean).join(' · ') })));
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
    el('div', { className: 'plate', textContent: '你' }),
    el('div', { className: 'tray', style: 'left:96px;bottom:54px' },
      reviews.slice(0, 5).map((s) => el('button', {
        className: 'paper', type: 'button', title: `待验收：${s.title || s.session_id}`,
        ariaLabel: `待验收：${s.title || s.session_id}`, ariaCurrent: String(s.key === selected), onclick: () => select(s.key, true),
      })),
      reviews.length > 5 && el('span', { className: 'paper more', textContent: `+${reviews.length - 5}` })),
    reviews.length > 0 && el('div', { className: 'tray-label', style: 'left:96px;bottom:86px', textContent: `待验收 ${reviews.length}` }),
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
    node.setAttribute('aria-label', `${agentName(s)}：${s.title || s.session_id}，${d.what}`);
    node.title = `${s.title || s.session_id}：${d.what}`;
    const label = q === undefined ? null : bubbleFor(s);
    $('.bubble', node).replaceChildren(...(label ? [label, el('small', { className: 'age', dataset: { since: s.since, verb: '等了' }, textContent: `等了 ${age(s.since)}` })] : []));
    $('.tag', node).textContent = s.title || s.session_id;
  }
}

// -------------------------------------------------------------- workbench --

function diffView(diff) {
  const cls = (l) =>
    l.startsWith('diff --git') ? 'file' : l.startsWith('@@') ? 'hunk'
      : l.startsWith('+') && !l.startsWith('+++') ? 'add'
        : l.startsWith('-') && !l.startsWith('---') ? 'del' : '';
  return el('pre', { className: 'diff' }, diff.split('\n').map((l) => el('span', { className: cls(l), textContent: l || ' ' })));
}

function replyBox(s) {
  if (!s.reply) {
    if (s.reply_blocked) return el('p', { className: 'note', textContent: '它的终端正停在上面那个请求上：现在往里打字会被当成对那个请求的回答，所以先处理请求，再回复。' });
    if (s.runtime === 'cloud' || !s.local) return el('p', { className: 'note', textContent: '这个会话不在本机上，只能在它自己的界面里回复。' });
    return el('div', {},
      el('p', { className: 'note', textContent: '它开在一个看板没法输入的终端里（不是 tmux）。在 tmux 里启动的会话可以直接从这里回复。' }),
      el('div', { className: 'actions' },
        el('button', { textContent: '复制接入命令', title: resumeCommand(s), onclick: (e) => copy(resumeCommand(s), e.currentTarget) })),
    );
  }
  const area = el('textarea', {
    id: 'reply', placeholder: '告诉它下一步做什么…', value: drafts.get(s.key) || '',
    oninput: (e) => drafts.set(s.key, e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(s); } },
  });
  return el('div', { className: 'reply' }, area,
    el('div', { className: 'actions' },
      el('button', { className: 'primary', textContent: '发送', onclick: () => send(s) }),
      el('span', { className: 'note', textContent: (s.reply === 'tmux'
        ? '会直接打进它所在的 tmux 窗口。' : '它的进程已退出：会在后台接着同一个会话再跑一轮。') + ' Ctrl/⌘ + Enter 发送' }),
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
      q.multiSelect && el('div', { className: 'note', textContent: '可以多选' }),
      el('div', { className: 'options' }, q.options.map((o) => el('button', {
        type: 'button', className: 'option', ariaPressed: String(p.chosen.has(o.label)),
        onclick: () => {
          if (q.multiSelect) p.chosen.has(o.label) ? p.chosen.delete(o.label) : p.chosen.add(o.label);
          else { p.chosen.clear(); p.chosen.add(o.label); p.other = ''; }
          if (single) answer(s); else render();
        },
      }, el('b', { textContent: o.label }), o.description && el('span', { textContent: o.description })))),
      el('input', {
        id: `other-${id}-${i}`, type: 'text', placeholder: '或者自己写一个答案…', value: p.other,
        oninput: (e) => { p.other = e.target.value; if (!q.multiSelect && p.other) p.chosen.clear(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(s); } },
      }),
    );
  }));
}

function nowBlock(s, d) {
  const asking = s.state === 'needs_input' && s.waiting.kind === 'question';
  const form = asking && s.waiting.decidable && s.waiting.questions?.length;
  const kids = [
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what }),
      el('span', { className: 'age', textContent: d.verb ? `${d.verb} ${age(s.since)}` : `${age(s.since)}前` })),
    !form && d.detail && el('div', { className: `box${d.code ? ' code' : ' prose'}`, textContent: d.detail }),
    form && questionForm(s),
  ];
  const actions = el('div', { className: 'actions' });
  if (s.state === 'needs_input' && s.waiting.kind === 'pr') {
    actions.append(...[
      s.reply && s.pr && el('button', {
        className: 'primary', textContent: '让它去修', title: prFixText(s),
        onclick: () => { drafts.set(s.key, prFixText(s)); send(s); },
      }),
      s.pr && el('button', { textContent: '打开 PR', onclick: () => window.open(s.pr.url, '_blank', 'noreferrer') }),
      el('button', { textContent: '知道了 (E)', title: '先不管；同一个问题不会再提醒', onclick: () => ack(s) }),
    ].filter(Boolean));
  } else if (form) {
    actions.append(
      el('button', { className: 'primary', textContent: '回答', onclick: () => answer(s) }),
      el('button', { textContent: '交回终端', title: '不在这里回答，让它在自己的终端里问你', onclick: () => decide(s, 'terminal') }),
    );
  } else if (asking) {
    actions.append(el('span', { className: 'note', textContent: '这个提问现在只能在它自己的终端里回答。' }));
  } else if (s.state === 'needs_input' && s.waiting.kind === 'permission') {
    if (s.waiting.decidable) {
      actions.append(
        el('button', { className: 'primary', textContent: '允许 (A)', onclick: () => decide(s, 'allow') }),
        el('button', { className: 'danger', textContent: '拒绝 (D)', onclick: () => decide(s, 'deny') }),
        s.waiting.tool && el('button', { textContent: `本会话都允许 ${s.waiting.tool}`, onclick: () => decide(s, 'allow', true) }),
        el('button', { textContent: '交回终端', title: '不在这里决定，让它在自己的终端里问你', onclick: () => decide(s, 'terminal') }),
      );
    } else {
      actions.append(el('span', { className: 'note', textContent: '这个请求现在只能在它自己的终端里回答（它发出时看板没开着，或已被交回终端）。' }));
    }
  } else if (s.state === 'review') {
    actions.append(el('button', { className: 'primary', textContent: '已验收 (E)', onclick: () => ack(s) }));
  } else if (s.state === 'failed' || s.state === 'unknown') {
    actions.append(el('button', { className: 'primary', textContent: '知道了 (E)', onclick: () => ack(s) }));
  } else if (column(s) === 'rest') {
    actions.append(el('button', { textContent: '归档', onclick: () => archive(s) }));
  }
  // Not now: out of the queue until later, back early if it needs you.
  const deferrable = !s.snoozed && (s.state === 'review' || s.state === 'failed' || s.state === 'unknown' || s.waiting?.kind === 'pr');
  if (deferrable) {
    actions.append(
      el('button', { textContent: '1 小时后再说', onclick: () => snooze(s, { minutes: 60 }, ' 1 小时后') }),
      el('button', { textContent: '明早再说', onclick: () => snooze(s, { until: tomorrow() }, '明早 9 点') }),
      el('button', { textContent: '标为未读', title: '保持在队列里，稍后再看', onclick: () => markUnread(s) }),
    );
  }
  if (s.snoozed) actions.append(el('button', { className: 'primary', textContent: '现在处理', onclick: () => call(`/api/sessions/${encodeURIComponent(s.key)}/unsnooze`, {}).catch((e) => say(s.key, e.message)) }));
  if (s.quiet) kids.push(el('div', { className: 'warn', textContent: `${age(s.last_event_ts)} 没有任何动静：进程还在，可能在跑长任务，也可能卡住了。` }));
  if (s.requests.length > 1) kids.push(el('div', { className: 'note', textContent: `后面还有 ${s.requests.length - 1} 个请求在排队。` }));
  if (actions.childNodes.length) kids.push(actions);
  return el('div', { className: 'now', dataset: { tone: d.tone } }, kids);
}

function renderBench() {
  const bench = $('#bench');
  let s = byKey(selected);
  if (!s) {
    bench.replaceChildren(el('div', { className: 'blank' },
      el('b', { textContent: snap.sessions.length ? '没有人在等你' : '还没有会话' }),
      snap.sessions.length ? '从左边选一个会话查看，或者去做别的事：有人需要你时这里会自动出现。'
        : '启动任意一个 Claude Code 或 Codex 会话，它会自动出现在这里。'));
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
  const scope = scopes.get(s.key) || (s.files_count ? 'session' : 'all');

  const diff = more.diff;
  const changed = diff?.available && (diff.status || diff.diff);
  bench.replaceChildren(...[
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: agentName(s) }),
      el('span', { className: 'where', textContent: [where(s), `第 ${s.turns} 轮`, usageLine(s)].filter(Boolean).join(' · ') }),
      s.runtime === 'cloud' && el('span', { textContent: '☁ 云端' })),
    el('h2', { textContent: s.title || s.session_id }),
    s.pr && el('p', { className: `pr ${prTone(s.pr)}` },
      el('a', { href: s.pr.url, target: '_blank', rel: 'noreferrer', textContent: prLine(s.pr) }),
      s.pr.title ? `　${s.pr.title}` : '', s.pr.base ? ` → ${s.pr.base}` : ''),
    notice?.key === s.key && el('div', { className: 'warn', textContent: notice.text }),
    nowBlock(s, d),

    s.last_prompt && el('h3', { textContent: '你上一次说的' }),
    s.last_prompt && el('div', { className: 'prose', textContent: s.last_prompt }),
    s.last_message && s.state !== 'review' && el('h3', { textContent: '它上一次说的' }),
    s.last_message && s.state !== 'review' && el('div', { className: 'prose', textContent: s.last_message }),

    diff?.available && el('h3', {}, diff.scope === 'session'
      ? `这个会话改过的 ${diff.attributed} 个文件（相对上一次提交；它用命令行改的不在内）`
      : '整个工作区的改动（相对上一次提交，不只是这个会话改的）'),
    diff?.available && s.files_count > 0 && el('div', { className: 'actions', style: 'margin-top:0' },
      el('button', { textContent: scope === 'session' ? '看整个工作区' : '只看这个会话改的', onclick: () => { scopes.set(s.key, scope === 'session' ? 'all' : 'session'); render(); } })),
    diff?.available && !changed && el('p', { className: 'note', textContent: '没有未提交的改动。' }),
    changed && el('div', { className: 'box code', textContent: [diff.stat, diff.status].filter(Boolean).join('\n\n') }),
    changed && diff.diff && el('details', { open: s.state === 'review' },
      el('summary', { textContent: diff.truncated ? '完整 diff（太长，已截断）' : '完整 diff' }), diffView(diff.diff)),

    el('h3', { textContent: '回复' }),
    s.outgoing && el('div', { className: s.undelivered ? 'warn' : 'note' },
      s.undelivered
        ? `发出的消息还没被它接收（${s.outgoing.via === 'tmux' ? '终端可能停在别的提示上，去看一眼' : '后台进程可能没启动起来'}）：`
        : '已发送，等它接收：',
      el('span', { className: 'prose', textContent: ` ${s.outgoing.text}` })),
    replyBox(s),

    s.auto_allow.length > 0 && el('h3', { textContent: '这个会话里自动允许的工具' }),
    s.auto_allow.length > 0 && el('div', {}, s.auto_allow.map((tool) =>
      el('span', { className: 'chip' }, tool, el('button', {
        textContent: '✕', title: '不再自动允许',
        onclick: () => call(`/api/sessions/${encodeURIComponent(s.key)}/rule`, { tool, allow: false }).catch((e) => say(s.key, e.message)),
      })))),

    more.events && el('details', {},
      el('summary', { textContent: `事件记录（最近 ${more.events.length} 条）` }),
      el('ul', { className: 'timeline' }, more.events.filter((e) => e.type !== 'meta.updated').map((e) => {
        const x = e.data || {};
        return el('li', {}, el('time', { textContent: new Date(e.ts).toLocaleTimeString() }),
          el('span', { textContent: [e.type, x.tool, x.kind, x.decision, x.by, x.source, x.reason, x.error, e.late && '(迟到，未采用)'].filter(Boolean).join(' · ') }));
      }))),
  ].filter(Boolean));

  if (typing) {
    const field = document.getElementById(typing.id);
    if (field) { field.focus(); field.setSelectionRange(typing.start, typing.end); }
  }
}

// Diff and event history are fetched when a session is opened and again
// whenever it changes state.
async function loadExtra(s) {
  const scope = scopes.get(s.key) || (s.files_count ? 'session' : 'all');
  const sig = `${s.state}:${s.last_event_ts}:${scope}`;
  const have = extra.get(s.key);
  if (have?.sig === sig) return;
  extra.set(s.key, { ...have, sig });
  const key = encodeURIComponent(s.key);
  const [diff, events, full] = await Promise.all([
    call(`/api/sessions/${key}/diff?scope=${scope}`).catch(() => null),
    call(`/api/sessions/${key}/events`).catch(() => null),
    call(`/api/sessions/${key}/detail`).catch(() => null),
  ]);
  extra.set(s.key, { sig, diff, events, full });
  if (selected === s.key) render();
}

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
  const benchSig = JSON.stringify([s, more.sig, !!more.diff, !!more.events, !!more.full, notice, scopes.get(selected), snap.sessions.length > 0]);
  if (benchSig !== paint.bench) { paint.bench = benchSig; renderBench(); }
  if (s) loadExtra(s);
  noteReading();

  const count = { attention: 0, review: 0, working: 0 };
  for (const x of snap.sessions) if (column(x) in count) count[column(x)] += 1;
  $('#summary').replaceChildren(
    ...(count.attention ? [el('b', { textContent: `${count.attention} 个会话在等你` }), '，'] : ['没有会话在等你，']),
    `${count.review} 个待验收，${count.working} 个在工作`, filter ? `（筛选后显示 ${visible().length} / ${snap.sessions.length}）` : '',
  );
  $('#rules').textContent = `自动规则 ${snap.rules || 0}`;
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
  es.onopen = () => { conn.textContent = '实时'; conn.className = 'conn ok'; };
  es.onerror = () => { conn.textContent = '断开，重连中…'; conn.className = 'conn bad'; };
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.sessions) { // full picture, on (re)connect
      all.clear();
      for (const s of msg.sessions) all.set(s.key, s);
    } else { // delta
      for (const s of msg.changed) all.set(s.key, s);
      for (const key of msg.removed) all.delete(key);
    }
    snap = { now: msg.now, sessions: [...all.values()], queue: msg.queue, rules: msg.rules };
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
    button.textContent = out.imported ? `导入了 ${out.imported} 个` : '没有新的历史会话';
  } catch (err) {
    button.textContent = err.message;
  }
  setTimeout(() => { button.textContent = '导入历史'; button.disabled = false; }, 2500);
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
    el('h3', { textContent: '自动规则' }),
    el('p', { className: 'note', textContent: '任何会话请求完全相同的命令时自动允许。在“全部允许，以后也自动允许”时创建；看起来高风险的命令不能设为规则。' }),
    rules.length ? el('ul', { className: 'rules' }, rules.map((r) => el('li', {},
      el('code', { textContent: `${r.tool}: ${r.detail}` }),
      el('button', { textContent: '撤销', onclick: async () => show(await fetch(api('/api/rules'), {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }).then((x) => x.json())) }))))
      : el('p', { className: 'empty', textContent: '还没有规则。' }),
    el('div', { className: 'actions' }, el('button', { textContent: '关闭', onclick: () => dialog.close() })));
  show(await call('/api/rules'));
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
setView(['board', 'office'].includes(prefs.get('view')) ? prefs.get('view') : 'inbox');
setInterval(tickAges, 5000); // waiting timers tick without re-rendering anything // keep timers ticking
connect();
