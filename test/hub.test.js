import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { createHub, QUIET_MS, SETTLE_MS } from '../src/hub.js';
import { writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { plan, strip, install, status } from '../src/install.js';
import { classify, orphanReason } from '../src/reconcile.js';
import { scanHistory } from '../src/transcripts.js';

async function start(opts) {
  const hub = createHub(opts);
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { hub, base, post };
}

test('hook in, snapshot out, ack and archive, survives restart', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'sb-')), 'board.db');
  let t = 1_000_000;
  let { hub, base, post } = await start({ dbPath, now: () => t });
  const hook = (name, extra) => post('/ingest/claude?host=laptop', { session_id: 's1', cwd: '/nowhere', hook_event_name: name, ...extra });

  assert.deepEqual(await (await hook('UserPromptSubmit', { prompt: 'ship it' })).json(), {});
  // Held open until answered; here the terminal answers (PostToolUse below).
  const asked = hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  let snap;
  do snap = await (await fetch(base + '/api/sessions')).json();
  while (snap.sessions[0].state !== 'needs_input');
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].host, 'laptop');
  assert.equal(snap.sessions[0].state, 'needs_input');
  assert.deepEqual(snap.queue, ['claude:s1']);

  await hook('PostToolUse', { tool_name: 'Bash' });
  assert.deepEqual(await (await asked).json(), {});
  t += QUIET_MS + 1;
  snap = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snap.sessions[0].quiet, true, 'silent working sessions are flagged');

  await hook('Stop', { last_assistant_message: 'pushed' });
  await hub.close();

  ({ hub, base, post } = await start({ dbPath, now: () => t }));
  snap = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snap.sessions[0].state, 'review', 'projection is rebuilt from the log');

  const key = encodeURIComponent('claude:s1');
  assert.equal((await (await post(`/api/sessions/${key}/ack`, {})).json()).state, 'idle');
  const events = await (await fetch(`${base}/api/sessions/${key}/events`)).json();
  assert.deepEqual(events.map((e) => e.type), ['prompt.submitted', 'permission.requested', 'tool.finished', 'turn.completed', 'human.acknowledged']);
  await post(`/api/sessions/${key}/archive`, {});
  snap = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snap.sessions.length, 0);
  await hub.close();
});

test('garbage never breaks a hook; token is enforced; generic events work', async () => {
  const { hub, base, post } = await start({ token: 'secret' });
  assert.equal((await post('/ingest/claude', { session_id: 'x', hook_event_name: 'Stop' })).status, 401);
  const auth = { authorization: 'Bearer secret' };
  const bad = await fetch(base + '/ingest/claude', { method: 'POST', headers: auth, body: 'not json' });
  assert.equal(bad.status, 200);
  assert.deepEqual(await bad.json(), {});
  const r = await post('/ingest/event', [{ agent: 'codex', session_id: 9, type: 'prompt.submitted', runtime: 'cloud', data: { prompt: 'hi' } }, { nope: 1 }], auth);
  assert.deepEqual(await r.json(), { accepted: 1 });
  const snap = await (await fetch(base + '/api/sessions?token=secret')).json();
  assert.equal(snap.sessions[0].key, 'codex:9');
  assert.equal(snap.sessions[0].runtime, 'cloud');
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  await hub.close();
});

test('a web page in the same browser cannot drive the board', async () => {
  const { hub, base, post } = await start({});
  await post('/ingest/claude', { session_id: 'x', hook_event_name: 'Stop' });
  const { port } = new URL(base);
  // Raw requests: fetch() will not let a test forge Host or Origin.
  const raw = (method, path, headers) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });
  const ack = `/api/sessions/${encodeURIComponent('claude:x')}/ack`;
  const here = `127.0.0.1:${port}`;
  assert.equal(await raw('POST', ack, { host: here, origin: 'https://evil.example' }), 403, 'cross-origin request refused');
  assert.equal(await raw('GET', '/api/sessions', { host: 'evil.example' }), 403, 'foreign host name refused (DNS rebinding)');
  assert.equal(hub.store.get('claude:x').state, 'review', 'nothing was changed');
  assert.equal(await raw('POST', ack, { host: here, origin: `http://${here}` }), 200);
  await hub.close();
});

