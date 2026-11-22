// The hub: receives hook events, keeps the projection, serves the board.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { fromHook } from './adapters/hooks.js';
import { attentionQueue } from './reduce.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY = 2 * 1024 * 1024;
// A "working" session that has been silent this long is flagged, not hidden:
// we cannot tell a long build from a dead process, so we say what we know.
export const QUIET_MS = 10 * 60 * 1000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 2000 }, (err, out) =>
      resolve(err ? null : out.trim() || null),
    );
  });
}

export function createHub({ dbPath = ':memory:', token = null, now = () => Date.now() } = {}) {
  const store = new Store(dbPath);
  const clients = new Set();

  const view = (s) => ({
    ...s,
    quiet: s.state === 'working' && now() - s.last_event_ts > QUIET_MS,
  });
  const snapshot = () => {
    const sessions = store.list().filter((s) => !s.archived).map(view);
    return { now: now(), sessions, queue: attentionQueue(sessions).map((s) => s.key) };
  };

  let pending = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
      for (const res of clients) res.write(msg);
    }, 50);
  };
  store.onChange(broadcast);
  // Re-send periodically so "quiet" flags and timers stay honest without events.
  const tick = setInterval(() => clients.size && broadcast(), 30_000);
  tick.unref();

  // Repo/branch are looked up from the session's cwd when it exists on this
  // machine. Remote hosts can send them explicitly with a meta.updated event.
  const looked = new Map();
  async function refreshGitMeta(s) {
    if (!s.cwd || !existsSync(s.cwd)) return;
    const last = looked.get(s.key) || 0;
    if (now() - last < 15_000) return;
    looked.set(s.key, now());
    const [top, branch] = await Promise.all([
      git(s.cwd, ['rev-parse', '--show-toplevel']),
      git(s.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ]);
    const repo = top ? basename(top) : basename(s.cwd);
    if (repo !== s.repo || branch !== s.branch) {
      store.append({
        ts: now(), agent: s.agent, session_id: s.session_id, type: 'meta.updated',
        data: { repo, branch },
      });
    }
  }

  function ingest(events) {
    let last = null;
    for (const ev of events) last = store.append(ev);
    if (last) refreshGitMeta(last).catch(() => {});
    return last;
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  function authorized(req, url) {
    if (!token) return true;
    const header = req.headers.authorization || '';
    return header === `Bearer ${token}` || url.searchParams.get('token') === token;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/ingest/') || path.startsWith('/api/')) {
      if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' });
    }

    // --- ingest -----------------------------------------------------------
    const hook = path.match(/^\/ingest\/(claude|codex)$/);
    if (hook && req.method === 'POST') {
      // Always answer with an empty object: session-board only observes, it
      // never makes a decision on the agent's behalf.
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return json(res, 200, {});
      }
      ingest(
        fromHook(hook[1], payload, {
          host: url.searchParams.get('host'),
          runtime: url.searchParams.get('runtime'),
          now: now(),
        }),
      );
      return json(res, 200, {});
    }
    if (path === '/ingest/event' && req.method === 'POST') {
      // Normalized events from anything else (cloud sessions, other agents).
      const body = JSON.parse(await readBody(req));
      const list = (Array.isArray(body) ? body : [body]).filter(
        (e) => e && e.agent && e.session_id && typeof e.type === 'string',
      );
      ingest(list.map((e) => ({ ...e, ts: now(), session_id: String(e.session_id) })));
      return json(res, 200, { accepted: list.length });
    }

    // --- api --------------------------------------------------------------
    if (path === '/api/sessions' && req.method === 'GET') return json(res, 200, snapshot());
    if (path === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const act = path.match(/^\/api\/sessions\/([^/]+)\/(ack|archive|events)$/);
    if (act) {
      const key = decodeURIComponent(act[1]);
      const s = store.get(key);
      if (!s) return json(res, 404, { error: 'no such session' });
      if (act[2] === 'events' && req.method === 'GET') return json(res, 200, store.events(key));
      if (req.method === 'POST') {
        const type = act[2] === 'ack' ? 'human.acknowledged' : 'human.archived';
        store.append({ ts: now(), agent: s.agent, session_id: s.session_id, type, data: {} });
        return json(res, 200, view(store.get(key)));
      }
    }

    // --- static -----------------------------------------------------------
    if (req.method === 'GET') {
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      const file = join(PUBLIC, rel);
      if (file.startsWith(PUBLIC) && MIME[extname(file)]) {
        try {
          const data = await readFile(file);
          res.writeHead(200, { 'content-type': MIME[extname(file)], 'cache-control': 'no-cache' });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }
    json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, err.status || 400, { error: String(err.message || err) });
      else res.end();
    });
  });

  return {
    store,
    server,
    snapshot,
    ingest,
    listen: (port, host) => new Promise((ok) => server.listen(port, host, () => ok(server.address()))),
    close: () =>
      new Promise((ok) => {
        clearInterval(tick);
        clearTimeout(pending);
        for (const res of clients) res.end();
        server.close(() => {
          store.close();
          ok();
        });
        server.closeAllConnections?.();
      }),
  };
}
