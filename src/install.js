// Adds / removes session-board's hooks in the agents' own config files.
// Existing hooks are left untouched; ours are recognised by a marker.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_EVENTS, CODEX_EVENTS } from './adapters/hooks.js';

const BIN = fileURLToPath(new URL('../bin/session-board.js', import.meta.url));
const MARK = 'session-board';
// A permission request waits for the human; everything else must be instant.
const WAIT_S = 600;
const QUICK_S = 5;

export const configPath = (agent) =>
  agent === 'claude'
    ? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
    : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json');

const isOurs = (h) =>
  (typeof h.url === 'string' && h.url.includes('/ingest/') && h.url.includes(`board=${MARK}`)) ||
  (typeof h.command === 'string' && h.command.includes(MARK) && h.command.includes(' hook '));

export function strip(config) {
  const hooks = config.hooks || {};
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] || [])
      .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((group) => group.hooks.length);
    if (!hooks[event].length) delete hooks[event];
  }
  if (config.hooks && !Object.keys(hooks).length) delete config.hooks;
  return config;
}

// `url` is baked into Claude Code's HTTP hooks. The command bridge (all of
// Codex, and Claude's SessionStart) looks the hub up at call time instead,
// unless `pin` says the hub lives somewhere this machine cannot discover.
export function plan(agent, config, { url, host = hostname(), token = null, pin = false, httpOnly = false } = {}) {
  const next = strip(structuredClone(config));
  next.hooks ||= {};
  const bridge = `node ${JSON.stringify(BIN)} hook ${agent} --host ${JSON.stringify(host)}` +
    (pin ? ` --url ${JSON.stringify(url)}` : '');
  const events = agent === 'claude' ? CLAUDE_EVENTS : CODEX_EVENTS;
  for (const event of events) {
    // On a machine that only has the agent (no session-board checkout), use
    // nothing but HTTP: skip the one event that needs the command bridge.
    if (httpOnly && (agent !== 'claude' || event === 'SessionStart')) continue;
    const timeout = event === 'PermissionRequest' ? WAIT_S : QUICK_S;
    // Claude Code: SessionStart only accepts command/mcp_tool handlers, and the
    // bridge is also what tells us about tmux. Everything else is a direct
    // HTTP POST. Codex has no http handler type at all.
    const handler = agent === 'claude' && event !== 'SessionStart'
      ? {
          type: 'http',
          url: `${url}/ingest/claude?host=${encodeURIComponent(host)}&board=${MARK}`,
          timeout,
          ...(token ? { headers: { Authorization: 'Bearer $SESSION_BOARD_TOKEN' }, allowedEnvVars: ['SESSION_BOARD_TOKEN'] } : {}),
        }
      : { type: 'command', command: bridge, timeout };
    (next.hooks[event] ||= []).push({ hooks: [handler] });
  }
  return next;
}

function load(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

// What is installed right now: { installed, url } (url only for Claude's HTTP hooks).
export function status(agent, path = configPath(agent)) {
  let config;
  try {
    config = load(path);
  } catch {
    return { path, installed: false, error: 'config is not valid JSON' };
  }
  const ours = Object.values(config.hooks || {}).flat().flatMap((g) => g.hooks || []).filter(isOurs);
  const http = ours.find((h) => h.url);
  // Events a newer version wants that this install does not have yet.
  const wanted = agent === 'claude' ? CLAUDE_EVENTS : CODEX_EVENTS;
  const have = new Set(Object.entries(config.hooks || {}).filter(([, groups]) => groups.some((g) => (g.hooks || []).some(isOurs))).map(([event]) => event));
  const missing = ours.length ? wanted.filter((e) => !have.has(e)) : [];
  return { path, installed: ours.length > 0, url: http ? http.url.split('/ingest/')[0] : null, missing };
}

// Opt-in: route Claude Code's status line through the bridge so the board can
// show the usage-limit windows. The user's own status line keeps working.
export function installStatusline({ path = configPath('claude'), remove = false, remember, forget, original } = {}) {
  const config = load(path);
  const ours = (c) => typeof c?.command === 'string' && c.command.includes(MARK) && c.command.includes(' statusline');
  const before = JSON.stringify(config);
  if (remove) {
    if (ours(config.statusLine)) {
      const prev = original();
      if (prev) config.statusLine = { type: 'command', command: prev };
      else delete config.statusLine;
      forget();
    }
  } else if (!ours(config.statusLine)) {
    if (config.statusLine?.command) remember(config.statusLine.command);
    config.statusLine = { type: 'command', command: `node ${JSON.stringify(BIN)} statusline` };
  }
  const changed = JSON.stringify(config) !== before;
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) copyFileSync(path, `${path}.session-board.bak`);
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  }
  return { path, changed, wrapped: !remove && !!original() };
}

export function install(agent, opts = {}) {
  const path = opts.path || configPath(agent);
  const before = load(path);
  const after = opts.remove ? strip(structuredClone(before)) : plan(agent, before, opts);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  // Written only when something changes: Codex re-asks the human to trust
  // hooks whenever the file's contents change.
  if (!opts.dryRun && changed) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) copyFileSync(path, `${path}.session-board.bak`);
    writeFileSync(path, JSON.stringify(after, null, 2) + '\n');
  }
  return { path, after, changed };
}
