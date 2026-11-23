// Pull-request status for a session's branch.
//
// Two ways to ask, tried in order:
//   1. the `gh` CLI, when it is installed and logged in: it already has the
//      user's access (private repos, enterprise hosts) and we handle no token;
//   2. the REST API, with GITHUB_TOKEN / GH_TOKEN if set (public repos work
//      without one, at GitHub's low anonymous rate limit).
// Both return the same normalized shape, or null when there is no PR.
import { execFile } from 'node:child_process';

const sh = (cmd, args, cwd) =>
  new Promise((resolve) =>
    execFile(cmd, args, { cwd, timeout: 15_000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? null : out)),
  );

// "owner/repo" from a GitHub remote URL (https, ssh, or scp-style), else null.
export function parseRemote(url) {
  const m = String(url || '').trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// One word for a set of CI results: failing beats pending beats passing.
function rollup(items) {
  if (!items?.length) return null;
  let pending = false;
  for (const c of items) {
    const status = String(c.status || c.state || '').toLowerCase();
    const conclusion = String(c.conclusion || '').toLowerCase();
    if (['failure', 'error', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(conclusion || status)) return 'failing';
    if (conclusion ? false : !['success', 'completed', 'neutral', 'skipped'].includes(status)) pending = true;
  }
  return pending ? 'pending' : 'passing';
}

// Prefer the PR that is still open; otherwise the most recently updated one.
const pick = (prs) =>
  prs.sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.updated - a.updated)[0] || null;

const fromGh = (p) => ({
  number: p.number,
  url: p.url,
  title: p.title,
  state: p.state === 'MERGED' ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed',
  draft: !!p.isDraft,
  head_sha: p.headRefOid || null,
  base: p.baseRefName || null,
  checks: rollup(p.statusCheckRollup),
  review: p.reviewDecision ? String(p.reviewDecision).toLowerCase() : null,
  updated: Date.parse(p.updatedAt) || 0,
});

const fromRest = (p) => ({
  number: p.number,
  url: p.html_url,
  title: p.title,
  state: p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
  draft: !!p.draft,
  head_sha: p.head?.sha || null,
  base: p.base?.ref || null,
  checks: null,
  review: null,
  updated: Date.parse(p.updated_at) || 0,
});

export function createGitHub({
  env = process.env,
  exec = sh,
  fetcher = fetch,
  api = env.GITHUB_API_URL || 'https://api.github.com',
} = {}) {
  let ghOk = null; // null = not checked yet
  let ghCheckedAt = 0;
  async function haveGh() {
    if (ghOk !== null && Date.now() - ghCheckedAt < 10 * 60_000) return ghOk;
    ghCheckedAt = Date.now();
    ghOk = (await exec('gh', ['auth', 'status'])) != null;
    return ghOk;
  }

  async function viaGh(cwd, branch) {
    const out = await exec('gh', [
      'pr', 'list', '--head', branch, '--state', 'all', '--limit', '5', '--json',
      'number,state,url,title,isDraft,headRefOid,baseRefName,updatedAt,reviewDecision,statusCheckRollup',
    ], cwd);
    if (out == null) return undefined; // gh failed: let the caller try REST
    return pick(JSON.parse(out).map(fromGh));
  }

  async function rest(path) {
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    const res = await fetcher(api + path, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'session-board',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  }

  async function viaRest({ owner, repo }, branch) {
    const q = new URLSearchParams({ head: `${owner}:${branch}`, state: 'all', per_page: '5', sort: 'updated', direction: 'desc' });
    const pr = pick((await rest(`/repos/${owner}/${repo}/pulls?${q}`)).map(fromRest));
    if (pr?.state === 'open' && pr.head_sha) {
      const runs = await rest(`/repos/${owner}/${repo}/commits/${pr.head_sha}/check-runs?per_page=100`).catch(() => null);
      pr.checks = rollup(runs?.check_runs);
    }
    return pr;
  }

  // -> normalized PR, null (no PR for this branch), or undefined (could not ask).
  async function findPr({ cwd, slug, branch }) {
    if (env.SESSION_BOARD_GITHUB === 'off' || !branch || branch === 'HEAD') return undefined;
    try {
      if (cwd && (await haveGh())) {
        const pr = await viaGh(cwd, branch);
        if (pr !== undefined) return pr;
      }
      const target = slug || (cwd ? parseRemote(await exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'])) : null);
      if (!target) return undefined;
      return await viaRest(target, branch);
    } catch {
      return undefined;
    }
  }

  return { findPr };
}
