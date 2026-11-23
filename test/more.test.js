import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub, STALE_MS } from '../src/hub.js';
import { createMcp } from '../src/mcp.js';

async function start(opts) {
  const hub = createHub(opts);
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = async (path) => (await fetch(base + path)).json();
  return { hub, base, post, get };
}
const until = async (fn) => {
  for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  assert.fail('timed out');
};
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();

test('an event that names itself is applied once, even across a restart', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'sb-')), 'board.db');
  let { hub, post, get } = await start({ dbPath });
  const prompt = { session_id: 'd', hook_event_name: 'UserPromptSubmit', prompt: 'go', prompt_id: 'p1' };
  const tool = { session_id: 'd', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 't1', tool_input: { file_path: '/w/a.js' } };
  for (const body of [prompt, prompt, tool, tool]) await post('/ingest/claude', body);
  await post('/ingest/event', [{ id: 'x1', agent: 'claude', session_id: 'd', type: 'subagent.started' }, { id: 'x1', agent: 'claude', session_id: 'd', type: 'subagent.started' }]);
  let s = (await get('/api/sessions')).sessions[0];
  assert.equal(s.turns, 1, 'a re-delivered prompt is not a second turn');
  assert.equal(s.subagents, 1);
  assert.deepEqual(s.files, ['/w/a.js']);
  assert.equal((await get(`/api/sessions/${encodeURIComponent('claude:d')}/events`)).length, 3);
  await hub.close();
  ({ hub, post, get } = await start({ dbPath }));
  await post('/ingest/claude', prompt);
  assert.equal((await get('/api/sessions')).sessions[0].turns, 1, 'receipts survive a restart');
  // The post-tool event shares the tool_use_id but is its own event.
  await post('/ingest/claude', { ...tool, hook_event_name: 'PostToolUse' });
  assert.equal((await get(`/api/sessions/${encodeURIComponent('claude:d')}/events`)).at(-1).type, 'tool.finished');
  await hub.close();
});

test('a multiple-choice question is one request, answered from the board with the answers filled in', async () => {
  const { hub, post, get } = await start({ localHost: 'laptop' });
  const input = { questions: [
    { question: 'Which fruit?', header: 'Fruit', multiSelect: false, options: [{ label: 'Apple', description: 'red' }, { label: 'Banana' }] },
    { question: 'Toppings?', multiSelect: true, options: [{ label: 'Nuts' }, { label: 'Honey' }] },
  ] };
  const hook = (name, extra = {}) => post('/ingest/claude?host=laptop', { session_id: 'q', hook_event_name: name, tool_name: 'AskUserQuestion', tool_input: input, ...extra });
  await hook('PreToolUse', { tool_use_id: 'u1' });
  const asked = hook('PermissionRequest');
  const s = await until(async () => { const x = (await get('/api/sessions')).sessions[0]; return x.waiting?.decidable && x; });
  await post('/ingest/claude?host=laptop', { session_id: 'q', hook_event_name: 'Notification', notification_type: 'permission_prompt' });
  const now = (await get('/api/sessions')).sessions[0];
  assert.equal(now.requests.length, 1, 'tool call, permission channel and notification are one request');
  assert.equal(now.waiting.kind, 'question');
  assert.deepEqual(now.waiting.questions[0].options[0], { label: 'Apple', description: 'red' });

  assert.equal((await post(`/api/requests/${s.waiting.id}`, { decision: 'answer', answers: {} })).status, 410, 'an empty answer is not sent');
  await post(`/api/requests/${s.waiting.id}`, { decision: 'answer', answers: { 'Which fruit?': 'Banana', 'Toppings?': ['Nuts', 'Honey'] } });
  const out = (await (await asked).json()).hookSpecificOutput.decision;
  assert.equal(out.behavior, 'allow');
  assert.deepEqual(out.updatedInput.answers, { 'Which fruit?': 'Banana', 'Toppings?': 'Nuts, Honey' });
  assert.deepEqual(out.updatedInput.questions, input.questions, 'the original input is passed back intact');
  assert.equal((await get('/api/sessions')).sessions[0].state, 'working');
  await hub.close();
});

