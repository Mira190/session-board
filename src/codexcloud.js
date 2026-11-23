// Codex cloud tasks, through Codex's own CLI (`codex cloud list --json`).
//
// This is the sanctioned way to see them: no private web API, the user's own
// login. It is OFF unless SESSION_BOARD_CODEX_CLOUD=1, because the shape of
// that JSON is not documented and could not be checked here (no Codex login
// in the development environment). The reader below accepts the field names a
// task list plausibly uses and ignores what it does not recognise; run
// `session-board codex-cloud` to see what it makes of your real data.
import { execFile } from 'node:child_process';

const sh = (cmd, args) => new Promise((resolve) =>
  execFile(cmd, args, { timeout: 30_000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? null : out)));

const pick = (o, names) => { for (const n of names) if (o?.[n] != null && o[n] !== '') return o[n]; return null; };

// status text -> what it means for the human
export function phaseOf(status) {
  const s = String(status || '').toLowerCase();
  if (/fail|error/.test(s)) return 'failed';
  if (/cancel|abort/.test(s)) return 'cancelled';
  if (/ready|complete|done|success|finish|review|merged|applied/.test(s)) return 'finished';
  if (/pend|queue|run|progress|work|start|creat/.test(s)) return 'working';
  return null;
}

export function readTasks(json) {
  const list = Array.isArray(json) ? json : json?.tasks || json?.items || json?.data || [];
  return list.map((t) => ({
    id: pick(t, ['id', 'task_id', 'taskId']),
    title: pick(t, ['title', 'summary', 'name', 'prompt', 'description']),
    status: pick(t, ['status', 'state']),
    url: pick(t, ['url', 'html_url', 'web_url']),
    repo: pick(t, ['repo', 'repository', 'environment_label', 'environment']),
  })).filter((t) => t.id);
}

// -> normalized events for the hub. Each carries an id, so listing the same
// task in the same state again changes nothing.
export function toEvents(tasks) {
  const events = [];
  for (const t of tasks) {
    const base = { agent: 'codex', session_id: String(t.id), runtime: 'cloud', host: 'codex-cloud' };
    const phase = phaseOf(t.status);
    events.push({ ...base, id: `cloud:${t.id}:seen`, type: 'prompt.submitted', data: { prompt: String(t.title || t.id) } });
    if (t.repo || t.url) events.push({ ...base, id: `cloud:${t.id}:meta:${t.repo}`, type: 'meta.updated', data: { repo: typeof t.repo === 'string' ? t.repo.split('/').pop() : null } });
    if (phase === 'finished') events.push({ ...base, id: `cloud:${t.id}:finished`, type: 'turn.completed', data: { message: t.url ? `Finished in Codex cloud: ${t.url}` : 'Finished in Codex cloud.' } });
    else if (phase === 'failed') events.push({ ...base, id: `cloud:${t.id}:failed`, type: 'turn.failed', data: { error: `Codex cloud: ${t.status}` } });
    else if (phase === 'cancelled') events.push({ ...base, id: `cloud:${t.id}:cancelled`, type: 'turn.interrupted', data: {} });
  }
  return events;
}

export async function listCloudTasks({ exec = sh } = {}) {
  const out = await exec('codex', ['cloud', 'list', '--json', '--limit', '20']);
  if (out == null) return null; // not logged in, not installed, or the command failed
  try { return readTasks(JSON.parse(out)); } catch { return null; }
}
