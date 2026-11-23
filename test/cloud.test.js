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
    ['cloud', 'claude-cloud', 'https://claude.ai/code/session_01ABCDEFGH23', 'hook'], 'mid-turn, so reachable through its own hooks');
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

test('cloud sessions through git: found, measured against the default branch, reviewable, and the user\'s clone untouched', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readRemote, lsRemote } = await import('../src/cloudgit.js');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sb-cg-')));
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  const origin = join(root, 'origin.git'); const work = join(root, 'cloud-container'); const mine = join(root, 'my-clone');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work]);
  const commit = (branch, from, file, text, msg, session) => {
    g(work, 'checkout', '-q', '-B', branch, ...(from ? [from] : []));
    writeFileSync(join(work, file), text);
    g(work, 'add', '-A'); g(work, 'commit', '-qm', session ? `${msg}\n\nClaude-Session: https://claude.ai/code/session_${session}` : msg);
    g(work, 'push', '-q', '-f', 'origin', branch);
  };
  commit('main', null, 'app.txt', 'v1\n', 'init');
  commit('claude/first-task', 'main', 'importer.txt', 'importer\n', 'Add the importer', '01AAAAAAAAAAAA');
  commit('claude/first-task', null, 'app.txt', 'v1 changed by the importer work\n', 'Wire the importer in', '01AAAAAAAAAAAA');
  commit('claude/second-task', 'main', 'cache.txt', 'cache\n', 'Rework the cache', '01BBBBBBBBBBBB');
  commit('claude/hand-made', 'main', 'c.txt', 'x', 'A branch a person pushed with this prefix');
  commit('feature/not-claude', 'main', 'd.txt', 'x', 'Unrelated', '01CCCCCCCCCCCC');
  commit('main', 'main', 'app.txt', 'v2 on main\n', 'main moves on');
  execFileSync('git', ['clone', '-q', origin, mine]);
  const before = g(mine, 'for-each-ref') + g(mine, 'count-objects', '-v');

  const seen = await lsRemote(origin);
  assert.deepEqual([seen.base, [...seen.heads.keys()].sort()], ['main', ['claude/first-task', 'claude/hand-made', 'claude/second-task']]);
  const read = await readRemote(origin, join(root, 'cache'));
  assert.deepEqual(read.branches.map((b) => [b.branch, b.cloud_id, b.commits.length, b.subject, b.ahead, b.behind]).sort(), [
    ['claude/first-task', '01AAAAAAAAAAAA', 2, 'Wire the importer in', 2, 1],
    ['claude/second-task', '01BBBBBBBBBBBB', 1, 'Rework the cache', 1, 1],
  ], 'only claude/ branches whose commits name a session, with their distance from main');
  assert.equal(await readRemote(join(root, 'nowhere.git'), join(root, 'cache')), null, 'an unreachable remote is "could not read"');

  // Through the hub: discovered from a clone the hub knows, without touching it.
  let t = Date.now();
  let pr;
  const hub = createHub({ localHost: 'laptop', now: () => t, cloudGit: { cacheRoot: join(root, 'cache2'), dirs: () => [mine] }, github: { findPr: async ({ branch }) => (branch === 'claude/first-task' ? pr : null) } });
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const get = async (path) => (await fetch(base + path)).json();
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(await hub.scanCloudBranches(), { remotes: 1, sessions: 2 });
  const A = 'claude:session_01AAAAAAAAAAAA'; const B = 'claude:session_01BBBBBBBBBBBB';
  const s = (key) => hub.store.get(key);
  assert.deepEqual([s(A).state, s(A).title, s(A).branch, s(A).runtime, s(A).url, s(A).ahead, s(A).behind],
    ['working', 'Wire the importer in', 'claude/first-task', 'cloud', 'https://claude.ai/code/session_01AAAAAAAAAAAA', 2, 1], 'a commit moments ago: recently active');
  assert.deepEqual(s(A).files.sort(), ['app.txt', 'importer.txt'], 'what the branch changed');
  assert.deepEqual([s(A).base_conflicts, s(B).base_conflicts], [['app.txt'], []], 'main changed app.txt too: merging A would conflict, B is clean');
  assert.equal(g(mine, 'for-each-ref') + g(mine, 'count-objects', '-v'), before, 'the user\'s clone has no new refs and no new objects');

  // Its work can be reviewed on the board: the diff against where it left main, file by file.
  const key = encodeURIComponent(A);
  const diff = await get(`/api/sessions/${key}/diff`);
  assert.deepEqual([diff.scope, diff.files.map((f) => f.path).sort()], ['branch', ['app.txt', 'importer.txt']]);
  assert.match(diff.diff, /\+importer/);
  await post(`/api/sessions/${key}/viewed`, { path: 'importer.txt', hash: diff.files.find((f) => f.path === 'importer.txt').hash });
  assert.equal((await get(`/api/sessions/${key}/diff`)).files.find((f) => f.path === 'importer.txt').viewed, true);
  const detail = await get(`/api/sessions/${key}/detail`);
  assert.deepEqual(detail.commits.map((c) => c.subject), ['Wire the importer in', 'Add the importer']);
  const row = (await get('/api/sessions')).sessions.find((x) => x.key === A);
  assert.equal(row.commits, undefined, 'the commit list is detail, not part of the board row');

  // A local session editing the same file is told about the cloud one, and the other way round.
  await post('/ingest/claude?host=laptop', { session_id: 'local-1', cwd: mine, hook_event_name: 'UserPromptSubmit', prompt: 'tweak the app text locally' });
  await post('/ingest/claude?host=laptop', { session_id: 'local-1', cwd: mine, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: join(mine, 'app.txt') } });
  for (let i = 0; i < 200 && !hub.store.get('claude:local-1').repo_id; i++) await new Promise((r) => setTimeout(r, 10));
  const rows = Object.fromEntries((await get('/api/sessions')).sessions.map((x) => [x.key, x]));
  assert.deepEqual([rows[A].overlap?.file, rows['claude:local-1'].overlap?.with], ['app.txt', ['Wire the importer in']]);

  // Quiet with no pull request: git cannot tell working from waiting, and the board says so rather than guess.
  t += 31 * 60_000;
  await hub.scanCloudBranches();
  assert.deepEqual([s(A).state, s(A).activity], ['idle', 'quiet']);
  // Quiet with an open pull request: there is something to review.
  pr = { number: 5, url: 'u', title: 'Importer', state: 'open', draft: false, head_sha: s(A).tip, base: 'main', checks: 'passing', review: null, updated: 1 };
  await hub.refreshPr(A, { force: true });
  assert.deepEqual([s(A).state, s(A).title], ['review', 'Importer'], 'the pull request also gives it a proper title');
  await post(`/api/sessions/${key}/ack`, {});
  // main moving on changes nothing about what was accepted: no nagging.
  commit('main', 'main', 'other.txt', 'x', 'main moves again');
  t += 60_000; await hub.scanCloudBranches();
  assert.equal(s(A).state, 'idle', 'accepted, and still accepted while only main moved');
  // New work from the session brings it back.
  commit('claude/first-task', 'claude/first-task', 'importer.txt', 'importer v2\n', 'Address review comments', '01AAAAAAAAAAAA');
  t = Date.now() + 40 * 60_000; await hub.scanCloudBranches();
  assert.deepEqual([s(A).state, s(A).commits[0].subject], ['review', 'Address review comments']);
  assert.equal((await get(`/api/sessions/${key}/diff`)).files.find((f) => f.path === 'importer.txt').changed_since_viewed, true, 'the file you had reviewed changed');

  // Merged: counted as accepted. Branch deleted without a merge: ended.
  pr = { ...pr, state: 'merged' };
  await hub.refreshPr(A, { force: true });
  assert.deepEqual([s(A).state, s(A).settled], ['idle', 'merged']);
  g(work, 'push', '-q', 'origin', '--delete', 'claude/second-task');
  await hub.scanCloudBranches();
  assert.deepEqual([s(B).state, s(B).activity], ['ended', 'gone']);

  // The vendor's list, when it arrives, knows better and takes over; git no longer moves the state.
  commit('claude/third-task', 'main', 'z.txt', 'z', 'Third thing', '01DDDDDDDDDDDD');
  await hub.scanCloudBranches();
  await post('/ingest/cloud', [{ id: 'session_01DDDDDDDDDDDD', title: 'Build the third thing', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED', task_summary: 'needs your call on the schema' }]);
  t += 31 * 60_000; await hub.scanCloudBranches();
  const D = s('claude:session_01DDDDDDDDDDDD');
  assert.deepEqual([D.state, D.title, D.branch], ['needs_input', 'Build the third thing', 'claude/third-task'], 'one session, with the branch from git and the state from the list');
  await hub.close();
});

test('extra repositories: a watch list, and the ones pushed to lately according to gh', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { watched, setWatched, recentRepos } = await import('../src/watch.js');
  const home = mkdtempSync(join(tmpdir(), 'sb-w-'));
  assert.deepEqual(watched(home), []);
  setWatched(home, ['https://github.com/acme/api.git', '/work/web', 'https://github.com/acme/api.git']);
  assert.deepEqual(watched(home), ['https://github.com/acme/api.git', '/work/web']);

  const now = Date.parse('2026-11-20T00:00:00Z');
  let calls = 0;
  const exec = async () => (calls += 1, JSON.stringify([
    { url: 'https://github.com/me/fresh', pushedAt: '2026-11-19T00:00:00Z' },
    { url: 'https://github.com/me/stale', pushedAt: '2026-08-01T00:00:00Z' },
  ]));
  const lately = recentRepos({ exec, now: () => now });
  assert.deepEqual(await lately(), ['https://github.com/me/fresh.git'], 'only what was pushed to recently');
  await lately();
  assert.equal(calls, 1, 'asked at most every ten minutes');
  assert.deepEqual(await recentRepos({ exec: async () => null })(), [], 'no gh, no login: nothing, quietly');
});