test('permission requests are answered from the board, by rule, or handed back', async () => {
  const { hub, base, post } = await start({ localHost: 'laptop' });
  const ask = (tool, command) => post('/ingest/claude?host=laptop', {
    session_id: 'p', cwd: '/nowhere', hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: { command },
  });
  const current = async () => (await (await fetch(base + '/api/sessions')).json()).sessions[0];
  const until = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } assert.fail('timed out'); };

  // Codex with nobody at the board: no opinion, it shows its own prompt.
  const codex = await post('/ingest/codex?host=laptop', { session_id: 'c', hook_event_name: 'PermissionRequest', tool_name: 'shell', tool_input: { command: 'ls' } });
  assert.deepEqual(await codex.json(), {});
  await post('/ingest/codex?host=laptop', { session_id: 'c', hook_event_name: 'SessionEnd' });
  await post(`/api/sessions/${encodeURIComponent('codex:c')}/archive`, {});

  // Claude Code is held even with no board open, and an answer given in its
  // own terminal (seen here as the tool finishing) withdraws the request.
  const early = ask('Bash', 'ls');
  const id0 = await until(async () => (await current()).requests.find((r) => r.decidable)?.id);
  await post('/ingest/claude?host=laptop', { session_id: 'p', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.deepEqual(await (await early).json(), {});
  assert.equal((await post(`/api/requests/${id0}`, { decision: 'deny' })).status, 410, 'answered elsewhere, no longer answerable here');

  // With the board open the request is held until a decision arrives.
  const board = new AbortController();
  await fetch(base + '/api/stream', { signal: board.signal });
  const pending = ask('Bash', 'git push');
  const id = await until(async () => (await current()).requests.find((r) => r.decidable)?.id);
  assert.equal((await post(`/api/requests/${id}`, { decision: 'allow', remember: true })).status, 200);
  assert.equal((await (await pending).json()).hookSpecificOutput.decision.behavior, 'allow');
  assert.equal((await post(`/api/requests/${id}`, { decision: 'allow' })).status, 410, 'cannot answer twice');
  assert.deepEqual(hub.store.get('claude:p').auto_allow, ['Bash']);

  // "Allow for this session" now answers without asking.
  assert.equal((await (await ask('Bash', 'git status')).json()).hookSpecificOutput.decision.behavior, 'allow');

  // Deny carries a message back; "terminal" releases with no opinion.
  const denied = ask('Write', 'x');
  const id2 = await until(async () => (await current()).requests.find((r) => r.decidable)?.id);
  await post(`/api/requests/${id2}`, { decision: 'deny', message: 'not this' });
  assert.deepEqual((await (await denied).json()).hookSpecificOutput.decision, { behavior: 'deny', message: 'not this' });
  const back = ask('Edit', 'y');
  const id3 = await until(async () => (await current()).requests.find((r) => r.decidable)?.id);
  await post(`/api/requests/${id3}`, { decision: 'terminal' });
  assert.deepEqual(await (await back).json(), {});
  assert.equal((await current()).state, 'needs_input', 'handed back, still waiting on the human');
  board.abort();
  await hub.close();
});

test('late reports from a numbered source are recorded but not applied', async () => {
  const { hub, base, post } = await start({});
  const hook = (seq, name, extra = {}) => post(`/ingest/codex?source=bridge&seq=${seq}`, { session_id: 'o', hook_event_name: name, ...extra });
  await hook(10, 'UserPromptSubmit', { prompt: 'go' });
  await hook(30, 'Stop', { last_assistant_message: 'done' });
  await hook(20, 'PreToolUse', { tool_name: 'shell' }); // arrives after the Stop it preceded
  const snap = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snap.sessions[0].state, 'review');
  const events = await (await fetch(`${base}/api/sessions/${encodeURIComponent('codex:o')}/events`)).json();
  assert.equal(events.at(-1).late, true);
  hub.store.rebuild();
  assert.equal(hub.store.get('codex:o').state, 'review', 'replay skips it too');
  await hub.close();
});

