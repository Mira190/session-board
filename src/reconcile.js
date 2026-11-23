// Is there still an agent process behind a session we show as active?
// Hooks cannot tell us about a crash or a killed terminal, so we look.
import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { basename } from 'node:path';

const sh = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 4000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? null : out)),
  );

const KIND = [
  ['claude', /^claude(\.exe|\.js|\.cjs|\.mjs)?$/],
  ['codex', /^codex([-.].*)?$/],
];
const RUNTIME = /^(node|bun|deno)(\.exe)?$/;

export function classify(args) {
  const [a0, a1] = args.trim().split(/\s+/);
  const names = [basename(a0 || '')];
  if (RUNTIME.test(names[0]) && a1) names.push(basename(a1));
  for (const [agent, re] of KIND) if (names.some((n) => re.test(n))) return agent;
  return null;
}

// -> [{ agent, pid, cwd | null }], or null when the process list is unavailable.
export async function liveAgents() {
  const out = await sh('ps', ['-eo', 'pid=,args=']);
  if (out == null) return null;
  const found = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const agent = classify(m[2]);
    if (agent) found.push({ agent, pid: Number(m[1]), cwd: null });
  }
  if (process.platform === 'linux') {
    await Promise.all(found.map(async (p) => (p.cwd = await readlink(`/proc/${p.pid}/cwd`).catch(() => null))));
  } else if (found.length) {
    const lsof = await sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', found.map((p) => p.pid).join(',')]);
    let pid = null;
    for (const line of (lsof || '').split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1));
      else if (line[0] === 'n') {
        const p = found.find((x) => x.pid === pid);
        if (p) p.cwd = line.slice(1);
      }
    }
  }
  return found;
}

const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

// Returns a reason string when the session is certainly orphaned, else null.
// Anything uncertain counts as alive: a false "lost" is worse than a late one.
export function orphanReason(session, agents) {
  if (!agents) return null;
  const same = agents.filter((p) => p.agent === session.agent);
  if (!same.length) return `no ${session.agent} process is running on this machine`;
  if (!session.cwd || same.some((p) => !p.cwd)) return null;
  if (same.some((p) => related(p.cwd, session.cwd))) return null;
  return `no ${session.agent} process is running in ${session.cwd}`;
}
