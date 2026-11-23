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
const picks = new Map(); // request id -> { question: { chosen: Set, other: string } }
const scopes = new Map(); // key -> 'session' | 'all' for the diff view

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
    s.pr && el('div', { className: `pr ${prTone(s.pr)}`, textContent: prLine(s.pr) }),
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

// ----------------------------------------------------------------- office --
// The same snapshot drawn as a room. Positions follow state only:
//   at its own desk        -> working / idle (nothing for you to do)
//   queued at your desk    -> needs you; the queue order is the attention order
//   paper in your in-tray  -> finished, waiting for review
// Agent nodes are kept between renders so a state change shows as a walk.

const SPRITE = `<svg width="44" height="52" viewBox="0 0 22 26" aria-hidden="true">
  <rect x="10" y="0" width="2" height="3" fill="#8a8f96"/><rect x="9" y="0" width="4" height="1" fill="#8a8f96"/>
  <rect x="5" y="3" width="12" height="9" fill="#d5d8dc"/><rect x="6" y="5" width="10" height="4" fill="#2b2f36"/>
  <rect class="eye" x="8" y="6" width="2" height="2"/><rect class="eye" x="12" y="6" width="2" height="2"/>
  <rect class="body" x="5" y="13" width="12" height="8"/>
  <rect class="body arm-l" x="2" y="14" width="2" height="6"/><rect class="body arm-r" x="18" y="14" width="2" height="6"/>
  <rect class="leg-l" x="6" y="21" width="4" height="5" fill="#4a4e55"/><rect class="leg-r" x="12" y="21" width="4" height="5" fill="#4a4e55"/>
</svg>`;
const DESK = `<svg width="120" height="64" viewBox="0 0 60 32" aria-hidden="true">
  <g class="smoke" fill="#8a8f96"><rect x="27" y="0" width="3" height="3"/><rect x="31" y="3" width="2" height="2"/></g>
  <rect x="20" y="6" width="20" height="13" fill="#5b6068"/><rect class="screen" x="22" y="8" width="16" height="9"/>
  <rect x="28" y="19" width="4" height="3" fill="#5b6068"/>
  <rect x="2" y="22" width="56" height="5" fill="#b08a5e"/><rect x="5" y="27" width="4" height="5" fill="#8a6a45"/><rect x="51" y="27" width="4" height="5" fill="#8a6a45"/>
</svg>`;
const MY_DESK = `<svg width="150" height="70" viewBox="0 0 75 35" aria-hidden="true">
  <rect x="0" y="14" width="75" height="7" fill="#8a6a45"/><rect x="4" y="21" width="5" height="14" fill="#6d5236"/><rect x="66" y="21" width="5" height="14" fill="#6d5236"/>
  <rect x="48" y="6" width="22" height="8" fill="none" stroke="#5b6068" stroke-width="2"/>
</svg>`;

const CELL = { w: 150, h: 128 };
const LOBBY = 150; // height of the strip in front of your desk
const QUEUE = { w: 84, h: 104 }; // one standing place in the queue
const agentNodes = new Map();

const bubbleFor = (s) => {
  if (s.state === 'needs_input') return s.waiting?.kind === 'permission' ? '要权限' : '有问题问你';
  if (s.state === 'failed') return s.rate_limited ? '被限流了' : '出错了';
  if (s.state === 'unknown') return '失联';
  return null;
};