test('review shows the session\'s own files; a merged branch settles itself; old sessions are filed away', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'sb-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, 'other.txt'), 'theirs\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  git(repo, 'checkout', '-qb', 'feature');

  let t = Date.now();
  const { hub, post, get } = await start({ localHost: 'laptop', now: () => t, github: { findPr: async () => undefined } });
  const hook = (id, name, extra = {}) => post('/ingest/claude?host=laptop', { session_id: id, cwd: repo, hook_event_name: name, ...extra });
  await hook('m', 'UserPromptSubmit', { prompt: 'change a' });
  await until(() => hub.store.get('claude:m').start_head);
  await hook('m', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: join(repo, 'a.txt') } });
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  writeFileSync(join(repo, 'other.txt'), 'someone else changed this\n');
  await hook('m', 'Stop', { last_assistant_message: 'done' });

  const key = encodeURIComponent('claude:m');
  const mine = await get(`/api/sessions/${key}/diff?scope=session`);
  assert.equal(mine.scope, 'session');
  assert.match(mine.diff, /a\.txt/);
  assert.doesNotMatch(mine.diff, /other\.txt/, 'another session\'s change is left out');
  assert.match((await get(`/api/sessions/${key}/diff`)).diff, /other\.txt/, 'the whole tree is still available');

  assert.equal(await hub.settle(), 0, 'nothing merged yet');
  git(repo, 'commit', '-qam', 'work');
  assert.equal(await hub.settle(), 0, 'committed on its branch is not merged');
  git(repo, 'checkout', '-q', 'main'); git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'feature'); git(repo, 'checkout', '-q', 'feature');
  assert.equal(await hub.settle(), 1);
  const s = hub.store.get('claude:m');
  assert.equal(s.state, 'idle');
  assert.equal(s.settled, 'merged');

  await hook('old', 'UserPromptSubmit', { prompt: 'x' });
  await hook('old', 'SessionEnd', {});
  t += STALE_MS + 1;
  assert.equal(await hub.settle(), 1);
  assert.equal(hub.store.get('claude:old').archived, true);
  assert.equal(hub.store.get('claude:m').archived, false, 'only finished sessions are filed away');
  await hub.close();
});

test('the MCP server reads the board and cannot change it', async () => {
  const { hub, base, post } = await start({});
  await post('/ingest/claude', { session_id: 'a', cwd: '/w/api', hook_event_name: 'UserPromptSubmit', prompt: 'build it' });
  await post('/ingest/codex', { session_id: 'b', cwd: '/w/web', hook_event_name: 'Stop', last_assistant_message: 'shipped' });
  const mcp = createMcp({ call: async (path) => (await fetch(base + path)).json() });
  const rpc = async (method, params) => mcp({ jsonrpc: '2.0', id: 1, method, params });
  const tool = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text);

  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.serverInfo.name, 'session-board');
  assert.equal(await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const names = (await rpc('tools/list')).result.tools.map((x) => x.name);
  assert.deepEqual(names, ['whats_waiting', 'list_sessions', 'get_session', 'wait_for_session']);
  assert.ok(!names.some((n) => /approve|allow|answer|ack|send|decide/.test(n)), 'no tool can act for the human');

  assert.deepEqual((await tool('whats_waiting', {})).waiting.map((s) => s.key), ['codex:b']);
  assert.deepEqual((await tool('list_sessions', { state: 'working' })).sessions.map((s) => s.key), ['claude:a']);
  assert.deepEqual((await tool('list_sessions', { repo: 'web' })).sessions.map((s) => s.key), ['codex:b']);
  assert.equal((await tool('get_session', { session: 'b' })).last_message, 'shipped');

  const waiting = tool('wait_for_session', { session: 'claude:a', timeout_seconds: 5 });
  await post('/ingest/claude', { session_id: 'a', hook_event_name: 'Stop', last_assistant_message: 'built' });
  const done = await waiting;
  assert.equal(done.reached, true);
  assert.equal(done.last_message, 'built');
  assert.equal((await tool('wait_for_session', { session: 'a', until: ['failed'], timeout_seconds: 1 })).reached, false);
  assert.equal((await rpc('tools/call', { name: 'get_session', arguments: { session: 'nope' } })).result.isError, true);
  assert.equal((await rpc('nope')).error.code, -32601);
  await hub.close();
});
