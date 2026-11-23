import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, attentionQueue } from '../src/reduce.js';
import { fromHook } from '../src/adapters/hooks.js';

let clock = 1000;
const run = (agent, id, steps, start) =>
  steps.reduce((s, [hook_event_name, extra]) => {
    clock += 1000;
    return fromHook(agent, { session_id: id, cwd: '/w', hook_event_name, ...extra }, { now: clock })
      .reduce(reduce, s);
  }, start);

test('a turn goes working -> review, and only a human moves it on', () => {
  let s = run('claude', 'a', [
    ['SessionStart', { source: 'startup' }],
    ['UserPromptSubmit', { prompt: 'fix the bug\nmore detail' }],
    ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }],
  ]);
  assert.equal(s.state, 'working');
  assert.equal(s.title, 'fix the bug');
  assert.deepEqual(s.current_tool, { tool: 'Bash', detail: 'npm test' });
  s = run('claude', 'a', [['PostToolUse', { tool_name: 'Bash' }], ['Stop', { last_assistant_message: 'done' }]], s);
  assert.equal(s.state, 'review');
  assert.equal(s.last_message, 'done');
  s = reduce(s, { ts: clock, agent: 'claude', session_id: 'a', type: 'human.acknowledged' });
  assert.equal(s.state, 'idle');
});

test('permission wait survives parallel tool calls and keeps its start time', () => {
  let s = run('claude', 'b', [
    ['UserPromptSubmit', { prompt: 'go' }],
    ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }],
    ['PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }],
  ]);
  const since = s.since;
  assert.equal(s.state, 'needs_input');
  assert.deepEqual(s.waiting, { id: null, kind: 'permission', tool: 'Bash', detail: 'rm -rf build' });
  assert.equal(s.requests.length, 1, 'PreToolUse + PermissionRequest + Notification are one request');
  s = run('claude', 'b', [
    ['Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }],
    ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } }],
    ['PostToolUse', { tool_name: 'Read' }],
  ], s);
  assert.equal(s.state, 'needs_input', 'unrelated tools must not hide the request');
  assert.equal(s.since, since);
  assert.equal(s.waiting.detail, 'rm -rf build');
  s = run('claude', 'b', [['PostToolUse', { tool_name: 'Bash' }]], s);
  assert.equal(s.state, 'working');
  assert.equal(s.waiting, null);
});

test('several open requests queue up and resolve one by one, oldest shown first', () => {
  const ev = (type, data) => ({ ts: (clock += 1000), agent: 'claude', session_id: 'q', type, data });
  let s = [
    ev('prompt.submitted', { prompt: 'go' }),
    ev('permission.requested', { tool: 'Bash', input: { command: 'make' }, request_id: 'r1' }),
    ev('permission.requested', { tool: 'Write', input: { file_path: 'a.md' }, request_id: 'r2' }),
  ].reduce(reduce, undefined);
  const since = s.since;
  assert.equal(s.requests.length, 2);
  assert.equal(s.waiting.id, 'r1');
  s = reduce(s, ev('request.resolved', { id: 'r1', decision: 'allow', by: 'human' }));
  assert.equal(s.state, 'needs_input');
  assert.equal(s.waiting.id, 'r2');
  assert.ok(s.since > since, 'the wait clock belongs to the request now shown');
  s = reduce(s, ev('request.resolved', { id: 'r2', decision: 'deny', by: 'human' }));
  assert.equal(s.state, 'working', 'resolving the last request falls back to the lifecycle phase');
  s = reduce(s, ev('rule.added', { tool: 'Bash' }));
  assert.deepEqual(s.auto_allow, ['Bash']);
});

test('lost sessions become unknown; imports are history; any real event revives', () => {
  const ev = (type, data = {}) => ({ ts: (clock += 1000), agent: 'codex', session_id: 'l', type, data });
  let s = [ev('prompt.submitted', { prompt: 'go' }), ev('session.lost', { reason: 'no codex process' })].reduce(reduce, undefined);
  assert.equal(s.state, 'unknown');
  assert.equal(s.error, 'no codex process');
  s = reduce(s, ev('tool.started', { tool: 'shell' }));
  assert.equal(s.state, 'working');
  let h = reduce(undefined, { ...ev('session.imported', { title: 'old work', turns: 3, branch: 'main' }), session_id: 'h' });
  assert.equal(h.state, 'ended');
  assert.equal(h.imported, true);
  assert.equal(h.turns, 3);
  h = reduce(h, { ...ev('prompt.submitted', { prompt: 'again' }), session_id: 'h' });
  assert.equal(h.imported, false);
});

test('AskUserQuestion is a question, a failed turn is a failure', () => {
  let s = run('claude', 'c', [
    ['UserPromptSubmit', { prompt: 'go' }],
    ['PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'A or B?' }] } }],
  ]);
  assert.equal(s.waiting.kind, 'question');
  assert.equal(s.waiting.detail, 'A or B?');
  s = run('claude', 'c', [['PostToolUse', { tool_name: 'AskUserQuestion' }], ['StopFailure', { error: 'rate_limit' }]], s);
  assert.equal(s.state, 'failed');
  assert.equal(s.error, 'rate_limit');
});

test('a stop with background work is still working; exit keeps unreviewed results', () => {
  let s = run('claude', 'd', [
    ['UserPromptSubmit', { prompt: 'go' }],
    ['Stop', { last_assistant_message: 'waiting on CI', background_tasks: [{ id: 1 }] }],
  ]);
  assert.equal(s.state, 'working');
  assert.equal(s.background, 1);
  s = run('claude', 'd', [['Stop', { last_assistant_message: 'all green' }], ['SessionEnd', { reason: 'other' }]], s);
  assert.equal(s.state, 'review');
  s = reduce(s, { ts: clock, agent: 'claude', session_id: 'd', type: 'human.acknowledged' });
  assert.equal(s.state, 'ended');
});

test('codex hooks map through the same machine', () => {
  let s = run('codex', 'e', [
    ['UserPromptSubmit', { prompt: 'go' }],
    ['PermissionRequest', { tool_name: 'shell', tool_input: { command: ['git', 'push'] } }],
  ]);
  assert.equal(s.key, 'codex:e');
  assert.equal(s.waiting.detail, 'git push');
  s = run('codex', 'e', [['Interrupt', {}]], s);
  assert.equal(s.state, 'idle');
});

test('attention queue: permission, question, failure, review; oldest first', () => {
  const mk = (key, state, since, kind) => ({ key, state, since, waiting: kind ? { kind } : null });
  const q = attentionQueue([
    mk('review-old', 'review', 1),
    mk('fail', 'failed', 2),
    mk('question', 'needs_input', 3, 'question'),
    mk('perm-new', 'needs_input', 9, 'permission'),
    mk('perm-old', 'needs_input', 4, 'permission'),
    mk('gone', 'unknown', 5),
    mk('busy', 'working', 0),
    { ...mk('hidden', 'review', 0), archived: true },
  ]).map((s) => s.key);
  assert.deepEqual(q, ['perm-old', 'perm-new', 'question', 'fail', 'gone', 'review-old']);
});