test('reconciliation marks orphaned local sessions unknown, and only those', async () => {
  let t = 1_000_000;
  let procs = [{ agent: 'claude', pid: 1, cwd: '/work/a' }];
  const { hub, post } = await start({ now: () => t, localHost: 'laptop', agents: async () => procs });
  const prompt = (agent, id, cwd, host = 'laptop') => post(`/ingest/${agent}?host=${host}`, { session_id: id, cwd, hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  await prompt('claude', 'alive', '/work/a/sub');
  await prompt('claude', 'dead', '/work/b');
  await prompt('codex', 'nocodex', '/work/a');
  await prompt('claude', 'remote', '/work/b', 'devbox');
  assert.equal(await hub.reconcile(), 0, 'not judged until it has been silent a while');
  t += SETTLE_MS + 1;
  assert.equal(await hub.reconcile(), 2);
  const state = (k) => hub.store.get(k).state;
  assert.deepEqual(['claude:alive', 'claude:dead', 'codex:nocodex', 'claude:remote'].map(state), ['working', 'unknown', 'unknown', 'working']);
  assert.equal(orphanReason({ agent: 'claude', cwd: '/x' }, [{ agent: 'claude', pid: 2, cwd: null }]), null, 'unknown cwd counts as alive');
  assert.equal(orphanReason({ agent: 'claude', cwd: '/x' }, null), null, 'no process list, no verdict');
  assert.equal(classify('node /usr/lib/node_modules/@openai/codex/bin/codex.js resume'), 'codex');
  assert.equal(classify('/opt/claude-code/bin/claude --resume abc'), 'claude');
  assert.equal(classify('node /repo/bin/session-board.js hook claude'), null, 'our own bridge is not an agent');
  await hub.close();
});

test('backfill imports history once; replies go by tmux or headless or not at all', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-hist-'));
  mkdirSync(join(dir, 'claude', '-work-a'), { recursive: true });
  const file = join(dir, 'claude', '-work-a', 'sess-1.jsonl');
  writeFileSync(file, [
    { type: 'user', sessionId: 'sess-1', cwd: dir, gitBranch: 'main', message: { role: 'user', content: 'add a healthcheck\nwith tests' } },
    { type: 'user', sessionId: 'sess-1', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', sessionId: 'sess-1', requestId: 'r1', message: { model: 'm', content: [{ type: 'text', text: 'added /healthz' }], usage: { input_tokens: 5, cache_read_input_tokens: 995, output_tokens: 40 } } },
    { type: 'cost-state', sessionId: 'sess-1', totalCostUSD: 0.1234567 },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n{torn');
  const old = join(dir, 'claude', '-work-a', 'old.jsonl');
  writeFileSync(old, JSON.stringify({ type: 'user', sessionId: 'old', message: { content: 'ancient' } }));
  utimesSync(old, new Date(0), new Date(0));

  const launched = [];
  const { hub, base, post } = await start({
    localHost: 'laptop',
    history: (o) => scanHistory({ ...o, dirs: { claude: join(dir, 'claude'), codex: join(dir, 'codex') } }),
    launch: (...a) => launched.push(a),
  });
  assert.deepEqual(await (await post('/api/backfill', { days: 7 })).json(), { scanned: 1, imported: 1 });
  assert.deepEqual(await (await post('/api/backfill', { days: 7 })).json(), { scanned: 1, imported: 0 });
  const s = (await (await fetch(base + '/api/sessions')).json()).sessions[0];
  assert.equal(s.title, 'add a healthcheck');
  assert.equal(s.turns, 1, 'tool results are not prompts');
  assert.equal(s.last_message, 'added /healthz');
  assert.deepEqual(s.usage, { model: 'm', context_tokens: 1000, output_tokens: 40, cost_usd: 0.1235 });
  assert.equal(s.state, 'ended');
  assert.equal(s.reply, 'headless');

  const key = encodeURIComponent(s.key);
  assert.deepEqual(await (await post(`/api/sessions/${key}/message`, { text: 'also add /readyz' })).json(), { via: 'headless' });
  assert.deepEqual(launched, [['claude', ['-p', 'also add /readyz', '--resume', 'sess-1'], dir]]);
  // Sent is not delivered: the state moves only when the agent's own hook reports the prompt.
  assert.equal(hub.store.get(s.key).state, 'ended');
  assert.equal(hub.store.get(s.key).outgoing.text, 'also add /readyz');
  const again = await (await post(`/api/sessions/${key}/message`, { text: 'also add /readyz', command_id: 'c1' })).json();
  assert.deepEqual(await (await post(`/api/sessions/${key}/message`, { text: 'also add /readyz', command_id: 'c1' })).json(), again);
  assert.equal(launched.length, 2, 'a retried command is not sent twice');
  await post('/ingest/claude?host=laptop', { session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'something typed in the terminal' });
  assert.ok(hub.store.get(s.key).outgoing, 'a different prompt does not confirm ours');
  await post('/ingest/claude?host=laptop', { session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'also add /readyz' });
  assert.deepEqual([hub.store.get(s.key).state, hub.store.get(s.key).outgoing], ['working', null]);

  await post('/ingest/claude?host=laptop', { session_id: 'live', cwd: dir, hook_event_name: 'Stop' });
  const live = await post(`/api/sessions/${encodeURIComponent('claude:live')}/message`, { text: 'hi' });
  assert.equal(live.status, 409, 'a live session outside tmux cannot be typed into');
  await hub.close();
});

test('install merges with existing hooks and uninstall restores them', () => {
  const mine = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
  const after = plan('claude', mine, { url: 'http://127.0.0.1:4590', host: 'laptop' });
  assert.equal(after.hooks.Stop.length, 2);
  assert.equal(after.hooks.Stop[1].hooks[0].type, 'http');
  assert.equal(after.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.deepEqual(plan('claude', after, { url: 'http://127.0.0.1:4590', host: 'laptop' }), after, 'idempotent');
  assert.deepEqual(strip(structuredClone(after)), mine);
  assert.equal(after.hooks.PermissionRequest[0].hooks[0].timeout, 600, 'permission hooks wait for the human');
  assert.equal(after.hooks.Stop[1].hooks[0].timeout, 5);
  const codex = plan('codex', {}, { url: 'http://127.0.0.1:4590', host: 'laptop' });
  assert.ok(Object.values(codex.hooks).every((g) => g[0].hooks[0].type === 'command'));
  assert.ok(!codex.hooks.Stop[0].hooks[0].command.includes('--url'), 'the bridge finds the hub at call time');
  assert.deepEqual(strip(codex), {});

  const path = join(mkdtempSync(join(tmpdir(), 'sb-cfg-')), 'settings.json');
  assert.deepEqual(status('claude', path), { path, installed: false, url: null });
  assert.equal(install('claude', { path, url: 'http://127.0.0.1:4590', host: 'laptop' }).changed, true);
  assert.equal(install('claude', { path, url: 'http://127.0.0.1:4590', host: 'laptop' }).changed, false, 'no rewrite when nothing changed');
  assert.equal(status('claude', path).url, 'http://127.0.0.1:4590');
  assert.equal(install('claude', { path, url: 'http://127.0.0.1:5000', host: 'laptop' }).changed, true);
  assert.equal(status('claude', path).url, 'http://127.0.0.1:5000');
});
