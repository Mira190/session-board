#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: process.env.SESSION_BOARD_PORT || '4590' },
    bind: { type: 'string', default: process.env.SESSION_BOARD_BIND || '127.0.0.1' },
    db: { type: 'string' },
    url: { type: 'string' },
    host: { type: 'string', default: hostname() },
    days: { type: 'string', default: '7' },
    sessions: { type: 'string' },
    triage: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    'push-test': { type: 'boolean', default: false },
    model: { type: 'string' },
    interval: { type: 'string', default: '20' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const [cmd, arg] = positionals;

const HELP = `session-board — one place for all your coding-agent sessions

  session-board up                        install hooks for the agents found here, then serve
  session-board serve                     start the hub and the board UI
  session-board install <claude|codex>    add hooks to the agent's config
  session-board uninstall <claude|codex>  remove them again
  session-board doctor [--push-test]      check on this machine that every piece actually works
  session-board status                    is the hub up, are the hooks in place
  session-board backfill [--days 7]       import sessions that predate the hooks
  session-board mcp                       MCP server (stdio) so agents can read the board
  session-board triage [--once] [--model m]   have an agent pre-read the queue and write a note on each item
  session-board demo [--sessions 150]     play scripted sessions into a running hub
  session-board hook <claude|codex>       (used by hooks) forward stdin to the hub

Options: --port 4590  --bind 127.0.0.1  --db <file>  --url <hub url>
         --host <label for this machine>  --dry-run
Env:     SESSION_BOARD_TOKEN  require this bearer token on every request
         SESSION_BOARD_NTFY   push to this ntfy topic URL when a session needs you and you are away
         SESSION_BOARD_WEBHOOK  ...or POST JSON here; SESSION_BOARD_NOTIFY_DETAIL=1 includes the command text
         SESSION_BOARD_HOME   where the database and endpoint file live`;

async function endpoint() {
  const { readEndpoint } = await import('../src/endpoint.js');
  const found = readEndpoint();
  return { url: (opt.url || found.url).replace(/\/$/, ''), token: process.env.SESSION_BOARD_TOKEN || found.token || null };
}
const authHeaders = (token) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

// Runs inside the agent's hook: quick, silent, and it never fails the agent.
async function hook(agent) {
  try {
    let body = '';
    for await (const chunk of process.stdin) body += chunk;
    const { url, token } = await endpoint();
    const q = new URLSearchParams({
      host: opt.host,
      source: 'bridge',
      // Microsecond send time: lets the hub drop a report that arrives after
      // a newer one from this bridge.
      seq: String(Math.round((performance.timeOrigin + performance.now()) * 1000)),
    });
    if (process.env.TMUX && process.env.TMUX_PANE) {
      q.set('tmux_socket', process.env.TMUX.split(',')[0]);
      q.set('tmux_pane', process.env.TMUX_PANE);
    }
    // A permission request waits for the human's answer; the rest must not.
    const waits = /"hook_event_name"\s*:\s*"PermissionRequest"/.test(body);
    const res = await fetch(`${url}/ingest/${agent}?${q}`, {
      method: 'POST',
      headers: authHeaders(token),
      body,
      signal: AbortSignal.timeout(waits ? 590_000 : 1500),
    });
    const answer = await res.text();
    if (waits && res.ok && answer.includes('hookSpecificOutput')) process.stdout.write(answer);
  } catch {
    /* hub not running: the agent must not notice */
  }
}

async function main() {
  if (opt.help || !cmd) return console.log(HELP);
  if (cmd === 'hook') return hook(arg);
  if (cmd === 'mcp') {
    const { serveMcp } = await import('../src/mcp.js');
    return serveMcp({ endpoint, triage: opt.triage });
  }

  // `up`: the one command for a fresh machine. Wires in whichever agents are
  // present, then serves.
  if (cmd === 'up') {
    const { install, configPath } = await import('../src/install.js');
    const { existsSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const url = `http://127.0.0.1:${opt.port}`;
    for (const agent of ['claude', 'codex']) {
      if (!existsSync(dirname(configPath(agent)))) { console.log(`${agent}: not found on this machine, skipped`); continue; }
      const { changed, path } = install(agent, { url, host: opt.host, token: process.env.SESSION_BOARD_TOKEN || null });
      console.log(`${agent}: hooks ${changed ? 'installed' : 'already in place'} (${path})`);
      if (agent === 'codex' && changed) console.log('  Codex asks you to review new hooks: run /hooks inside Codex once.');
    }
  }
  if (cmd === 'serve' || cmd === 'up') {
    const { createHub } = await import('../src/hub.js');
    const { writeEndpoint, home } = await import('../src/endpoint.js');
    const { install, status } = await import('../src/install.js');
    const token = process.env.SESSION_BOARD_TOKEN || null;
    const local = opt.bind === '127.0.0.1' || opt.bind === 'localhost';
    if (!local && !token) {
      console.error('Refusing to listen beyond localhost without SESSION_BOARD_TOKEN set.');
      process.exit(1);
    }
    const db = opt.db || process.env.SESSION_BOARD_DB || join(home(), 'board.db');
    const url = `http://127.0.0.1:${opt.port}`;
    // Links in phone notifications must point somewhere the phone can reach.
    const boardUrl = (process.env.SESSION_BOARD_PUBLIC_URL || url).replace(/\/$/, '');
    const { triageDir } = await import('../src/triage.js');
    const hub = createHub({ dbPath: db, token, localHost: opt.host, boardUrl, ignoreCwds: [triageDir(home())] });
    await hub.listen(Number(opt.port), opt.bind);
    writeEndpoint({ url, token });
    console.log(`session-board on ${url}${token ? '/?token=…' : ''}  (db: ${db})`);
    if (process.env.SESSION_BOARD_NTFY || process.env.SESSION_BOARD_WEBHOOK) console.log('phone notifications: on (sent when no board page is in view)');
    // Claude Code's HTTP hooks carry the hub address; follow the hub if it moved.
    const claude = status('claude');
    if (claude.installed && claude.url !== url) {
      install('claude', { url, host: opt.host, token });
      console.log(`updated Claude Code hooks: ${claude.url} -> ${url}`);
    }
    const lost = await hub.reconcile().catch(() => 0);
    if (lost) console.log(`${lost} session(s) had no agent process left and were marked unknown`);
    const settled = await hub.settle().catch(() => 0);
    if (settled) console.log(`${settled} session(s) were settled (merged or long finished)`);
    return;
  }

  if (cmd === 'install' || cmd === 'uninstall') {
    if (arg !== 'claude' && arg !== 'codex') throw new Error('specify claude or codex');
    const { install } = await import('../src/install.js');
    const { url, token } = await endpoint();
    const { path, after, changed } = install(arg, {
      url, host: opt.host, token, pin: !!opt.url, dryRun: opt['dry-run'], remove: cmd === 'uninstall',
    });
    if (opt['dry-run']) console.log(JSON.stringify(after, null, 2));
    console.log(!changed ? `${path} is already up to date` : `${opt['dry-run'] ? 'Would write' : 'Wrote'} ${path}`);
    if (arg === 'codex' && cmd === 'install' && changed && !opt['dry-run']) {
      console.log('Codex asks you to review new hooks: run /hooks inside Codex once to trust them.');
    }
    return;
  }

  // Pre-read the queue with a boxed-in agent whenever something has no note yet.
  if (cmd === 'triage') {
    const { runOnce } = await import('../src/triage.js');
    const { home } = await import('../src/endpoint.js');
    const { url, token } = await endpoint();
    const pending = () => fetch(`${url}/api/triage`, { headers: authHeaders(token), signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    console.log(`triage: watching ${url}${opt.model ? ` with model ${opt.model}` : ''}. It writes notes; it cannot approve anything.`);
    for (;;) {
      const items = await pending();
      if (items === null) console.log('triage: hub not reachable');
      else if (items.length) {
        const t0 = Date.now();
        const { ok, out } = await runOnce({ home: home(), model: opt.model });
        const left = (await pending())?.length ?? '?';
        console.log(`triage: ${items.length} item(s) -> ${ok ? 'done' : 'run failed'} in ${Math.round((Date.now() - t0) / 1000)}s, ${left} still without a note${ok ? '' : `\n${out.slice(-400)}`}`);
        if (!ok && !opt.once) await new Promise((r) => setTimeout(r, 60_000)); // do not hammer on a failure
      } else if (opt.once) console.log('triage: nothing to do');
      if (opt.once) return;
      await new Promise((r) => setTimeout(r, Math.max(5, Number(opt.interval)) * 1000));
    }
  }

  if (cmd === 'doctor') {
    const { doctor } = await import('../src/doctor.js');
    const { url, token } = await endpoint();
    const { failed } = await doctor({ url, token, pushTest: opt['push-test'] });
    process.exit(failed ? 1 : 0);
  }

  if (cmd === 'status') {
    const { status } = await import('../src/install.js');
    const { url, token } = await endpoint();
    const up = await fetch(`${url}/api/sessions`, { headers: authHeaders(token), signal: AbortSignal.timeout(1500) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    console.log(`hub     ${url}  ${up ? `up, ${up.sessions.length} sessions, ${up.queue.length} waiting on you` : 'not reachable'}`);
    for (const agent of ['claude', 'codex']) {
      const s = status(agent);
      const note = !s.installed ? 'hooks not installed' : s.url && s.url !== url ? `hooks point at ${s.url} (start the hub to repair)` : 'hooks installed';
      console.log(`${agent.padEnd(7)} ${note}  (${s.path})`);
    }
    return;
  }

  if (cmd === 'backfill' || cmd === 'demo') {
    const { url, token } = await endpoint();
    if (cmd === 'demo') {
      const { demo, demoFleet } = await import('../src/demo.js');
      if (opt.sessions) await demoFleet(url, Number(opt.sessions), { headers: authHeaders(token) });
      else await demo(url, { headers: authHeaders(token) });
      return console.log('demo events sent. Its permission requests stay open until you answer them in the board (Ctrl+C to stop).');
    }
    const res = await fetch(`${url}/api/backfill`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ days: Number(opt.days) }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    return console.log(`found ${out.scanned} sessions in the last ${opt.days} days, imported ${out.imported} new`);
  }

  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
