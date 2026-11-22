#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: process.env.SESSION_BOARD_PORT || '4590' },
    bind: { type: 'string', default: process.env.SESSION_BOARD_BIND || '127.0.0.1' },
    db: { type: 'string', default: process.env.SESSION_BOARD_DB || join(homedir(), '.session-board', 'board.db') },
    url: { type: 'string', default: process.env.SESSION_BOARD_URL },
    host: { type: 'string', default: hostname() },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const [cmd, arg] = positionals;
const url = (opt.url || `http://127.0.0.1:${opt.port}`).replace(/\/$/, '');
const token = process.env.SESSION_BOARD_TOKEN || null;

const HELP = `session-board — one inbox for all your coding-agent sessions

  session-board serve                 start the hub and the board UI
  session-board install <claude|codex>    add hooks to the agent's config
  session-board uninstall <claude|codex>  remove them again
  session-board demo                  play scripted sessions into a running hub
  session-board hook <claude|codex>   (used by hooks) forward stdin to the hub

Options: --port 4590  --bind 127.0.0.1  --db <file>  --url <hub url>
         --host <label for this machine>  --dry-run
Env:     SESSION_BOARD_TOKEN  require this bearer token on every request`;

async function main() {
  if (opt.help || !cmd) return console.log(HELP);

  if (cmd === 'hook') {
    // Runs inside the agent's hook: must be quick, silent, and never fail.
    try {
      let body = '';
      for await (const chunk of process.stdin) body += chunk;
      await fetch(`${url}/ingest/${arg}?host=${encodeURIComponent(opt.host)}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      /* hub not running: the agent must not notice */
    }
    return;
  }

  if (cmd === 'serve') {
    const { createHub } = await import('../src/hub.js');
    if (opt.bind !== '127.0.0.1' && opt.bind !== 'localhost' && !token) {
      console.error('Refusing to listen beyond localhost without SESSION_BOARD_TOKEN set.');
      process.exit(1);
    }
    const hub = createHub({ dbPath: opt.db, token });
    await hub.listen(Number(opt.port), opt.bind);
    console.log(`session-board on http://${opt.bind}:${opt.port}  (db: ${opt.db})`);
    return;
  }

  if (cmd === 'install' || cmd === 'uninstall') {
    if (arg !== 'claude' && arg !== 'codex') throw new Error('specify claude or codex');
    const { install } = await import('../src/install.js');
    const { path, after } = install(arg, {
      url, host: opt.host, token, dryRun: opt['dry-run'], remove: cmd === 'uninstall',
    });
    if (opt['dry-run']) console.log(JSON.stringify(after, null, 2));
    console.log(`${opt['dry-run'] ? 'Would write' : 'Wrote'} ${path}`);
    if (arg === 'codex' && cmd === 'install' && !opt['dry-run']) {
      console.log('Codex asks you to review new hooks: run /hooks inside Codex once to trust them.');
    }
    return;
  }

  if (cmd === 'demo') {
    const { demo } = await import('../src/demo.js');
    await demo(url);
    return console.log('demo events sent');
  }

  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
