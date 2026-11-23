import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { connect, snapshot, readThread, readLimits } from '../src/codexapp.js';
import { createHub } from '../src/hub.js';

test('a Codex thread and its account limits, as the local server reports them', () => {
  const t = readThread({ id: 'th1', name: null, preview: 'Fix the flaky test\nmore', cwd: '/w/api', source: 'vscode', updatedAt: 1795400000,
    status: { type: 'active', activeFlags: ['waitingOnApproval'] }, gitInfo: { branch: 'fix/flaky', originUrl: 'https://tok@github.com/acme/api.git' } }, { th1: { unread: true } });
  assert.deepEqual(t, { id: 'th1', title: 'Fix the flaky test', cwd: '/w/api', branch: 'fix/flaky', repo_id: 'https://github.com/acme/api.git', client: 'vscode', parent: null,
    subagent: false, updated: 1795400000000, status: 'active', waiting: 'permission', unread: true });
  assert.equal(readThread({ id: 'x', source: { subAgentReview: {} }, status: { type: 'idle' } }).subagent, true);
  assert.equal(readThread({ id: 'x', source: 'cli', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } }).waiting, 'question');
  assert.deepEqual(readLimits({ rateLimits: { primary: { usedPercent: 71.6, resetsAt: 1795403600, windowDurationMins: 300 }, secondary: { usedPercent: 12, resetsAt: 1795900000, windowDurationMins: 10080 } } }),
    { primary: { used: 72, resets_at: 1795403600000, minutes: 300 }, secondary: { used: 12, resets_at: 1795900000000, minutes: 10080 } });
  assert.equal(readLimits({}), null);
});

// A stand-in for the app-server process: answers requests line by line.
function fakeServer(handlers) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => child.emit('close');
  let buf = '';
  child.stdin.on('data', (c) => { buf += c; for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id == null) continue;
    const out = handlers[msg.method]?.(msg.params);
    child.stdout.write(`${JSON.stringify(out instanceof Error ? { id: msg.id, error: { code: -32600, message: out.message } } : { id: msg.id, result: out ?? {} })}\n`);
  } });
  return child;
}

test('the board shows every local Codex thread, from any client, with its waiting state and the account\'s limits', async () => {
  let threads = [
    { id: 'a', preview: 'Port the importer', cwd: '/w/api', source: 'cli', updatedAt: Date.now() / 1000, status: { type: 'active', activeFlags: [] } },
    { id: 'b', name: 'Checkout redesign', cwd: '/w/web', source: 'appServer', updatedAt: Date.now() / 1000, status: { type: 'active', activeFlags: ['waitingOnApproval'] } },
    { id: 'c', preview: 'Docs pass', cwd: '/w/docs', source: 'vscode', updatedAt: Date.now() / 1000, status: { type: 'idle' } },
    { id: 'old', preview: 'Ancient', cwd: '/w/x', source: 'cli', updatedAt: 1000, status: { type: 'notLoaded' } },
    { id: 'sub', preview: 'helper', source: { subAgentOther: {} }, updatedAt: Date.now() / 1000, status: { type: 'active' } },
  ];
  let readStates = { c: { unread: true } };
  let limits = { rateLimits: { primary: { usedPercent: 93, resetsAt: Date.now() / 1000 + 3600, windowDurationMins: 300 } } };
  const conn = connect({ launch: () => fakeServer({
    initialize: () => ({ userAgent: 'x' }),
    'thread/list': () => ({ data: threads, readStates, nextCursor: null }),
    'account/rateLimits/read': () => limits,
  }) });
  const hub = createHub({ localHost: 'laptop', codexApp: { poll: () => snapshot(conn) } });
  const { port } = await hub.listen(0, '127.0.0.1');
  const get = async () => (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json();
  assert.deepEqual(await hub.scanCodex(), { threads: 4, limits: true });
  let snap = await get();
  const by = Object.fromEntries(snap.sessions.map((s) => [s.session_id, s]));
  assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'c'], 'recent threads only; no subagents');
  assert.deepEqual([by.a.state, by.a.title, by.a.client], ['working', 'Port the importer', 'cli']);
  assert.deepEqual([by.b.state, by.b.waiting.kind, by.b.client, by.b.waiting.decidable], ['needs_input', 'permission', 'appServer', false], 'the desktop app\'s thread, waiting on approval');
  assert.deepEqual([by.c.state, by.c.unseen], ['review', true], 'stopped and unread: something to look at');
  assert.deepEqual(snap.queue, ['codex:b', 'codex:c']);
  assert.equal(snap.quota.codex.primary.used, 93);

  // It was approved in Codex's own window; the docs thread was read there.
  threads[1].status = { type: 'active', activeFlags: [] };
  readStates = { c: { unread: false } };
  await hub.scanCodex(); await hub.scanCodex();
  snap = await get();
  assert.deepEqual(snap.sessions.map((s) => [s.session_id, s.state]).sort(), [['a', 'working'], ['b', 'working'], ['c', 'idle']]);

  // With hooks installed too, the hooks' finer detail wins and the thread is not duplicated.
  await fetch(`http://127.0.0.1:${port}/ingest/codex?host=laptop`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'a', hook_event_name: 'Stop', last_assistant_message: 'ported' }) });
  await hub.scanCodex();
  snap = await get();
  assert.deepEqual([snap.sessions.length, snap.sessions.find((s) => s.session_id === 'a').state], [3, 'review']);

  // Not logged in: threads still list, limits are simply absent. Codex gone: nothing breaks.
  limits = new Error('codex account authentication required to read rate limits');
  assert.deepEqual(await hub.scanCodex(), { threads: 4, limits: false });
  conn.close();
  assert.equal(await hub.scanCodex(), null);
  await hub.close();
});

test('the real Codex local server answers the handshake and a thread listing', { skip: spawnSync('codex', ['--version']).status !== 0 }, async () => {
  const conn = connect();
  const snap = await snapshot(conn);
  conn.close();
  assert.ok(snap && Array.isArray(snap.threads), 'thread/list answered');
});
