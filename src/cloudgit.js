// Cloud sessions, seen through git. Nothing to set up.
//
// A Claude Code cloud session works on a `claude/…` branch and signs each
// commit with a trailer naming itself:
//     Claude-Session: https://claude.ai/code/session_…
// Both are readable from this machine with the git access the user already
// has. So for every repository the hub knows about, it looks at the remote's
// claude/ branches and learns which cloud sessions exist, what each did and
// when, how far it is from the default branch, which files it changed and
// whether it would conflict, and it can show the diff for review.
//
// What git cannot say is whether a session is waiting for the human. That
// needs one of the routes where the cloud reports in (see the README).
//
// The hub keeps its own bare repository per remote under its home directory,
// so the user's clones are never fetched into or changed. That repository is
// a partial clone holding commits only; the trees and file contents a diff
// needs are fetched when someone actually opens that diff.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes`, GCM_INTERACTIVE: 'never' };
// -> stdout, or null on failure. `okCodes` are exit codes that are answers, not errors.
const git = (args, cwd, { okCodes = [], timeout = 90_000 } = {}) => new Promise((resolve) =>
  execFile('git', args, { cwd, env: ENV, timeout, maxBuffer: 32 << 20 }, (err, out) => resolve(err && !okCodes.includes(err.code) ? null : out)));

export const PREFIX = process.env.SESSION_BOARD_CLOUD_BRANCHES || 'claude/';
const NEAR_TIP = 5;
const DEPTH = 300;
const SEP = '\x1f';
const END = '\x1e';
const MAX_DIFF = 300 * 1024;

