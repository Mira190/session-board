// Reads the agents' own session files, for two things hooks do not carry:
// usage/cost, and sessions that existed before the hooks were installed.
//
// These formats are internal to each vendor and may change in any release, so
// everything here is best-effort: unknown shapes are skipped, never fatal.
// Claude Code's format was checked against real files (v2.1.330). The Codex
// rollout format is implemented from memory of its layout and is unverified.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const TAIL = 6 << 20;

async function readLines(path, { tailOnly = false } = {}) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const start = tailOnly && size > TAIL ? size - TAIL : 0;
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // partial first line
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* torn write */
      }
    }
    return out;
  } finally {
    await fh.close();
  }
}

const num = (v) => (Number.isFinite(v) ? v : 0);

export function claudeUsage(lines) {
  let usage = null;
  let model = null;
  let cost = null;
  const output = new Map();
  for (const l of lines) {
    if (l.type === 'assistant' && l.message?.usage && !l.isSidechain) {
      usage = l.message.usage;
      model = l.message.model || model;
      output.set(l.requestId || l.uuid, num(usage.output_tokens));
    } else if (l.type === 'cost-state' && Number.isFinite(l.totalCostUSD)) {
      cost = l.totalCostUSD; // Claude Code's own running total for the session
    }
  }
  if (!usage) return null;
  return {
    model,
    context_tokens:
      num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens),
    output_tokens: [...output.values()].reduce((a, b) => a + b, 0),
    ...(cost != null ? { cost_usd: Math.round(cost * 10000) / 10000 } : {}),
  };
}

export function codexUsage(lines) {
  let info = null;
  let model = null;
  for (const l of lines) {
    const p = l.payload || {};
    if (p.type === 'token_count' && p.info) info = p.info;
    if (typeof p.model === 'string') model = p.model;
  }
  if (!info) return null;
  const last = info.last_token_usage || {};
  const total = info.total_token_usage || {};
  return {
    model,
    context_tokens: num(last.input_tokens) || num(last.total_tokens),
    output_tokens: num(total.output_tokens),
  };
}

export async function usageFor(agent, path) {
  const lines = await readLines(path, { tailOnly: true });
  return agent === 'claude' ? claudeUsage(lines) : codexUsage(lines);
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((c) => c?.type === 'tool_result')) return null;
  return content.filter((c) => typeof c?.text === 'string').map((c) => c.text).join('\n') || null;
};
// Slash-command echoes and injected reminders are not what the human asked.
const real = (t) => t && !/^\s*<(command-|local-command|system-reminder|task-notification)/.test(t);

export function summarizeClaude(lines) {
  const s = { session_id: null, cwd: null, branch: null, title: null, last_prompt: null, last_message: null, turns: 0 };
  for (const l of lines) {
    if (l.isSidechain) continue;
    s.session_id ||= l.sessionId || null;
    s.cwd ||= l.cwd || null;
    if (l.gitBranch) s.branch = l.gitBranch;
    if (l.type === 'user') {
      const t = textOf(l.message?.content);
      if (real(t)) {
        s.turns += 1;
        s.title ||= t.split('\n')[0];
        s.last_prompt = t;
      }
    } else if (l.type === 'assistant') {
      const t = textOf(l.message?.content);
      if (t) s.last_message = t;
    }
  }
  return s.session_id && s.turns ? s : null;
}

export function summarizeCodex(lines) {
  const s = { session_id: null, cwd: null, branch: null, title: null, last_prompt: null, last_message: null, turns: 0 };
  for (const l of lines) {
    const p = l.payload || {};
    if (l.type === 'session_meta') {
      s.session_id ||= p.id || null;
      s.cwd ||= p.cwd || null;
      s.branch ||= p.git?.branch || null;
    } else if (p.type === 'user_message' && typeof p.message === 'string') {
      s.turns += 1;
      s.title ||= p.message.split('\n')[0];
      s.last_prompt = p.message;
    } else if (p.type === 'agent_message' && typeof p.message === 'string') {
      s.last_message = p.message;
    }
  }
  return s.session_id && s.turns ? s : null;
}

async function walk(dir, match, depth, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth > 0) await walk(p, match, depth - 1, out);
    else if (e.isFile() && match(e.name)) out.push(p);
  }
  return out;
}

export const roots = () => ({
  claude: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'),
  codex: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
});

// -> [{ agent, path, mtime, summary, usage }] for sessions touched in the last `days`.
export async function scanHistory({ days = 7, now = Date.now(), dirs = roots() } = {}) {
  const since = now - days * 86_400_000;
  const files = [
    // <projects>/<project>/<session>.jsonl — depth 1 skips nested subagent logs
    ...(await walk(dirs.claude, (n) => n.endsWith('.jsonl'), 1)).map((path) => ({ agent: 'claude', path })),
    // <sessions>/YYYY/MM/DD/rollout-*.jsonl
    ...(await walk(dirs.codex, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 3)).map((path) => ({ agent: 'codex', path })),
  ];
  const found = [];
  for (const f of files) {
    try {
      const st = await stat(f.path);
      if (st.mtimeMs < since) continue;
      const lines = await readLines(f.path);
      const summary = f.agent === 'claude' ? summarizeClaude(lines) : summarizeCodex(lines);
      if (!summary) continue;
      const usage = f.agent === 'claude' ? claudeUsage(lines) : codexUsage(lines);
      found.push({ ...f, mtime: Math.round(st.mtimeMs), summary: { ...summary, repo: summary.cwd ? basename(summary.cwd) : null }, usage });
    } catch {
      /* unreadable file: skip */
    }
  }
  return found.sort((a, b) => a.mtime - b.mtime);
}
