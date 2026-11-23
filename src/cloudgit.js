// Cloud sessions, seen through git. Nothing to set up.
//
// A Claude Code cloud session works on a `claude/…` branch and signs each
// commit with a trailer naming itself:
//     Claude-Session: https://claude.ai/code/session_…
// Both are readable from this machine with the git access the user already
// has. So for every repository the hub knows about, it looks at the remote's
// claude/ branches and learns which cloud sessions exist, what each last did
// and when, and (through the existing PR lookup) how its pull request stands.
//
// What git cannot say is whether a session is waiting for the human. That
// needs one of the routes where the cloud reports in (see the README).
//
// The hub keeps its own small bare repository per remote under its home
// directory, so the user's clones are never fetched into or changed.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes`, GCM_INTERACTIVE: 'never' };
const git = (args, cwd) => new Promise((resolve) =>
  execFile('git', args, { cwd, env: ENV, timeout: 60_000, maxBuffer: 16 << 20 }, (err, out) => resolve(err ? null : out)));

export const BRANCHES = 'claude/*';
const NEAR_TIP = 5;
const SEP = '\x1f';
const END = '\x1e';

// A remote's claude/ branches -> [{ branch, sha, ts, subject, cloud_id, commits }]
export async function readRemote(url, cacheRoot) {
  const dir = join(cacheRoot, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.git`);
  if (!existsSync(dir)) {
    mkdirSync(cacheRoot, { recursive: true });
    if ((await git(['init', '--bare', '--quiet', dir])) == null) return null;
  }
  // Commits only (no file contents), recent history only, pruning branches that are gone.
  const fetch = () => git(['fetch', '--quiet', '--prune', '--no-tags', '--filter=blob:none', '--depth=25', url, `+refs/heads/${BRANCHES}:refs/cs/*`], dir);
  let fetched = await fetch();
  if (fetched == null) {
    // Updating a shallow, blob-less cache trips some git versions and
    // transports. The cache is ours and disposable: start it over once.
    rmSync(dir, { recursive: true, force: true });
    if ((await git(['init', '--bare', '--quiet', dir])) == null) return null;
    fetched = await fetch();
  }
  if (fetched == null) return null; // offline, no access, or not a git remote
  const refs = ((await git(['for-each-ref', '--format=%(refname)', 'refs/cs/'], dir)) || '').split('\n').filter(Boolean);
  const out = [];
  for (const ref of refs.slice(0, 200)) {
    const log = await git(['log', '-25', `--format=%H${SEP}%ct${SEP}%s${SEP}%(trailers:key=Claude-Session,valueonly,separator=%x20)${END}`, ref], dir);
    if (!log) continue;
    const commits = log.split(END).map((c) => c.trim()).filter(Boolean).map((c) => {
      const [sha, ct, subject, trailer] = c.split(SEP);
      const m = /claude\.ai\/code\/session_([A-Za-z0-9]{8,})/.exec(trailer || '');
      return { sha, ts: Number(ct) * 1000, subject, cloud_id: m ? m[1] : null };
    });
    // The newest commit that names a session tells us whose branch this is,
    // as long as it is near the tip (a merge of main on top carries no
    // trailer; a branch someone built long ago on a session's work is not it).
    const at = commits.findIndex((c) => c.cloud_id);
    if (at < 0 || at >= NEAR_TIP) continue;
    const signed = commits[at];
    const mine = commits.filter((c) => c.cloud_id === signed.cloud_id);
    out.push({ branch: ref.replace('refs/cs/', 'claude/'), sha: commits[0].sha, ts: commits[0].ts, subject: commits[0].subject, cloud_id: signed.cloud_id, commits: mine.length, first_ts: mine.at(-1).ts, depth: at });
  }
  // One session, one branch: if two branches lead back to the same session,
  // keep the one whose tip is its own work, then the newer one.
  const best = new Map();
  for (const b of out) {
    const have = best.get(b.cloud_id);
    if (!have || b.depth < have.depth || (b.depth === have.depth && b.ts > have.ts)) best.set(b.cloud_id, b);
  }
  return [...best.values()];
}

// Directories Claude Code has been used in on this machine, newest first.
// Read from the first lines of each project's most recent session file.
export function claudeProjectDirs(root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'), limit = 40) {
  let projects;
  try { projects = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  const found = [];
  for (const p of projects) {
    try {
      const files = readdirSync(join(root, p.name)).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, m: statSync(join(root, p.name, f)).mtimeMs })).sort((a, b) => b.m - a.m);
      if (!files.length) continue;
      const head = readFileSync(join(root, p.name, files[0].f), 'utf8').slice(0, 20_000);
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
      if (m) found.push({ dir: JSON.parse(`"${m[1]}"`), at: files[0].m });
    } catch { /* unreadable project: skip */ }
  }
  return [...new Map(found.sort((a, b) => b.at - a.at).map((x) => [x.dir, x])).keys()].slice(0, limit);
}

export const remoteOf = async (dir) => (existsSync(dir) ? ((await git(['-C', dir, 'remote', 'get-url', 'origin'])) || '').trim() || null : null);