const cacheDir = (url, cacheRoot) => join(cacheRoot, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.git`);

async function ensureCache(url, cacheRoot) {
  const dir = cacheDir(url, cacheRoot);
  if (existsSync(join(dir, 'HEAD'))) return dir;
  mkdirSync(cacheRoot, { recursive: true });
  if ((await git(['init', '--bare', '--quiet', dir])) == null) return null;
  // A partial clone of `origin`: missing trees and blobs are fetched on demand.
  for (const [k, v] of [['remote.origin.url', url], ['remote.origin.promisor', 'true'], ['remote.origin.partialclonefilter', 'tree:0'], ['extensions.partialClone', 'origin']]) {
    await git(['config', k, v], dir);
  }
  return dir;
}

// One cheap request: where the session branches and the default branch point.
// -> { base: 'main', baseSha, heads: Map(branch -> sha) } or null if unreachable.
export async function lsRemote(url) {
  const out = await git(['ls-remote', '--symref', url, 'HEAD', `refs/heads/${PREFIX}*`], undefined, { timeout: 30_000 });
  if (out == null) return null;
  let base = null;
  let baseSha = null;
  const heads = new Map();
  for (const line of out.split('\n')) {
    const sym = /^ref: refs\/heads\/(\S+)\s+HEAD$/.exec(line);
    if (sym) { base = sym[1]; continue; }
    const m = /^([0-9a-f]{40,})\s+(\S+)$/.exec(line);
    if (!m) continue;
    if (m[2] === 'HEAD') baseSha = m[1];
    else if (m[2].startsWith('refs/heads/')) heads.set(m[2].slice('refs/heads/'.length), m[1]);
  }
  return { base, baseSha, heads };
}

async function fetchInto(dir, base) {
  const specs = [`+refs/heads/${PREFIX}*:refs/cs/*`, ...(base ? [`+refs/heads/${base}:refs/base`] : [])];
  return git(['fetch', '--quiet', '--prune', '--no-tags', '--filter=tree:0', `--depth=${DEPTH}`, 'origin', ...specs], dir);
}

// Read a remote's session branches.
// -> { dir, base, branches: [{ branch, ref, sha, ts, subject, cloud_id, commits: [{sha, ts, subject}], ahead, behind }] } or null.
export async function readRemote(url, cacheRoot, seen = null) {
  const remote = seen || (await lsRemote(url));
  if (!remote) return null;
  let dir = await ensureCache(url, cacheRoot);
  if (!dir) return null;
  if ((await fetchInto(dir, remote.base)) == null) {
    // Updating a shallow partial clone trips some git versions and transports.
    // The cache is ours and disposable: start it over once.
    rmSync(dir, { recursive: true, force: true });
    dir = await ensureCache(url, cacheRoot);
    if (!dir || (await fetchInto(dir, remote.base)) == null) return null;
  }
  const refs = ((await git(['for-each-ref', '--format=%(refname)', 'refs/cs/'], dir)) || '').split('\n').filter(Boolean);
  const found = [];
  for (const ref of refs.slice(0, 300)) {
    const log = await git(['log', '-40', `--format=%H${SEP}%ct${SEP}%s${SEP}%(trailers:key=Claude-Session,valueonly,separator=%x20)${END}`, ref], dir);
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
    const cloudId = commits[at].cloud_id;
    // How far it is from the default branch. Unknown when history is too deep.
    const lr = remote.base ? await git(['rev-list', '--left-right', '--count', `refs/base...${ref}`], dir) : null;
    const [behind, ahead] = lr ? lr.trim().split(/\s+/).map(Number) : [null, null];
    found.push({
      branch: ref.replace('refs/cs/', PREFIX), ref, sha: commits[0].sha, ts: commits[0].ts, subject: commits[0].subject, cloud_id: cloudId, depth: at,
      commits: commits.filter((c) => c.cloud_id === cloudId).slice(0, 15).map(({ sha, ts, subject }) => ({ sha: sha.slice(0, 10), ts, subject })),
      ahead: Number.isFinite(ahead) ? ahead : null, behind: Number.isFinite(behind) ? behind : null,
    });
  }
  // One session, one branch: if two branches lead back to the same session,
  // keep the one whose tip is its own work, then the newer one.
  const best = new Map();
  for (const b of found) {
    const have = best.get(b.cloud_id);
    if (!have || b.depth < have.depth || (b.depth === have.depth && b.ts > have.ts)) best.set(b.cloud_id, b);
  }
  return { dir, base: remote.base, branches: [...best.values()] };
}

const mergeBase = async (dir, ref) => ((await git(['merge-base', 'refs/base', ref], dir)) || '').trim() || null;

// Files the branch changed relative to where it left the default branch.
// (Fetches the trees it needs on demand.)
export async function branchFiles(dir, ref) {
  const from = await mergeBase(dir, ref);
  if (!from) return null;
  const out = await git(['diff', '--name-only', from, ref], dir);
  return out == null ? null : out.split('\n').filter(Boolean).slice(0, 300);
}

// Would the branch merge cleanly into `other` (default: the default branch)?
// A dry run. -> [] clean, [files] conflicting, null could not tell.
export async function branchConflicts(dir, ref, other = 'refs/base') {
  const res = await new Promise((resolve) => execFile('git', ['merge-tree', '--write-tree', '--name-only', other, ref], { cwd: dir, env: ENV, timeout: 60_000, maxBuffer: 8 << 20 },
    (err, out) => resolve({ code: err ? err.code : 0, out: out || '' })));
  if (res.code === 0) return [];
  if (res.code !== 1) return null;
  return res.out.split('\n').slice(1).filter((l) => l && !l.includes(' ')).slice(0, 12);
}

// The branch's changes as a diff, with each file's content id (for "reviewed" marks).
export async function branchDiff(dir, ref) {
  const from = await mergeBase(dir, ref);
  if (!from) return null;
  const [stat, diff, tree] = await Promise.all([
    git(['diff', '--stat', from, ref], dir),
    git(['diff', from, ref], dir),
    git(['diff', '--raw', '--no-abbrev', '--no-renames', from, ref], dir),
  ]);
  if (diff == null) return null;
  const files = (tree || '').split('\n').filter(Boolean).map((l) => {
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) (\w)\t(.+)$/.exec(l);
    return m ? { path: m[3], hash: m[2] === 'D' ? 'deleted' : m[1] } : null;
  }).filter(Boolean);
  return { stat: (stat || '').trim(), diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF, files };
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
