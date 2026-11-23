import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHub, parseRemote } from '../src/github.js';
import { createHub, PR_POLL_MS } from '../src/hub.js';

test('remote URLs: https, ssh, scp-style; other hosts are not GitHub', () => {
  const want = { owner: 'acme', repo: 'shop-api' };
  for (const url of [
    'https://github.com/acme/shop-api', 'https://github.com/acme/shop-api.git', 'https://token@github.com/acme/shop-api.git/',
    'git@github.com:acme/shop-api.git', 'ssh://git@github.com/acme/shop-api',
  ]) assert.deepEqual(parseRemote(url), want, url);
  assert.equal(parseRemote('https://gitlab.com/acme/shop-api.git'), null);
  assert.equal(parseRemote(null), null);
});

test('with gh logged in, its answer is used and normalized', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args.slice(0, 2)].join(' '));
    if (args[0] === 'auth') return 'ok';
    return JSON.stringify([
      { number: 7, state: 'MERGED', url: 'u7', title: 'old', isDraft: false, headRefOid: 'aaa', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z', statusCheckRollup: [] },
      { number: 9, state: 'OPEN', url: 'u9', title: 'new', isDraft: true, headRefOid: 'bbb', baseRefName: 'main', updatedAt: '2025-01-01T00:00:00Z',
        reviewDecision: 'CHANGES_REQUESTED',
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }, { state: 'SUCCESS' }] },
    ]);
  };
  const gh = createGitHub({ env: {}, exec, fetcher: () => assert.fail('REST must not be used') });
  const pr = await gh.findPr({ cwd: '/w', branch: 'feature' });
  assert.equal(pr.number, 9, 'an open PR is preferred over a newer merged one');
  assert.deepEqual([pr.state, pr.draft, pr.checks, pr.review, pr.head_sha], ['open', true, 'pending', 'changes_requested', 'bbb']);
  await gh.findPr({ cwd: '/w', branch: 'feature' });
  assert.equal(calls.filter((c) => c.startsWith('gh auth')).length, 1, 'login is checked once, not per lookup');
});

test('without gh, the REST API answers: merged, checks, no PR, and failure', async () => {
  const seen = [];
  const exec = async (cmd, args) => (cmd === 'git' ? 'git@github.com:acme/shop-api.git\n' : null); // gh: not logged in
  const routes = {
    '/repos/acme/shop-api/pulls?head=acme%3Asquashed&state=all&per_page=5&sort=updated&direction=desc':
      [{ number: 3, html_url: 'h3', title: 'squashed', state: 'closed', merged_at: '2026-02-02T00:00:00Z', draft: false, head: { sha: 'tip' }, base: { ref: 'main' }, updated_at: '2026-02-02T00:00:00Z' }],
    '/repos/acme/shop-api/pulls?head=acme%3Aopen&state=all&per_page=5&sort=updated&direction=desc':
      [{ number: 4, html_url: 'h4', title: 'open', state: 'open', merged_at: null, draft: false, head: { sha: 'abc' }, base: { ref: 'main' }, updated_at: '2026-02-03T00:00:00Z' }],
    '/repos/acme/shop-api/commits/abc/check-runs?per_page=100':
      { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }] },
    '/repos/acme/shop-api/pulls?head=acme%3Anone&state=all&per_page=5&sort=updated&direction=desc': [],
  };
  const fetcher = async (url, init) => {
    const path = url.replace('https://api.example', '');
    seen.push(init.headers.authorization);
    return path in routes ? { ok: true, json: async () => routes[path] } : { ok: false, status: 500 };
  };
  const gh = createGitHub({ env: { GITHUB_TOKEN: 'tok' }, exec, fetcher, api: 'https://api.example' });
  const merged = await gh.findPr({ cwd: '/w', branch: 'squashed' });
  assert.deepEqual([merged.state, merged.head_sha, merged.base, merged.url], ['merged', 'tip', 'main', 'h3']);
  assert.equal((await gh.findPr({ cwd: '/w', branch: 'open' })).checks, 'failing');
  assert.equal(await gh.findPr({ cwd: '/w', branch: 'none' }), null, 'no PR is an answer');
  assert.equal(await gh.findPr({ cwd: '/w', branch: 'boom' }), undefined, 'an error is "could not ask", not "no PR"');
  assert.equal(await gh.findPr({ cwd: '/w', branch: 'HEAD' }), undefined, 'a detached HEAD has no branch to look up');
  assert.ok(seen.every((a) => a === 'Bearer tok'));
  assert.equal(await createGitHub({ env: { SESSION_BOARD_GITHUB: 'off' }, exec, fetcher }).findPr({ cwd: '/w', branch: 'open' }), undefined);
});

