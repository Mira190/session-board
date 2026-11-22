// The board is a pure render of the hub's snapshot; all state lives server-side.
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k != null && k !== false));
  return node;
};

let snap = { now: Date.now(), sessions: [], queue: [] };
let skew = 0; // hub clock minus browser clock
const seen = new Map(); // key -> state signature, to detect new requests

const prefs = {
  get: (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } },
  set: (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } },
};

function age(ts) {
  const s = Math.max(0, Math.round((Date.now() + skew - ts) / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 86400)} 天`;
}

function column(s) {
  if (s.state === 'needs_input' || s.state === 'failed') return 'attention';
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
      return { tone: 'urgent', what: '出错停下了', detail: s.error, verb: '已停' };
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
      return { tone: 'rest', what: '已结束', detail: s.last_message, verb: '' };
    default:
      return { tone: 'rest', what: '空闲，等你派活', detail: s.last_message, verb: '已' };
  }
}

function resumeCommand(s) {
  const cd = s.cwd ? `cd ${JSON.stringify(s.cwd)} && ` : '';
  return s.agent === 'claude' ? `${cd}claude --resume ${s.session_id}` : `${cd}codex resume ${s.session_id}`;
}

async function post(s, action) {
  await fetch(`/api/sessions/${encodeURIComponent(s.key)}/${action}`, { method: 'POST' });
}

function copy(text, button) {
  navigator.clipboard?.writeText(text).then(() => {
    const old = button.textContent;
    button.textContent = '已复制';
    setTimeout(() => (button.textContent = old), 1200);
  });
}

function card(s) {
  const d = describe(s);
  const where = [s.host, s.repo || (s.cwd || '').split('/').pop(), s.branch].filter(Boolean).join(' · ');
  const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };
  const actions = el('div', { className: 'actions' });
  if (s.state === 'review' || s.state === 'failed') {
    actions.append(el('button', { className: 'primary', textContent: s.state === 'review' ? '已验收' : '知道了', onclick: stop(() => post(s, 'ack')) }));
  }
  if (s.runtime !== 'cloud') {
    actions.append(el('button', { textContent: '复制接入命令', title: resumeCommand(s), onclick: stop((e) => copy(resumeCommand(s), e.currentTarget)) }));
  }
  if (column(s) === 'rest') actions.append(el('button', { textContent: '归档', onclick: stop(() => post(s, 'archive')) }));

  return el('div', { className: 'card', tabIndex: 0, onclick: () => openDetail(s), onkeydown: (e) => e.key === 'Enter' && openDetail(s) },
    el('div', { className: 'meta' },
      el('span', { className: `badge ${s.agent}`, textContent: s.agent === 'claude' ? 'Claude' : s.agent === 'codex' ? 'Codex' : s.agent }),
      el('span', { className: 'where', textContent: where }),
      s.runtime === 'cloud' && el('span', { textContent: '☁ 云端' }),
      s.subagents > 0 && el('span', { textContent: `${s.subagents} 个子 agent` }),
    ),
    el('div', { className: 'title', textContent: s.title || '(还没有任务描述)' }),
    el('div', { className: 'status' },
      el('span', { className: 'what', textContent: d.what }),
      el('span', { className: 'age', textContent: d.verb ? `${d.verb} ${age(s.since)}` : `${age(s.since)}前` }),
    ),
    d.detail && el('div', { className: `detail${d.code ? ' code' : ''}`, textContent: d.detail }),
    s.quiet && el('div', { className: 'quiet', textContent: `${age(s.last_event_ts)} 没有任何动静：可能在跑长任务，也可能已经卡死或退出` }),
    actions.childNodes.length ? actions : null,
  ).also((n) => { n.dataset.key = s.key; n.dataset.tone = d.tone; });
}
Element.prototype.also = function (fn) { fn(this); return this; };

function render() {
  const rank = new Map(snap.queue.map((k, i) => [k, i]));
  const groups = { attention: [], review: [], working: [], rest: [] };
  for (const s of snap.sessions) groups[column(s)].push(s);
  groups.attention.sort((a, b) => rank.get(a.key) - rank.get(b.key));
  groups.review.sort((a, b) => a.since - b.since);
  groups.working.sort((a, b) => Number(b.quiet) - Number(a.quiet) || a.since - b.since);
  groups.rest.sort((a, b) => b.last_event_ts - a.last_event_ts);

  const focused = document.activeElement?.dataset?.key;
  for (const [name, list] of Object.entries(groups)) {
    const sec = $(`section[data-col="${name}"]`);
    $('.count', sec).textContent = list.length || '';
    $('.cards', sec).replaceChildren(...(list.length ? list.map(card) : [el('div', { className: 'empty', textContent: name === 'attention' ? '没有人在等你。' : '—' })]));
  }
  if (focused) $(`.card[data-key="${CSS.escape(focused)}"]`)?.focus();

  const n = groups.attention.length;
  const r = groups.review.length;
  $('#summary').replaceChildren(
    ...(n ? [el('b', { textContent: `${n} 个会话在等你` }), '，'] : ['没有会话在等你，']),
    `${r} 个待验收，${groups.working.length} 个在工作`,
  );
  document.title = `${n ? `(${n}) ` : ''}Session Board`;
}

function alertNew() {
  for (const s of snap.sessions) {
    const sig = `${s.state}:${s.waiting?.kind || ''}:${s.since}`;
    const before = seen.get(s.key);
    seen.set(s.key, sig);
    if (before === undefined || before === sig) continue;
    // Only interrupt for things that block the agent. Finished work is
    // batchable: it shows up in the count, not as a popup.
    if (s.state !== 'needs_input' && s.state !== 'failed') continue;
    const d = describe(s);
    if (prefs.get('sound')) beep();
    if (prefs.get('notify') && document.hidden && Notification.permission === 'granted') {
      const n = new Notification(`${s.title || s.session_id}`, { body: `${d.what}${d.detail ? '\n' + d.detail : ''}`, tag: s.key });
      n.onclick = () => { window.focus(); focusCard(s.key); };
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

function focusCard(key) {
  const node = $(`.card[data-key="${CSS.escape(key)}"]`);
  if (!node) return;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.focus();
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1200);
}

let cursor = -1;
function next() {
  const order = [...snap.queue];
  if (!order.length) return;
  cursor = (order.indexOf(document.activeElement?.dataset?.key) + 1) % order.length;
  focusCard(order[cursor]);
}

async function openDetail(s) {
  const d = describe(s);
  const events = await fetch(`/api/sessions/${encodeURIComponent(s.key)}/events`).then((r) => r.json()).catch(() => []);
  const fmt = (ts) => new Date(ts).toLocaleTimeString();
  const line = (e) => {
    const x = e.data || {};
    return [e.type, x.tool, x.kind, x.source, x.reason, x.error].filter(Boolean).join(' · ');
  };
  const dialog = $('#detail');
  $('article', dialog).replaceChildren(...[
    el('h3', { textContent: s.title || s.session_id }),
    el('div', { className: 'meta' }, el('span', { textContent: [s.agent, s.host, s.cwd, s.branch, `第 ${s.turns} 轮`].filter(Boolean).join(' · ') })),
    el('h4', { textContent: `现在：${d.what}` }),
    d.detail ? el('pre', { textContent: d.detail }) : null,
    s.last_prompt ? el('h4', { textContent: '你上一次说的' }) : null,
    s.last_prompt ? el('div', { className: 'prose', textContent: s.last_prompt }) : null,
    s.last_message ? el('h4', { textContent: '它上一次说的' }) : null,
    s.last_message ? el('div', { className: 'prose', textContent: s.last_message }) : null,
    s.runtime !== 'cloud' ? el('h4', { textContent: '回到这个会话' }) : null,
    s.runtime !== 'cloud' ? el('pre', { textContent: resumeCommand(s) }) : null,
    el('h4', { textContent: `事件（最近 ${events.length} 条）` }),
    el('ul', { className: 'timeline' }, ...events.filter((e) => e.type !== 'meta.updated').map((e) => el('li', {}, el('time', { textContent: fmt(e.ts) }), el('span', { textContent: line(e) })))),
    el('div', { className: 'actions' }, el('button', { textContent: '关闭', onclick: () => dialog.close() })),
  ].filter(Boolean));
  dialog.showModal();
}

function connect() {
  const es = new EventSource('/api/stream');
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

$('#next').onclick = next;
$('#detail').addEventListener('click', (e) => e.target === e.currentTarget && e.currentTarget.close());
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || $('#detail').open) return;
  if (e.key === 'n' || e.key === 'N') next();
});
for (const id of ['notify', 'sound']) {
  const box = $(`#${id}`);
  box.checked = prefs.get(id);
  box.onchange = async () => {
    if (id === 'notify' && box.checked && Notification.permission !== 'granted') {
      box.checked = (await Notification.requestPermission()) === 'granted';
    }
    if (id === 'sound' && box.checked) beep();
    prefs.set(id, box.checked);
  };
}
setInterval(render, 5000); // keep the waiting timers ticking
connect();
