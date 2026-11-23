import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub, cloudSuffix } from '../src/hub.js';
import { plan } from '../src/install.js';
import { groupTasks } from '../src/tasks.js';

async function start() {
  const hub = createHub({ localHost: 'laptop' });
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const rows = async () => Object.fromEntries((await (await fetch(base + '/api/sessions')).json()).sessions.map((s) => [s.title, s]));
  return { hub, post, rows };
}

test('the same hooks report a session as cloud when they run in a cloud container, and as local otherwise', async () => {
  assert.equal(cloudSuffix('cse_01ABCDEFGH23'), '01ABCDEFGH23');
  assert.equal(cloudSuffix('session_01ABCDEFGH23'), '01ABCDEFGH23');
  assert.equal(cloudSuffix(''), null);
  assert.equal(cloudSuffix('$CLAUDE_CODE_REMOTE_SESSION_ID'), null, 'an unexpanded variable is not an id');

  const hooks = plan('claude', {}, { url: 'http://127.0.0.1:4590', host: 'laptop' }).hooks;
  assert.equal(hooks.Stop[0].hooks[0].headers['X-Cloud-Session'], '$CLAUDE_CODE_REMOTE_SESSION_ID');
  assert.ok(hooks.Stop[0].hooks[0].allowedEnvVars.includes('CLAUDE_CODE_REMOTE_SESSION_ID'));

  const { hub, post, rows } = await start();
  await post('/ingest/claude?host=laptop', { session_id: 'u1', hook_event_name: 'UserPromptSubmit', prompt: 'in the cloud container' }, { 'x-cloud-session': 'cse_01ABCDEFGH23' });
  await post('/ingest/claude?host=laptop', { session_id: 'u2', hook_event_name: 'UserPromptSubmit', prompt: 'on the laptop itself' }, { 'x-cloud-session': '' });
  // Repository hooks meant for the cloud stay quiet when the repository is opened locally.
  await post('/ingest/claude?host=x&only=cloud', { session_id: 'u3', hook_event_name: 'UserPromptSubmit', prompt: 'project hooks, run locally' }, { 'x-cloud-session': '' });
  const r = await rows();
  assert.deepEqual([r['in the cloud container'].runtime, r['in the cloud container'].host, r['in the cloud container'].url, r['in the cloud container'].reply],
    ['cloud', 'claude-cloud', 'https://claude.ai/code/session_01ABCDEFGH23', 'cloud']);
  assert.deepEqual([r['on the laptop itself'].runtime, r['on the laptop itself'].cloud_id], ['local', null]);
  assert.equal(r['project hooks, run locally'], undefined);
  await hub.close();
});