test('control through hooks: a queued message is handed over at turn end, and a stop is delivered on the next hook, also through the drop box', async () => {
  const hub = createHub({ localHost: 'laptop' });
  const main = await hub.listen(0, '127.0.0.1');
  const drop = await hub.listenDropBox(0, '127.0.0.1', 'a-long-drop-box-token');
  const M = `http://127.0.0.1:${main.port}`;
  // The session is a cloud one: everything it sends comes in through the drop box.
  const hook = async (body) => (await fetch(`http://127.0.0.1:${drop.port}/ingest/claude`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer a-long-drop-box-token', 'x-cloud-session': 'cse_01CONTROL00001' },
    body: JSON.stringify({ session_id: 'c', ...body }) })).json();
  const board = (path, body) => fetch(M + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const row = async () => (await (await fetch(M + '/api/sessions')).json()).sessions[0];
  const key = encodeURIComponent('claude:c');

  assert.deepEqual(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'build the thing' }), {});
  assert.deepEqual([(await row()).reply, (await row()).can_stop], ['hook', true], 'mid-turn: reachable through its own hooks');
  assert.deepEqual(await (await board(`/api/sessions/${key}/message`, { text: 'also add tests' })).json(), { via: 'hook' });
  await board(`/api/sessions/${key}/message`, { text: 'and update the docs' });
  assert.deepEqual(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't1' }), {}, 'nothing is said in the middle of a turn');
  assert.equal((await row()).undelivered, false, 'a queued message is not "undelivered"');
  // The turn ends: instead of stopping, the agent is given what was queued.
  assert.deepEqual(await hook({ hook_event_name: 'Stop', last_assistant_message: 'built' }), { decision: 'block', reason: 'also add tests\n\nand update the docs' });
  let s = await row();
  assert.deepEqual([s.state, s.turns, s.queued.length, s.outgoing, s.last_prompt], ['working', 2, 0, null, 'also add tests\n\nand update the docs']);
  assert.deepEqual(await hook({ hook_event_name: 'Stop', last_assistant_message: 'tests and docs done' }), {}, 'nothing queued: it stops as usual');
  assert.equal((await row()).state, 'review');
  // Once it is idle, hooks cannot wake it: the route changes to the CLI's --cloud.
  assert.deepEqual([(await row()).reply, (await row()).can_stop], ['cloud', false]);

  // Stop: the next thing it does is answered with "stop", once.
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'now refactor everything' });
  await board(`/api/sessions/${key}/message`, { text: 'never mind' });
  await board(`/api/sessions/${key}/stop`);
  assert.equal((await row()).stop_requested, true);
  assert.deepEqual(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'make' } }), { continue: false, stopReason: 'Stopped from session-board by the user.' });
  s = await row();
  assert.deepEqual([s.state, s.stop_requested, s.queued.length, s.unseen], ['idle', false, 0, false], 'stopped by you: not something to tell you about');
  assert.deepEqual(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'carry on' }), {}, 'the stop was for that moment only');

  // Stopping a session that is blocked on a request also answers the request, or it would never reach its next hook.
  const asked = hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'deploy' } });
  for (let i = 0; i < 200 && !(await row()).waiting?.decidable; i++) await new Promise((r) => setTimeout(r, 10));
  await board(`/api/sessions/${key}/stop`);
  assert.equal((await asked).hookSpecificOutput.decision.behavior, 'deny');
  await hub.close();
});
