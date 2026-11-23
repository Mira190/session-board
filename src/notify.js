// Push to the human's phone when a session starts needing them and they are
// not looking at the board. Off unless configured:
//
//   SESSION_BOARD_NTFY=https://ntfy.sh/<your-topic>   (or a self-hosted ntfy)
//   SESSION_BOARD_WEBHOOK=https://…                    (JSON POST, any service)
//
// By default a notification says which session and what kind of thing it
// needs, not the command or question itself: that text may contain code or
// secrets and the push service is someone else's computer. Set
// SESSION_BOARD_NOTIFY_DETAIL=1 to include it.
// Wording follows SESSION_BOARD_LANG / the system locale (see lang.js).
const KIND = {
  en: {
    permission: ['Needs permission', 'high'],
    question: ['Has a question', 'high'],
    failed: ['Stopped on an error', 'default'],
    unknown: ['Lost contact', 'default'],
    pr: ['PR needs attention', 'default'],
    review: ['Finished, awaiting review', 'low'],
  },
  zh: {
    permission: ['要权限', 'high'],
    question: ['有问题问你', 'high'],
    failed: ['出错停下了', 'default'],
    unknown: ['失联了', 'default'],
    pr: ['PR 需要处理', 'default'],
    review: ['做完了，待验收', 'low'],
  },
};
const WAITING = { en: (n) => `${n} sessions are waiting for you`, zh: (n) => `${n} 个会话在等你` };
const SEP = { en: ': ', zh: '：' };
import { serverLang } from './lang.js';

const BURST = 5; // more than this many at once becomes one summary

// "22:00-08:00" -> is `date` inside it? Handles ranges that cross midnight.
export function inQuietHours(spec, date = new Date()) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export const attentionKind = (s) => {
  if (s.archived || s.snoozed_until) return null;
  if (s.state === 'needs_input') return s.waiting?.kind || 'question';
  if (s.state === 'failed' || s.state === 'unknown' || s.state === 'review') return s.state;
  return null;
};

export function createNotifier({ env = process.env, fetcher = fetch, boardUrl = '', isPresent = () => false, delayMs = 4000, clock = () => new Date() } = {}) {
  const ntfy = env.SESSION_BOARD_NTFY || null;
  const webhook = env.SESSION_BOARD_WEBHOOK || null;
  if (!ntfy && !webhook) return { enabled: false, consider() {} };
  const lang = serverLang(env);
  const sep = SEP[lang];
  const detail = env.SESSION_BOARD_NOTIFY_DETAIL === '1';
  const kinds = new Set((env.SESSION_BOARD_NOTIFY_ON || 'permission,question,failed,unknown,pr').split(',').map((k) => k.trim()));
  const told = new Map(); // key -> signature already pushed
  let batch = [];
  let timer = null;

  const post = (title, body, priority, click) => Promise.all([
    ntfy && fetcher(ntfy, {
      method: 'POST',
      headers: { Title: encodeURIComponent(title), Priority: priority, ...(click ? { Click: click } : {}), 'X-Title-Encoding': 'url' },
      body,
    }),
    webhook && fetcher(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, priority, url: click || null }),
    }),
  ]).catch(() => {});

  function flush() {
    timer = null;
    const items = batch;
    batch = [];
    if (!items.length || isPresent()) return; // they came back and can see it
    if (inQuietHours(env.SESSION_BOARD_QUIET, clock())) return; // nothing is pushed during quiet hours; it is all on the board
    if (items.length > BURST) {
      const high = items.some((i) => i.priority === 'high');
      return post(WAITING[lang](items.length), items.slice(0, 8).map((i) => `${i.label}${sep}${i.title}`).join('\n'), high ? 'high' : 'default', boardUrl || undefined);
    }
    for (const i of items) post(`${i.label}${sep}${i.title}`, i.body, i.priority, boardUrl ? `${boardUrl}/#${encodeURIComponent(i.key)}` : undefined);
  }

  return {
    enabled: true,
    // Called with a session whenever it changes.
    consider(s) {
      const kind = attentionKind(s);
      if (!kind) return void told.delete(s.key);
      const sig = `${kind}:${s.since}`;
      if (told.get(s.key) === sig) return;
      told.set(s.key, sig);
      if (!kinds.has(kind) || isPresent()) return;
      const [label, priority] = KIND[lang][kind] || KIND[lang].question;
      const where = [s.repo, s.host].filter(Boolean).join(' · ');
      batch.push({
        key: s.key, label, priority, title: s.title || s.session_id,
        body: [where, detail ? s.waiting?.detail || s.error || s.last_message : null].filter(Boolean).join('\n') || where || label,
      });
      // Wait a moment: it may resolve by itself, or more may arrive to merge.
      timer ||= setTimeout(flush, delayMs);
      timer.unref?.();
    },
    flush,
  };
}