test('the account\'s cloud session list: states, unread, children under their parent, no duplicate of a session that also has hooks', async () => {
  const { hub, post, rows } = await start();
  // One session already reports through its own hooks.
  await post('/ingest/claude', { session_id: 'uuid-1', hook_event_name: 'UserPromptSubmit', prompt: 'hooked session' }, { 'x-cloud-session': 'cse_01HOOKED0001' });
  post('/ingest/claude', { session_id: 'uuid-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make' } }, { 'x-cloud-session': 'cse_01HOOKED0001' }).catch(() => {}); // held open by the board
  const list = { ccr: { data: [
    { id: 'session_01HOOKED0001', title: 'Hooked one', status_bucket: 'SESSION_STATUS_BUCKET_WORKING', task_summary: 'building' },
    { id: 'session_01PARENT00001', title: 'Parent', status_bucket: 'SESSION_STATUS_BUCKET_WORKING' },
    { id: 'session_01CHILD000001', title: 'Child A', status_bucket: 'SESSION_STATUS_BUCKET_WORKING', task_summary: 'running the full check', parent_session_id: 'session_01PARENT00001' },
    { id: 'session_01CHILD000002', title: 'Child B', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED', unread: true, post_turn_summary: { recent_action: 'split 13 parts out' }, parent_session_id: 'session_01PARENT00001' },
    { id: 'session_01DONE0000001', title: 'Read and done', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED' },
    { id: 'session_01BLOCKED0001', title: 'Blocked', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED', task_summary: 'needs a decision on the schema' },
    { id: 'session_01FAILED00001', title: 'Failed', status_bucket: 'SESSION_STATUS_BUCKET_FAILED' },
    { id: 'not-a-session', title: 'ignored' },
  ] } };
  // The hooked session's permission request is held open; do not wait on it.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(await (await post('/ingest/cloud', list)).json(), { accepted: 7 });
  await post('/ingest/cloud', list);
  const r = await rows();
  assert.equal(Object.keys(r).length, 7, 'sent twice, and the hooked session was not duplicated');
  assert.deepEqual([r['Hooked one'].state, r['Hooked one'].waiting.tool, r['Hooked one'].activity], ['needs_input', 'Bash', 'building'], 'its own hooks still decide its state; the list only adds the title and activity');
  assert.deepEqual([r['Child A'].state, r['Child A'].activity], ['working', 'running the full check']);
  assert.deepEqual([r['Child B'].state, r['Child B'].unseen, r['Child B'].last_message], ['review', true, 'split 13 parts out']);
  assert.deepEqual([r['Read and done'].state, r['Read and done'].unseen], ['idle', false]);
  assert.deepEqual([r.Blocked.state, r.Blocked.waiting.detail, r.Blocked.waiting.decidable], ['needs_input', 'needs a decision on the schema', false]);
  assert.equal(r.Failed.state, 'failed');
  assert.deepEqual([r.Parent.task.size, r['Child A'].task.id, r['Child B'].task.why], [3, r.Parent.task.id, ['parent']]);
  assert.equal(r['Child A'].url, 'https://claude.ai/code/session_01CHILD000001');

  // The list changing moves the session; reading it in claude.ai clears "unread".
  list.ccr.data[3].unread = false;
  list.ccr.data[2].status_bucket = 'SESSION_STATUS_BUCKET_REVIEW_READY';
  await post('/ingest/cloud', list);
  const r2 = await rows();
  assert.deepEqual([r2['Child B'].state, r2['Child A'].state], ['idle', 'review']);
  await hub.close();
});

test('the drop box takes deliveries and nothing else: nothing can be read or decided through it', async () => {
  const hub = createHub({ localHost: 'laptop' });
  const main = await hub.listen(0, '127.0.0.1');
  assert.throws(() => hub.listenDropBox(0, '127.0.0.1', 'short'), /at least 16/);
  const drop = await hub.listenDropBox(0, '127.0.0.1', 'a-long-drop-box-token', { perMinute: 8 });
  const D = `http://127.0.0.1:${drop.port}`;
  const M = `http://127.0.0.1:${main.port}`;
  const auth = { 'content-type': 'application/json', authorization: 'Bearer a-long-drop-box-token' };
  const send = (path, body, headers = auth, method = 'POST') => fetch(D + path, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });

  assert.equal((await send('/ingest/claude', { session_id: 'c', hook_event_name: 'UserPromptSubmit', prompt: 'from the cloud' }, { 'content-type': 'application/json' })).status, 401, 'no token, no delivery');
  assert.equal((await send('/ingest/claude', {}, { ...auth, authorization: 'Bearer wrong-token-wrong-token' })).status, 401);
  assert.equal((await send('/ingest/claude', { session_id: 'c', hook_event_name: 'UserPromptSubmit', prompt: 'from the cloud' })).status, 200);
  const key = encodeURIComponent('claude:c');

  // With a valid token, everything that reads or acts still does not exist on this door.
  for (const [method, path] of [['GET', '/'], ['GET', '/api/sessions'], ['GET', '/api/stream'], ['GET', `/api/sessions/${key}/detail`], ['GET', `/api/sessions/${key}/diff`],
    ['POST', `/api/sessions/${key}/ack`], ['POST', `/api/sessions/${key}/message`], ['POST', '/api/rules'], ['POST', '/api/requests/batch'], ['POST', '/api/requests/abc'], ['POST', '/api/backfill'], ['GET', '/api/triage'], ['POST', '/ingest/../api/sessions']]) {
    assert.equal((await send(path, {}, auth, method)).status, 404, `${method} ${path}`);
  }
  // The delivery arrived on the board, which is only reachable through the main door.
  const board = await (await fetch(M + '/api/sessions')).json();
  assert.deepEqual(board.sessions.map((s) => [s.title, s.state]), [['from the cloud', 'working']]);

  // A permission request delivered here is held and answered from the board; the answer goes back on that connection only.
  const asked = send('/ingest/claude', { session_id: 'c', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make' } });
  let id;
  for (let i = 0; i < 200 && !id; i++) { await new Promise((r) => setTimeout(r, 10)); id = (await (await fetch(M + '/api/sessions')).json()).sessions[0].waiting?.id; }
  await fetch(`${M}/api/requests/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'allow' }) });
  assert.equal((await (await asked).json()).hookSpecificOutput.decision.behavior, 'allow');

  // Flooding is cut off.
  let last;
  for (let i = 0; i < 12; i++) last = await send('/ingest/event', { agent: 'claude', session_id: 'c', type: 'heartbeat' });
  assert.equal(last.status, 429);
  await hub.close();
});

test('cloud sessions are found through git alone: branches, the session each commit names, and nothing changed in the user\'s clone', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readRemote } = await import('../src/cloudgit.js');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sb-cg-')));
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  const origin = join(root, 'origin.git'); const work = join(root, 'cloud-container'); const mine = join(root, 'my-clone');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work]);
  const commit = (branch, file, msg, session) => {
    g(work, 'checkout', '-q', '-B', branch); writeFileSync(join(work, file), msg);
    g(work, 'add', '-A'); g(work, 'commit', '-qm', session ? `${msg}\n\nClaude-Session: https://claude.ai/code/session_${session}` : msg);
    g(work, 'push', '-q', '-f', 'origin', branch);
  };
  commit('main', 'readme', 'init');
  commit('claude/first-task', 'a', 'Add the importer', '01AAAAAAAAAAAA');
  commit('claude/first-task', 'a2', 'Importer tests', '01AAAAAAAAAAAA');
  commit('claude/second-task', 'b', 'Rework the cache', '01BBBBBBBBBBBB');
  commit('claude/hand-made', 'c', 'A branch a person pushed with this prefix');
  commit('feature/not-claude', 'd', 'Unrelated', '01CCCCCCCCCCCC');
  execFileSync('git', ['clone', '-q', origin, mine]);
  const before = g(mine, 'for-each-ref') + g(mine, 'count-objects', '-v');

  const branches = await readRemote(origin, join(root, 'cache'));
  assert.deepEqual(branches.map((b) => [b.branch, b.cloud_id, b.commits, b.subject]).sort(), [
    ['claude/first-task', '01AAAAAAAAAAAA', 2, 'Importer tests'],
    ['claude/second-task', '01BBBBBBBBBBBB', 1, 'Rework the cache'],
  ], 'only claude/ branches whose commits name a session');
  assert.equal(await readRemote(join(root, 'nowhere.git'), join(root, 'cache')), null, 'an unreachable remote is "could not read"');

  // Through the hub: discovered from a clone the hub knows, without touching it.
  let t = Date.now();
  const hub = createHub({ localHost: 'laptop', now: () => t, cloudGit: { cacheRoot: join(root, 'cache2'), dirs: () => [mine] }, github: { findPr: async () => undefined } });
  assert.deepEqual(await hub.scanCloudBranches(), { remotes: 1, sessions: 2 });
  const s = (id) => hub.store.get(`claude:session_${id}`);
  assert.deepEqual([s('01AAAAAAAAAAAA').state, s('01AAAAAAAAAAAA').title, s('01AAAAAAAAAAAA').branch, s('01AAAAAAAAAAAA').runtime, s('01AAAAAAAAAAAA').url],
    ['working', 'Importer tests', 'claude/first-task', 'cloud', 'https://claude.ai/code/session_01AAAAAAAAAAAA'], 'a commit minutes ago: recently active');
  assert.equal(g(mine, 'for-each-ref') + g(mine, 'count-objects', '-v'), before, 'the user\'s clone has no new refs and no new objects');

  // Later, with no new commits, git can no longer tell working from waiting, and the board says so rather than guess.
  t += 31 * 60_000;
  await hub.scanCloudBranches();
  assert.deepEqual([s('01AAAAAAAAAAAA').state, s('01AAAAAAAAAAAA').activity], ['idle', 'quiet']);
  commit('claude/first-task', 'a3', 'Fix review comments', '01AAAAAAAAAAAA');
  t = Date.now();
  await hub.scanCloudBranches();
  assert.deepEqual([s('01AAAAAAAAAAAA').state, s('01AAAAAAAAAAAA').title], ['working', 'Fix review comments']);

  // The vendor's list, when it arrives, knows better and takes over; git no longer moves the state.
  const { port } = await hub.listen(0, '127.0.0.1');
  await fetch(`http://127.0.0.1:${port}/ingest/cloud`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ id: 'session_01AAAAAAAAAAAA', title: 'Build the importer', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED', task_summary: 'needs your call on the schema' }]) });
  t += 31 * 60_000;
  await hub.scanCloudBranches();
  assert.deepEqual([s('01AAAAAAAAAAAA').state, s('01AAAAAAAAAAAA').title, hub.store.list().length], ['needs_input', 'Build the importer', 2], 'same session, not a second one');
  await hub.close();
});
