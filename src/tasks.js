// The human thinks in tasks; the agents run sessions. Several sessions are one
// task when they are, on the evidence, attempts at the same thing:
//   - the same opening instruction in the same repository (a retry, or the
//     same job given to Claude and to Codex), or
//   - work on the same feature branch of the same repository, one after the
//     other (picking the work back up in a new session).
// Two sessions that were active on one branch at the same time are parallel
// workers, not attempts at one thing, so a shared branch does not join those.
// The human can also join two sessions by hand, or pull one out on its own.
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'dev', 'HEAD']);
const MIN_PROMPT = 12; // "fix it" and "continue" say nothing about the task

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
// When a session was doing its work: from its first sign of life to its last.
const span = (s) => [s.created_ts || 0, s.last_work_ts || s.last_event_ts || s.created_ts || 0];
const overlapped = (a, b) => span(a)[0] < span(b)[1] && span(b)[0] < span(a)[1];

// sessions -> Map(session key -> { id, size, members: [keys, oldest first], why: ['prompt' | 'branch' | 'manual'] })
export function groupTasks(sessions) {
  const parent = new Map(sessions.map((s) => [s.key, s.key]));
  const why = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const union = (a, b, reason) => {
    parent.set(find(a), find(b));
    for (const k of [a, b]) (why.get(k) || why.set(k, new Set()).get(k)).add(reason);
  };

  const byPrompt = new Map();
  const byBranch = new Map();
  const ordered = [...sessions].sort((a, b) => a.created_ts - b.created_ts);
  const byKey = new Map(sessions.map((s) => [s.key, s]));
  for (const s of ordered) {
    if (s.task_manual === 'solo') continue;
    if (s.task_manual && byKey.has(s.task_manual)) union(s.key, s.task_manual, 'manual');
    const repo = s.repo_id || s.repo || s.cwd;
    if (!repo) continue;
    const prompt = norm(s.title_manual ? s.first_prompt?.split('\n')[0] : s.title);
    if (prompt.length >= MIN_PROMPT) {
      const k = `${repo}|${prompt}`;
      if (byPrompt.has(k)) union(s.key, byPrompt.get(k), 'prompt');
      else byPrompt.set(k, s.key);
    }
    if (s.branch && !DEFAULT_BRANCHES.has(s.branch)) {
      const k = `${repo}|${s.branch}`;
      const earlier = byBranch.get(k) || [];
      // Join the earlier sessions on this branch that had stopped before this one began.
      for (const e of earlier) if (!overlapped(byKey.get(e), s)) union(s.key, e, 'branch');
      byBranch.set(k, [...earlier, s.key]);
    }
  }

  const groups = new Map();
  for (const s of ordered) {
    const root = find(s.key);
    (groups.get(root) || groups.set(root, []).get(root)).push(s.key);
  }
  const out = new Map();
  for (const members of groups.values()) {
    const reasons = [...new Set(members.flatMap((k) => [...(why.get(k) || [])]))];
    const task = { id: `task:${members[0]}`, size: members.length, members, why: reasons };
    for (const key of members) out.set(key, task);
  }
  return out;
}
