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

let snap = { now: Date.now(), sessions: [], queue: [] };
let skew = 0; // hub clock minus browser clock
let selected = null; // session key shown in the workbench
let pinned = false; // true once the human picked a session themselves
let notice = null; // { key, text } transient message in the workbench
const seen = new Map(); // key -> state signature, to detect new requests
const extra = new Map(); // key -> { sig, diff, events } lazily loaded detail
const drafts = new Map(); // key -> unsent reply text

const prefs = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const byKey = (key) => snap.sessions.find((s) => s.key === key);

function age(ts) {
  const s = Math.max(0, Math.round((Date.now() + skew - ts) / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 86400)} 天`;
}
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function column(s) {
  if (s.state === 'needs_input' || s.state === 'failed' || s.state === 'unknown') return 'attention';
  if (s.state === 'review') return 'review';
  if (s.state === 'working') return 'working';
  return 'rest';
}

function describe(s) {
  switch (s.state) {
    case 'needs_input':
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
      return { tone: 'rest', what: s.imported ? '历史会话（导入）' : '已结束', detail: s.last_message, verb: '' };
    default:
      return { tone: 'rest', what: '空闲，等你派活', detail: s.last_message, verb: '已' };
  }
}

const where = (s) => [s.host, s.repo || (s.cwd || '').split('/').pop(), s.branch].filter(Boolean).join(' · ');
const agentName = (s) => (s.agent === 'claude' ? 'Claude' : s.agent === 'codex' ? 'Codex' : s.agent);
const resumeCommand = (s) => {
  const cd = s.cwd ? `cd ${JSON.stringify(s.cwd)} && ` : '';
  return s.agent === 'claude' ? `${cd}claude --resume ${s.session_id}` : `${cd}codex resume ${s.session_id}`;
};
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
const ack = (s) => act(s, () => call(`/api/sessions/${encodeURIComponent(s.key)}/ack`, {}));
const archive = (s) => act(s, () => call(`/api/sessions/${encodeURIComponent(s.key)}/archive`, {}));

async function send(s) {
  const text = (drafts.get(s.key) || '').trim();
  if (!text) return;
  try {
    const out = await call(`/api/sessions/${encodeURIComponent(s.key)}/message`, { text });
    drafts.delete(s.key);
    say(s.key, out.via === 'tmux' ? '已打进它的 tmux 窗口。' : '已在后台接着这个会话再跑一轮。');
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

const GROUPS = [
  ['attention', '等你回应', '权限、提问、失败、失联。越靠上越该先处理。'],
  ['review', '待验收', 'agent 说做完了，你还没看。'],
  ['working', '工作中', '不需要你，除非它安静太久。'],
  ['rest', '空闲 / 已结束', '等你派下一件事，或已退出。'],
];

function card(s) {
  const d = describe(s);
  return el('button', {
      className: 'card', type: 'button', onclick: () => select(s.key, true),
      dataset: { key: s.key, tone: d.tone }, ariaCurrent: s.key === selected ? 'true' : 'false',
    },
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: agentName(s) }),
      el('span', { className: 'where', textContent: where(s) }),
      s.runtime === 'cloud' && el('span', { textContent: '☁ 云端' }),
      s.subagents > 0 && el('span', { textContent: `${s.subagents} 个子 agent` }),
    ),
    el('div', { className: 'title', textContent: s.title || '(还没有任务描述)' }),
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what + (s.requests.length > 1 ? `（共 ${s.requests.length} 个请求）` : '') }),
      el('span', { className: 'age', textContent: d.verb ? `${d.verb} ${age(s.since)}` : `${age(s.since)}前` }),
    ),
    d.detail && el('div', { className: 'peek', textContent: d.detail.split('\n')[0] }),
    s.quiet && el('div', { className: 'warn', textContent: `${age(s.last_event_ts)} 没有任何动静` }),
  );
}

function grouped() {
  const rank = new Map(snap.queue.map((k, i) => [k, i]));
  const groups = { attention: [], review: [], working: [], rest: [] };
  for (const s of snap.sessions) groups[column(s)].push(s);
  groups.attention.sort((a, b) => rank.get(a.key) - rank.get(b.key));
  groups.review.sort((a, b) => a.since - b.since);
  groups.working.sort((a, b) => Number(b.quiet) - Number(a.quiet) || a.since - b.since);
  groups.rest.sort((a, b) => b.last_event_ts - a.last_event_ts);
  return groups;
}

function renderLists(groups) {
  const focused = document.activeElement?.dataset?.key;
  $('#lists').replaceChildren(...GROUPS.map(([name, label, hint]) =>
    el('div', { className: 'group', dataset: { col: name } },
      el('h2', {}, label, el('span', { className: 'count', textContent: groups[name].length || '' })),
      el('p', { className: 'hint', textContent: hint }),
      el('div', { className: 'cards' },
        groups[name].length ? groups[name].map(card)
          : el('div', { className: 'empty', textContent: name === 'attention' ? '没有人在等你。' : '—' })),
    )));
  if (focused) $(`.card[data-key="${CSS.escape(focused)}"]`)?.focus();
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

function nowBlock(s, d) {
  const kids = [
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what }),
      el('span', { className: 'age', textContent: d.verb ? `${d.verb} ${age(s.since)}` : `${age(s.since)}前` })),
    d.detail && el('div', { className: `box${d.code ? ' code' : ' prose'}`, textContent: d.detail }),
  ];
  const actions = el('div', { className: 'actions' });
  if (s.state === 'needs_input' && s.waiting.kind === 'permission') {
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
  if (s.quiet) kids.push(el('div', { className: 'warn', textContent: `${age(s.last_event_ts)} 没有任何动静：进程还在，可能在跑长任务，也可能卡住了。` }));
  if (s.requests.length > 1) kids.push(el('div', { className: 'note', textContent: `后面还有 ${s.requests.length - 1} 个请求在排队。` }));
  if (actions.childNodes.length) kids.push(actions);
  return el('div', { className: 'now', dataset: { tone: d.tone } }, kids);
}

function renderBench() {
  const bench = $('#bench');
  const s = byKey(selected);
  if (!s) {
    bench.replaceChildren(el('div', { className: 'blank' },
      el('b', { textContent: snap.sessions.length ? '没有人在等你' : '还没有会话' }),
      snap.sessions.length ? '从左边选一个会话查看，或者去做别的事：有人需要你时这里会自动出现。'
        : '启动任意一个 Claude Code 或 Codex 会话，它会自动出现在这里。'));
    return;
  }
  const d = describe(s);
  const more = extra.get(s.key) || {};
  // Typing must survive live re-renders.
  const active = document.activeElement;
  const typing = active?.id === 'reply' ? { start: active.selectionStart, end: active.selectionEnd } : null;

  const diff = more.diff;
  const changed = diff?.available && (diff.status || diff.diff);
  bench.replaceChildren(...[
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: agentName(s) }),
      el('span', { className: 'where', textContent: [where(s), `第 ${s.turns} 轮`, usageLine(s)].filter(Boolean).join(' · ') }),
      s.runtime === 'cloud' && el('span', { textContent: '☁ 云端' })),
    el('h2', { textContent: s.title || s.session_id }),
    notice?.key === s.key && el('div', { className: 'warn', textContent: notice.text }),
    nowBlock(s, d),

    s.last_prompt && el('h3', { textContent: '你上一次说的' }),
    s.last_prompt && el('div', { className: 'prose', textContent: s.last_prompt }),
    s.last_message && s.state !== 'review' && el('h3', { textContent: '它上一次说的' }),
    s.last_message && s.state !== 'review' && el('div', { className: 'prose', textContent: s.last_message }),

    diff?.available && el('h3', { textContent: '工作区里的改动（相对上一次提交，不只是这个会话改的）' }),
    diff?.available && !changed && el('p', { className: 'note', textContent: '没有未提交的改动。' }),
    changed && el('div', { className: 'box code', textContent: [diff.stat, diff.status].filter(Boolean).join('\n\n') }),
    changed && diff.diff && el('details', { open: s.state === 'review' },
      el('summary', { textContent: diff.truncated ? '完整 diff（太长，已截断）' : '完整 diff' }), diffView(diff.diff)),

    el('h3', { textContent: '回复' }),
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
    const area = $('#reply');
    if (area) { area.focus(); area.setSelectionRange(typing.start, typing.end); }
  }
}

// Diff and event history are fetched when a session is opened and again
// whenever it changes state.
async function loadExtra(s) {
  const sig = `${s.state}:${s.last_event_ts}`;
  const have = extra.get(s.key);
  if (have?.sig === sig) return;
  extra.set(s.key, { ...have, sig });
  const key = encodeURIComponent(s.key);
  const [diff, events] = await Promise.all([
    call(`/api/sessions/${key}/diff`).catch(() => null),
    call(`/api/sessions/${key}/events`).catch(() => null),
  ]);
  extra.set(s.key, { sig, diff, events });
  if (selected === s.key) renderBench();
}

function select(key, byHuman) {
  selected = key;
  if (byHuman) {
    pinned = true;
    setView('inbox');
  }
  render();
  $(`.card[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function render() {
  // Follow the queue until the human picks something; never yank a session
  // they chose out from under them.
  const current = byKey(selected);
  if (!current || (!pinned && column(current) !== 'attention' && snap.queue.length)) {
    selected = snap.queue[0] || (current ? selected : snap.sessions[0]?.key) || null;
    if (!current) pinned = false;
  }
  const groups = grouped();
  renderLists(groups);
  renderBench();
  const s = byKey(selected);
  if (s) loadExtra(s);

  const n = groups.attention.length;
  $('#summary').replaceChildren(
    ...(n ? [el('b', { textContent: `${n} 个会话在等你` }), '，'] : ['没有会话在等你，']),
    `${groups.review.length} 个待验收，${groups.working.length} 个在工作`,
  );
  document.title = `${n ? `(${n}) ` : ''}Session Board`;
}

// ---------------------------------------------------------- notifications --

function alertNew() {
  for (const s of snap.sessions) {
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
  prefs.set('view', view);
}

function connect() {
  const es = new EventSource(api('/api/stream'));
  const conn = $('#conn');
  es.onopen = () => { conn.textContent = '实时'; conn.className = 'conn ok'; };
  es.onerror = () => { conn.textContent = '断开，重连中…'; conn.className = 'conn bad'; };
  es.onmessage = (m) => {
    snap = JSON.parse(m.data);
    skew = snap.now - Date.now();
    alertNew();
    render();
  };
}

$('#view-inbox').onclick = () => setView('inbox');
$('#view-board').onclick = () => setView('board');
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
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = byKey(selected);
  const k = e.key.toLowerCase();
  if (k === 'n') {
    if (!snap.queue.length) return;
    const i = snap.queue.indexOf(selected);
    select(snap.queue[(i + 1) % snap.queue.length], true);
  } else if (!s) {
    return;
  } else if (k === 'a' && s.waiting?.decidable) decide(s, 'allow');
  else if (k === 'd' && s.waiting?.decidable) decide(s, 'deny');
  else if (k === 'e' && ['review', 'failed', 'unknown'].includes(s.state)) ack(s);
  else if (k === 'r' && $('#reply')) { e.preventDefault(); $('#reply').focus(); }
});

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
setView(prefs.get('view') === 'board' ? 'board' : 'inbox');
setInterval(() => { if (document.activeElement?.id !== 'reply') render(); }, 5000); // keep timers ticking
connect();
