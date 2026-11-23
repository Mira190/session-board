import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTasks } from '../src/tasks.js';
import { createHub } from '../src/hub.js';
import { createMcp } from '../src/mcp.js';

const s = (key, over = {}) => ({ key, created_ts: Number(key.replace(/\D/g, '')) || 0, repo: 'api', branch: 'main', title: `unique title for ${key}`, ...over });
const ids = (list) => { const m = groupTasks(list); return list.map((x) => `${x.key}:${m.get(x.key).id.replace('task:', '')}/${m.get(x.key).size}`).join(' '); };

test('sessions are one task when they share an opening instruction or a feature branch', () => {
  const same = { title: 'Add pagination to the list endpoint' };
  assert.equal(ids([s('a1', same), s('b2', { ...same, title: '  add PAGINATION to the   list endpoint ' }), s('c3')]), 'a1:a1/2 b2:a1/2 c3:c3/1',
    'the same instruction, however it is spaced or cased');
  assert.equal(ids([s('a1', same), s('b2', { ...same, repo: 'web' })]), 'a1:a1/1 b2:b2/1', 'the same words in another repository are another task');
  assert.equal(ids([s('a1', { branch: 'feat/x' }), s('b2', { branch: 'feat/x' }), s('c3', { branch: 'feat/y' })]), 'a1:a1/2 b2:a1/2 c3:c3/1');
  assert.equal(ids([s('a1'), s('b2')]), 'a1:a1/1 b2:b2/1', 'sharing main means nothing');
  assert.equal(ids([s('a1', { title: 'continue' }), s('b2', { title: 'continue' })]), 'a1:a1/1 b2:b2/1', 'a prompt too short to name a task does not join');
  // Worktrees: different folders, one repository.
  assert.equal(ids([s('a1', { ...same, repo: 'api-wt1', repo_id: 'git@github.com:acme/api.git' }), s('b2', { ...same, repo: 'api-wt2', repo_id: 'git@github.com:acme/api.git' })]), 'a1:a1/2 b2:a1/2');
  // Chains: a shares a branch with b, b shares a prompt with c.
  assert.equal(ids([s('a1', { branch: 'f' }), s('b2', { branch: 'f', ...same }), s('c3', same)]), 'a1:a1/3 b2:a1/3 c3:a1/3');
  // By hand: join, and pull out.
  assert.equal(ids([s('a1'), s('b2', { task_manual: 'a1' })]), 'a1:a1/2 b2:a1/2');
  assert.equal(ids([s('a1', same), s('b2', { ...same, task_manual: 'solo' })]), 'a1:a1/1 b2:b2/1');
});

test('accept by task: everything at once, or adopt one version and file the rest; a triage agent can only annotate', async () => {
  const hub = createHub({ ignoreCwds: ['/home/me/.session-board/triage'] });
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = async (path) => (await fetch(base + path)).json();
  const hook = (agent, id, name, extra = {}) => post(`/ingest/${agent}`, { session_id: id, cwd: '/w/api', hook_event_name: name, ...extra });
  const rows = async () => Object.fromEntries((await get('/api/sessions')).sessions.map((x) => [x.session_id, x]));
  const prompt = 'Rewrite the retry logic with backoff';
  await hook('claude', 'c1', 'UserPromptSubmit', { prompt });
  await hook('codex', 'x1', 'UserPromptSubmit', { prompt });
  await hook('claude', 'c2', 'UserPromptSubmit', { prompt });
  await hook('claude', 'other', 'UserPromptSubmit', { prompt: 'Something else entirely here' });
  let r = await rows();
  assert.deepEqual([r.c1.task.size, r.x1.task.id, r.c2.task.id, r.other.task], [3, r.c1.task.id, r.c1.task.id, null]);

  await hook('claude', 'c1', 'Stop', { last_assistant_message: 'version A' });
  await hook('codex', 'x1', 'Stop', { last_assistant_message: 'version B' });
  // c2 is still working. Adopt Codex's version.
  const out = await (await post(`/api/tasks/${encodeURIComponent(r.c1.task.id)}/ack`, { adopt: 'codex:x1' })).json();
  assert.deepEqual(out, { acked: ['claude:c1', 'codex:x1'], archived: ['claude:c1'] }, 'the running attempt is left alone');
  r = await rows();
  assert.deepEqual([r.c1, r.x1.state, r.c2.state], [undefined, 'idle', 'working']);
  assert.equal((await post(`/api/tasks/${encodeURIComponent(r.x1.task.id)}/ack`, { adopt: 'claude:other' })).status, 400);

  // Pull one out by hand.
  await post(`/api/sessions/${encodeURIComponent('claude:c2')}/task`, { join: null });
  r = await rows();
  assert.deepEqual([r.c2.task, r.x1.task], [null, null], 'a task of one is just a session');

  // Triage: read what is open, attach a note, nothing else.
  await hook('claude', 'p1', 'UserPromptSubmit', { prompt: 'install deps for the importer' });
  await hook('claude', 'p1', 'Notification', { notification_type: 'permission_prompt' });
  const mcp = createMcp({ triage: true, call: (p) => get(p), post: async (p, b) => { const res = await post(p, b); const j = await res.json(); if (!res.ok) throw new Error(j.error); return j; } });
  const tool = async (name, args) => (await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  const names = (await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
  assert.deepEqual(names.slice(-2), ['triage_queue', 'annotate']);
  assert.ok(!names.some((n) => /approve|allow|answer|ack|send|decide/.test(n)), 'triage adds notes, not decisions');
  const plain = (await createMcp({ call: get })({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
  assert.ok(!plain.includes('annotate'), 'ordinary sessions cannot write notes on their own requests');

  const { items } = JSON.parse((await tool('triage_queue', {})).content[0].text);
  const item = items.find((i) => i.kind === 'permission');
  assert.ok(item.item.startsWith('claude:p1@permission@'));
  await tool('annotate', { item: item.item, summary: 'Installs project dependencies.', suggestion: 'allow' });
  r = await rows();
  assert.deepEqual([r.p1.triage.suggestion, r.p1.triage.summary, r.p1.state], ['allow', 'Installs project dependencies.', 'needs_input'], 'noted, not decided');
  assert.ok(!JSON.parse((await tool('triage_queue', {})).content[0].text).items.some((i) => i.item === item.item), 'an annotated item is not handed out again');
  assert.equal((await tool('annotate', { item: item.item, summary: 'x', suggestion: 'approve-it' })).isError, true);

  // The note is about that request only: once it is gone, so is the note.
  await hook('claude', 'p1', 'PostToolUse', { tool_name: 'Bash' });
  await hook('claude', 'p1', 'Stop', { last_assistant_message: 'installed' });
  r = await rows();
  assert.equal(r.p1.triage, null);
  assert.equal((await tool('annotate', { item: item.item, summary: 'late', suggestion: 'allow' })).isError, true, 'a stale item cannot be annotated');

  // The triage runner's own session never reaches the board.
  await post('/ingest/claude', { session_id: 'runner', cwd: '/home/me/.session-board/triage', hook_event_name: 'UserPromptSubmit', prompt: 'triage' });
  assert.equal((await rows()).runner, undefined);
  await hub.close();
});