function renderOffice() {
  const office = $('#office');
  const floor = $('.floor', office);
  const present = snap.sessions.filter((s) => s.state !== 'ended').sort((a, b) => a.created_ts - b.created_ts);
  const width = Math.max(320, office.clientWidth - 38);
  const cols = Math.max(2, Math.floor((width - 16) / CELL.w));
  const rows = Math.max(1, Math.ceil(present.length / cols));
  const deskTop = 26;
  const lobbyTop = deskTop + rows * CELL.h + 8;
  // The queue stands beside your desk, wrapping into more rows when the room
  // is narrow; on a phone it forms up above the desk instead.
  const queue = snap.queue.map(byKey).filter((s) => s && column(s) === 'attention');
  const queued = new Map(queue.map((s, i) => [s.key, i]));
  const narrow = width < 560;
  const queueX = narrow ? 34 : 236;
  const perRow = Math.max(1, Math.floor((width - queueX - 8) / QUEUE.w));
  const queueRows = Math.max(1, Math.ceil(queue.length / perRow));
  const lobby = LOBBY + (queueRows - 1) * QUEUE.h + (narrow && queue.length ? QUEUE.h + 30 : 0);
  const height = Math.max(lobbyTop + lobby, Math.min(office.clientHeight - 60, lobbyTop + lobby + 90));
  floor.style.height = `${height}px`;
  const myY = height - 92;
  const queueSlot = (q) => ({
    x: queueX + (q % perRow) * QUEUE.w,
    y: myY - 2 - (narrow ? QUEUE.h : 0) - (queueRows - 1 - Math.floor(q / perRow)) * QUEUE.h,
  });
  const seat = new Map();
  $('.desks', floor).replaceChildren(
    el('div', { className: 'zone', style: `top:${height - lobby}px;height:${lobby}px` }),
    el('div', { className: 'zone-label', style: `left:14px;top:6px`, textContent: '工位' }),
    el('div', { className: 'zone-label', style: `left:14px;top:${height - lobby + 6}px`, textContent: '你的桌前：排队等你的' }),
    ...present.map((s, i) => {
      const x = 12 + (i % cols) * CELL.w;
      const y = deskTop + Math.floor(i / cols) * CELL.h;
      seat.set(s.key, { x: x + 4, y: y + 2 }); // standing behind the desk, beside the monitor
      const d = describe(s);
      const node = el('button', {
          className: 'desk', type: 'button', style: `left:${x}px;top:${y}px`, title: `${s.title || s.session_id}：${d.what}`,
          dataset: { state: s.state, away: String(queued.has(s.key)) }, onclick: () => select(s.key, true),
        },
        s.state === 'review' ? el('span', { className: 'flag', textContent: '做完了' })
          : s.quiet ? el('span', { className: 'flag quiet', textContent: `${age(s.last_event_ts)}没动静` })
            : s.subagents > 0 ? el('span', { className: 'flag', textContent: `+${s.subagents} 帮手` }) : null,
      );
      node.insertAdjacentHTML('beforeend', DESK);
      node.append(el('span', { className: 'plate' }, s.title || '(还没有任务)',
        el('small', { textContent: [s.runtime === 'cloud' ? '云端' : null, agentName(s), s.repo || (s.cwd || '').split('/').pop()].filter(Boolean).join(' · ') })));
      return node;
    }),
    ...(present.length ? [] : [el('div', { className: 'empty-office', textContent: '办公室里还没有人。启动任意一个 Claude Code 或 Codex 会话，它会自己走进来。' })]),
  );

  // Your desk, with the in-tray of finished work.
  const reviews = present.filter((s) => s.state === 'review').sort((a, b) => a.since - b.since);
  const you = $('.you', floor);
  you.style.cssText = `left:18px;top:${myY}px`;
  you.innerHTML = MY_DESK;
  you.append(
    el('div', { className: 'plate', textContent: '你' }),
    el('div', { className: 'tray', style: 'left:96px;bottom:54px' },
      reviews.slice(0, 5).map((s) => el('button', {
        className: 'paper', type: 'button', title: `待验收：${s.title || s.session_id}`,
        ariaLabel: `待验收：${s.title || s.session_id}`, ariaCurrent: String(s.key === selected), onclick: () => select(s.key, true),
      })),
      reviews.length > 5 && el('span', { className: 'paper more', textContent: `+${reviews.length - 5}` })),
    reviews.length > 0 && el('div', { className: 'tray-label', style: 'left:96px;bottom:86px', textContent: `待验收 ${reviews.length}` }),
  );

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
    Object.assign(node.dataset, { agent: s.agent, tone: d.tone, state: s.state, queued: String(q !== undefined) });
    node.setAttribute('aria-current', String(s.key === selected));
    node.setAttribute('aria-label', `${agentName(s)}：${s.title || s.session_id}，${d.what}`);
    node.title = `${s.title || s.session_id}：${d.what}`;
    const label = bubbleFor(s);
    $('.bubble', node).replaceChildren(...(label ? [label, el('small', { textContent: `等了 ${age(s.since)}` })] : []));
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
  if (form) {
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
  const typing = active?.id && active.matches('input[type="text"], textarea')
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const scope = scopes.get(s.key) || (s.files.length ? 'session' : 'all');

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
    diff?.available && s.files.length > 0 && el('div', { className: 'actions', style: 'margin-top:0' },
      el('button', { textContent: scope === 'session' ? '看整个工作区' : '只看这个会话改的', onclick: () => { scopes.set(s.key, scope === 'session' ? 'all' : 'session'); render(); } })),
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
    const field = document.getElementById(typing.id);
    if (field) { field.focus(); field.setSelectionRange(typing.start, typing.end); }
  }
}

// Diff and event history are fetched when a session is opened and again
// whenever it changes state.
async function loadExtra(s) {
  const scope = scopes.get(s.key) || (s.files.length ? 'session' : 'all');
  const sig = `${s.state}:${s.last_event_ts}:${scope}`;
  const have = extra.get(s.key);
  if (have?.sig === sig) return;
  extra.set(s.key, { ...have, sig });
  const key = encodeURIComponent(s.key);
  const [diff, events] = await Promise.all([
    call(`/api/sessions/${key}/diff?scope=${scope}`).catch(() => null),
    call(`/api/sessions/${key}/events`).catch(() => null),
  ]);
  extra.set(s.key, { sig, diff, events });
  if (selected === s.key) renderBench();
}

function select(key, byHuman) {
  selected = key;
  if (byHuman) {
    pinned = true;
    if ($('#app').dataset.view === 'board') setView('inbox'); // the board has no workbench
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
  if ($('#app').dataset.view === 'office') renderOffice();
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
  $('#view-office').setAttribute('aria-pressed', String(view === 'office'));
  prefs.set('view', view);
  if (view === 'office') renderOffice();
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
$('#view-office').onclick = () => setView('office');
addEventListener('resize', () => $('#app').dataset.view === 'office' && renderOffice());
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
  if (e.target.matches('input[type="text"], textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
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
setView(['board', 'office'].includes(prefs.get('view')) ? prefs.get('view') : 'inbox');
setInterval(() => { if (!document.activeElement?.matches('input[type="text"], textarea')) render(); }, 5000); // keep timers ticking
connect();
