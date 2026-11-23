// `session-board doctor`: checks, on this machine, that each piece the board
// relies on actually works, and says what to do about the ones that do not.
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { status as hookStatus } from './install.js';

const BIN = fileURLToPath(new URL('../bin/session-board.js', import.meta.url));
const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err, out, errOut) => resolve({ ok: !err, out: `${out || ''}${errOut || ''}`.trim() })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function doctor({ url, token, env = process.env, log = console.log, pushTest = false } = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const api = async (path, body) => {
    const res = await fetch(url + path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  };
  let failed = 0;
  const pass = (what, note = '') => log(`  ok    ${what}${note ? `  (${note})` : ''}`);
  const warn = (what, fix) => log(`  note  ${what}\n        -> ${fix}`);
  const fail = (what, fix) => { failed += 1; log(`  FAIL  ${what}\n        -> ${fix}`); };

  log('Runtime');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 5)) pass(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old`, 'install Node 22.5 or newer');

  log('Hub');
  const up = await api('/api/sessions').catch(() => null);
  if (!up?.ok) {
    fail(`not reachable at ${url}`, 'start it with: session-board up');
    log('\nThe remaining checks need the hub.');
    return { failed };
  }
  pass(`reachable at ${url}`, `${up.body.sessions.length} sessions, ${up.body.queue.length} waiting`);

  // A full round trip through the same endpoints the agents use.
  const id = `doctor-${Date.now().toString(36)}`;
  const key = `claude:${id}`;
  const row = async () => (await api('/api/sessions')).body.sessions.find((s) => s.key === key);
  try {
    await api('/ingest/claude?host=doctor', { session_id: id, cwd: '/doctor', hook_event_name: 'UserPromptSubmit', prompt: 'doctor self-check' });
    if ((await row())?.state === 'working') pass('a hook event reaches the board');
    else fail('a hook event did not show up', 'check the hub log for errors');

    // Permission round trip: held open, answered through the API, released.
    const asked = fetch(`${url}/ingest/claude?host=doctor`, { method: 'POST', headers, body: JSON.stringify({ session_id: id, cwd: '/doctor', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'echo doctor' } }) }).then((r) => r.json());
    let req = null;
    for (let i = 0; i < 40 && !req; i++) { await sleep(50); req = (await row())?.requests.find((r) => r.decidable); }
    if (!req) fail('a permission request was not held for the board', 'check the hub log');
    else {
      await api(`/api/requests/${req.id}`, { decision: 'deny', message: 'doctor' });
      const answer = await Promise.race([asked, sleep(3000).then(() => null)]);
      if (answer?.hookSpecificOutput?.decision?.behavior === 'deny') pass('a decision made on the board gets back to the agent');
      else fail('the decision did not come back', 'something between the hub and the hook closed the connection early (proxy?)');
    }

    // The command bridge (used by Codex, and by Claude Code at session start).
    const bridged = await new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, 'hook', 'claude', '--host', 'doctor'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('close', () => resolve(true));
      child.on('error', () => resolve(false));
      child.stdin.end(JSON.stringify({ session_id: id, cwd: '/doctor', hook_event_name: 'Stop', last_assistant_message: 'bridge ok' }));
    });
    await sleep(200);
    if (bridged && (await row())?.last_message === 'bridge ok') pass('the command bridge finds the hub');
    else fail('the command bridge could not reach the hub', 'it reads the hub address from ~/.session-board/endpoint.json; is SESSION_BOARD_HOME the same for the hub and the agents?');
  } finally {
    await api(`/api/sessions/${encodeURIComponent(key)}/archive`, {}).catch(() => {});
  }

  log('Agents');
  for (const [agent, bin] of [['claude', 'claude'], ['codex', 'codex']]) {
    const found = await sh(bin, ['--version']);
    const hooks = hookStatus(agent);
    if (!found.ok) { warn(`${bin} is not on PATH`, `nothing to do unless you use ${agent === 'claude' ? 'Claude Code' : 'Codex'} on this machine`); continue; }
    const version = found.out.split('\n')[0];
    if (!hooks.installed) fail(`${bin} ${version}: hooks not installed`, `run: session-board install ${agent}`);
    else if (hooks.url && hooks.url !== url) fail(`${bin}: hooks point at ${hooks.url}, the hub is at ${url}`, 'restart the hub (it repairs this) or run install again');
    else pass(`${bin} ${version}: hooks installed`, agent === 'codex' ? 'run /hooks inside Codex once to trust them' : hooks.path);
  }

  log('Replying into live sessions');
  const tmux = await sh('tmux', ['-V']);
  if (!tmux.ok) warn('tmux is not installed', 'the board can only type into sessions that run inside tmux; without it you can still approve, answer and review');
  else pass(tmux.out, env.TMUX ? 'this shell is inside tmux' : 'start agents inside tmux to be able to reply to them from the board');

  log('Pull requests');
  if (env.SESSION_BOARD_GITHUB === 'off') warn('GitHub lookups are switched off', 'unset SESSION_BOARD_GITHUB to turn them on');
  else {
    const gh = await sh('gh', ['auth', 'status']);
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    if (gh.ok) pass('gh is logged in', 'private repositories work');
    else if (token) {
      // A token that exists is not a token that works: ask GitHub.
      const res = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/rate_limit`, {
        headers: { authorization: `Bearer ${token}`, 'user-agent': 'session-board' }, signal: AbortSignal.timeout(8000),
      }).catch((e) => ({ ok: false, status: e.message }));
      if (res.ok) pass('the GitHub token works', 'used through the REST API');
      else fail(`the GitHub token was refused (${res.status})`, 'it is expired, revoked, or GitHub is unreachable from here: run `gh auth login` or set a valid GITHUB_TOKEN');
    } else warn('no gh login and no GITHUB_TOKEN', 'PR status will only work for public repositories, at a low rate limit: run `gh auth login`');
    // In a repository: try the real lookup for the current branch.
    const branch = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch.ok && branch.out && branch.out !== 'HEAD') {
      const { createGitHub } = await import('./github.js');
      const pr = await createGitHub({ env }).findPr({ cwd: process.cwd(), branch: branch.out });
      if (pr === undefined) warn(`could not look up a PR for branch ${branch.out}`, 'not a GitHub repository, or GitHub did not answer');
      else pass(pr ? `PR lookup works: #${pr.number} is ${pr.state}` : `PR lookup works: no PR for branch ${branch.out}`);
    }
  }

  log('Phone notifications');
  if (!env.SESSION_BOARD_NTFY && !env.SESSION_BOARD_WEBHOOK) warn('not configured', 'set SESSION_BOARD_NTFY=https://ntfy.sh/<topic> for the hub to reach you when you are away');
  else if (!pushTest) pass('configured', 'run doctor --push-test to send a test notification');
  else {
    const target = env.SESSION_BOARD_NTFY || env.SESSION_BOARD_WEBHOOK;
    const res = await fetch(target, env.SESSION_BOARD_NTFY
      ? { method: 'POST', headers: { Title: 'session-board' }, body: 'Test notification from session-board doctor' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'session-board', body: 'Test notification from session-board doctor' }) }).catch((e) => ({ ok: false, status: e.message }));
    if (res.ok) pass('test notification sent', 'check your phone');
    else fail(`the push service answered ${res.status}`, 'check the URL and that this machine can reach it');
  }

  log(failed ? `\n${failed} check(s) failed.` : '\nEverything that could be checked from here works.');
  return { failed };
}
