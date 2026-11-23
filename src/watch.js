// Which repositories to look at for cloud sessions, beyond the ones Claude
// Code has been used in on this machine:
//   - a watch list the user keeps (`session-board watch <url or folder>`);
//   - the repositories they pushed to lately, asked of the `gh` CLI when it is
//     logged in. That covers people who work almost only in the cloud and
//     have no local clones. (Not verified against a real GitHub login.)
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const file = (home) => join(home, 'watch.json');
export const watched = (home) => { try { return JSON.parse(readFileSync(file(home), 'utf8')).filter((u) => typeof u === 'string'); } catch { return []; } };
export function setWatched(home, list) {
  mkdirSync(home, { recursive: true });
  writeFileSync(file(home), JSON.stringify([...new Set(list)], null, 2) + '\n');
}

const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 20_000, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? null : out)));

// -> clone URLs of repositories pushed to in the last `days`, or [] when gh cannot say.
export function recentRepos({ exec = sh, days = 14, now = () => Date.now() } = {}) {
  let cache = { at: 0, urls: [] };
  return async () => {
    if (now() - cache.at < 10 * 60_000) return cache.urls;
    const out = await exec('gh', ['repo', 'list', '--limit', '40', '--json', 'url,pushedAt']);
    let urls = [];
    try {
      urls = JSON.parse(out || '[]').filter((r) => r.url && now() - Date.parse(r.pushedAt) < days * 86_400_000).map((r) => `${r.url}.git`);
    } catch { /* gh missing, logged out, or a shape we do not know */ }
    cache = { at: now(), urls };
    return urls;
  };
}
