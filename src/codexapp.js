// Codex, through the same local server its own desktop app and IDE extension
// use (`codex app-server`, a JSON-RPC protocol whose schema Codex generates
// itself). It knows every Codex thread on this machine, whichever client
// started it (terminal, IDE, desktop app), with its status, including
// "waiting on approval" and "waiting on user input", and it can read the
// account's usage windows. No hooks are needed for any of that.
//
// The handshake, thread/list and the "login required" answer for usage were
// exercised against Codex 0.171 here. Reading a populated thread list was not
// (no Codex login in the development environment); the field names used below
// come from the generated schema. The protocol is marked experimental.
import { spawn } from 'node:child_process';

export function connect({ command = 'codex', args = ['app-server'], launch = spawn } = {}) {
  const child = launch(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  let next = 1;
  const waiting = new Map();
  let closed = false;
  const fail = () => { closed = true; for (const [, w] of waiting) w.reject(new Error('codex app-server closed')); waiting.clear(); };
  child.on('error', fail);
  child.on('close', fail);
  child.stdout.on('data', (c) => {
    buf += c;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const w = msg.id != null && waiting.get(msg.id);
      if (!w) continue; // notifications are not used: we poll
      waiting.delete(msg.id);
      msg.error ? w.reject(new Error(msg.error.message || 'error')) : w.resolve(msg.result);
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('codex app-server closed'));
    const id = next++;
    waiting.set(id, { resolve, reject });
    setTimeout(() => waiting.delete(id) && reject(new Error(`${method} timed out`)), 15_000).unref?.();
    child.stdin.write(`${JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) })}\n`);
  });
  const ready = call('initialize', { clientInfo: { name: 'session_board', title: 'session-board', version: '0.1.0' } })
    .then(() => { child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`); });
  return { call: async (m, p) => { await ready; return call(m, p); }, close: () => { closed = true; child.kill(); }, get closed() { return closed; } };
}

const ms = (t) => (Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : null);
const SUB = /^subAgent/;

// One thread from thread/list -> the facts the board uses.
export function readThread(t, readStates = {}) {
  const status = typeof t.status === 'string' ? { type: t.status } : t.status || {};
  const flags = status.activeFlags || [];
  const kind = typeof t.source === 'string' ? t.source : t.source?.type || Object.keys(t.source || {})[0] || 'unknown';
  const read = readStates[t.id];
  return {
    id: t.id,
    title: t.name || (t.preview || '').split('\n')[0] || null,
    cwd: t.cwd || null,
    branch: t.gitInfo?.branch || null,
    repo_id: t.gitInfo?.originUrl ? String(t.gitInfo.originUrl).replace(/\/\/[^@/]*@/, '//') : null,
    client: kind, // cli | vscode | exec | appServer (the desktop app) | subAgent…
    parent: t.parentThreadId || null,
    subagent: SUB.test(kind),
    updated: ms(t.updatedAt),
    status: status.type || 'notLoaded', // notLoaded | idle | systemError | active
    waiting: flags.includes('waitingOnApproval') ? 'permission' : flags.includes('waitingOnUserInput') ? 'question' : null,
    unread: read == null ? null : !!(read.unread ?? read.isUnread ?? read.hasUnread),
  };
}

// The account's usage windows -> { primary: { used, resets_at, minutes }, secondary } or null.
export function readLimits(r) {
  const snap = r?.rateLimits || Object.values(r?.rateLimitsByLimitId || {})[0];
  const win = (w) => (w && Number.isFinite(w.usedPercent) ? { used: Math.round(w.usedPercent), resets_at: ms(w.resetsAt), minutes: w.windowDurationMins ?? null } : null);
  const out = snap && { primary: win(snap.primary), secondary: win(snap.secondary) };
  return out && (out.primary || out.secondary) ? out : null;
}

// Poll once: -> { threads: [...], limits } or null when Codex is not there.
export async function snapshot(conn) {
  try {
    const list = await conn.call('thread/list', { limit: 100, sortKey: 'updated_at' });
    const limits = await conn.call('account/rateLimits/read').then(readLimits).catch(() => null);
    return { threads: (list?.data || []).map((t) => readThread(t, list.readStates)).filter((t) => t.id && !t.subagent), limits };
  } catch {
    return null;
  }
}
