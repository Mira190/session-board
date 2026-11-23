// The human thinks in tasks; the agents run sessions. Several sessions are one
// task when they are, on the evidence, attempts at the same thing:
//   - the same opening instruction in the same repository (a retry, or the
//     same job given to Claude and to Codex), or
//   - work on the same feature branch of the same repository.
// The human can also join two sessions by hand, or pull one out on its own.
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'dev', 'HEAD']);
const MIN_PROMPT = 12; // "fix it" and "continue" say nothing about the task

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

// sessions -> Map(session key -> { id, size, members: [keys, oldest first] })
export function groupTasks(sessions) {
  const parent = new Map(sessions.map((s) => [s.key, s.key]));
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  const first = new Map(); // evidence -> first session seen with it
  const link = (evidence, key) => (first.has(evidence) ? union(key, first.get(evidence)) : first.set(evidence, key));
  for (const s of sessions) {
    if (s.task_manual === 'solo') continue;
    if (s.task_manual && parent.has(s.task_manual)) union(s.key, s.task_manual);
    const repo = s.repo_id || s.repo || s.cwd;
    if (!repo) continue;
    if (s.branch && !DEFAULT_BRANCHES.has(s.branch)) link(`b|${repo}|${s.branch}`, s.key);
    const prompt = norm(s.title);
    if (prompt.length >= MIN_PROMPT) link(`p|${repo}|${prompt}`, s.key);
  }

  const groups = new Map();
  for (const s of [...sessions].sort((a, b) => a.created_ts - b.created_ts)) {
    const root = find(s.key);
    (groups.get(root) || groups.set(root, []).get(root)).push(s.key);
  }
  const out = new Map();
  for (const members of groups.values()) {
    const task = { id: `task:${members[0]}`, size: members.length, members };
    for (const key of members) out.set(key, task);
  }
  return out;
}