test('a squash-merged PR settles the review, but only for the commit this session left', async () => {
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  const repo = mkdtempSync(join(tmpdir(), 'sb-pr-'));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  git(repo, 'checkout', '-qb', 'feature');

  let t = Date.now();
  let answer = null; // what "GitHub" says about the branch
  let asked = 0;
  const hub = createHub({ localHost: 'laptop', now: () => t, github: { findPr: async () => (asked += 1, answer) } });
  const { port } = await hub.listen(0, '127.0.0.1');
  const hook = (name, extra = {}) => fetch(`http://127.0.0.1:${port}/ingest/claude?host=laptop`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's', cwd: repo, hook_event_name: name, ...extra }),
  });
  const until = async (fn) => { for (let i = 0; i < 300; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } assert.fail('timed out'); };
  const s = () => hub.store.get('claude:s');

  await hook('UserPromptSubmit', { prompt: 'do it' });
  await until(() => s().start_head);
  writeFileSync(join(repo, 'a.txt'), 'two\n'); git(repo, 'commit', '-qam', 'work');
  const tip = git(repo, 'rev-parse', 'HEAD');
  answer = { number: 12, url: 'https://github.com/acme/x/pull/12', title: 'Do it', state: 'open', draft: false, head_sha: tip, base: 'main', checks: 'pending', review: null, updated: 1 };
  await hook('Stop', { last_assistant_message: 'opened a PR' });
  await until(() => s().pr);
  assert.deepEqual([s().state, s().pr.number, s().pr.state, s().pr.checks], ['review', 12, 'open', 'pending']);
  assert.equal(s().pr.updated, undefined, 'the timestamp used for choosing is not stored');
  assert.equal(await hub.settle(), 0, 'an open PR settles nothing');

  // Polling is throttled per session, then picks up the change made on github.com.
  const before = asked;
  answer = { ...answer, state: 'merged', checks: null };
  assert.equal(await hub.settle(), 0);
  assert.equal(asked, before, 'not asked again within the poll interval');
  t += PR_POLL_MS + 1;

  // A merged PR whose head is some other commit (reused branch name) must not count.
  answer = { ...answer, head_sha: 'someoldcommit' };
  assert.equal(await hub.settle(), 0);
  assert.equal(s().state, 'review');

  // Squash merge: main gets a brand-new commit, so git ancestry says "not merged".
  git(repo, 'checkout', '-q', 'main'); git(repo, 'merge', '-q', '--squash', 'feature'); git(repo, 'commit', '-qm', 'Do it (#12)'); git(repo, 'checkout', '-q', 'feature');
  answer = { ...answer, head_sha: tip };
  t += PR_POLL_MS + 1;
  assert.equal(await hub.settle(), 1);
  assert.deepEqual([s().state, s().settled, s().pr.state], ['idle', 'merged', 'merged']);
  const last = hub.store.events('claude:s').filter((e) => e.type === 'session.settled').at(-1);
  assert.deepEqual(last.data, { reason: 'merged', into: 'main', by: 'pull request', pr: 12 });

  // "Could not ask" keeps the last known PR instead of erasing it.
  answer = undefined;
  t += PR_POLL_MS + 1;
  await hub.refreshPr('claude:s', { force: true });
  assert.equal(s().pr.number, 12);
  await hub.close();
});
