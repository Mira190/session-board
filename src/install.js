// Adds / removes session-board's hooks in the agents' own config files.
// Existing hooks are left untouched; ours are recognised by a marker.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_EVENTS, CODEX_EVENTS } from './adapters/hooks.js';

const BIN = fileURLToPath(new URL('../bin/session-board.js', import.meta.url));
const MARK = 'session-board';

export const configPath = (agent) =>
  agent === 'claude'
    ? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
    : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json');

const isOurs = (h) =>
  (typeof h.url === 'string' && h.url.includes('/ingest/')) && h.url.includes(`board=${MARK}`) ||
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

export function plan(agent, config, { url, host = hostname(), token = null } = {}) {
  const next = strip(structuredClone(config));
  next.hooks ||= {};
  const q = `host=${encodeURIComponent(host)}&board=${MARK}`;
  const command = {
    type: 'command',
    command: `node ${JSON.stringify(BIN)} hook ${agent} --url ${JSON.stringify(url)} --host ${JSON.stringify(host)}`,
    timeout: 5,
  };
  const http = {
    type: 'http',
    url: `${url}/ingest/claude?${q}`,
    timeout: 5,
    ...(token ? { headers: { Authorization: 'Bearer $SESSION_BOARD_TOKEN' }, allowedEnvVars: ['SESSION_BOARD_TOKEN'] } : {}),
  };
  const events = agent === 'claude' ? CLAUDE_EVENTS : CODEX_EVENTS;
  for (const event of events) {
    // Claude Code: SessionStart only accepts command/mcp_tool handlers, so it
    // goes through the bridge; everything else is a direct HTTP POST.
    // Codex has no http handler type at all.
    const handler = agent === 'claude' && event !== 'SessionStart' ? http : command;
    (next.hooks[event] ||= []).push({ hooks: [handler] });
  }
  return next;
}

function load(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function install(agent, opts = {}) {
  const path = opts.path || configPath(agent);
  const before = load(path);
  const after = opts.remove ? strip(structuredClone(before)) : plan(agent, before, opts);
  if (!opts.dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) copyFileSync(path, `${path}.session-board.bak`);
    writeFileSync(path, JSON.stringify(after, null, 2) + '\n');
  }
  return { path, after };
}
