import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub, QUIET_MS } from '../src/hub.js';
import { plan, strip } from '../src/install.js';

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
  await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  let snap = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].host, 'laptop');
  assert.equal(snap.sessions[0].state, 'needs_input');
  assert.deepEqual(snap.queue, ['claude:s1']);

  await hook('PostToolUse', { tool_name: 'Bash' });
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

test('install merges with existing hooks and uninstall restores them', () => {
  const mine = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
  const after = plan('claude', mine, { url: 'http://127.0.0.1:4590', host: 'laptop' });
  assert.equal(after.hooks.Stop.length, 2);
  assert.equal(after.hooks.Stop[1].hooks[0].type, 'http');
  assert.equal(after.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.deepEqual(plan('claude', after, { url: 'http://127.0.0.1:4590', host: 'laptop' }), after, 'idempotent');
  assert.deepEqual(strip(structuredClone(after)), mine);
  const codex = plan('codex', {}, { url: 'http://127.0.0.1:4590', host: 'laptop' });
  assert.ok(Object.values(codex.hooks).every((g) => g[0].hooks[0].type === 'command'));
  assert.deepEqual(strip(codex), {});
});
