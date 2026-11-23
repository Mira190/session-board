// MCP server over stdio: lets any agent read the board.
//
// Read-only on purpose. An agent that could approve its own permission
// requests, or mark its own work as reviewed, would undo the point of the
// board, so decisions stay with the human in the UI.
import { createInterface } from 'node:readline';

const STATES = ['working', 'needs_input', 'review', 'idle', 'failed', 'unknown', 'ended'];

const TOOLS = [
  {
    name: 'whats_waiting',
    description:
      'Sessions that are waiting on the human right now, most urgent first: permission requests, questions, failures, lost sessions, then finished work awaiting review.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sessions',
    description:
      'All coding-agent sessions on the board (Claude Code and Codex, any machine), with state, repo, branch and what each is doing. Optionally filter by state or repo.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: STATES, description: 'Only sessions in this state.' },
        repo: { type: 'string', description: 'Only sessions whose repo or directory contains this text.' },
      },
    },
  },
  {
    name: 'get_session',
    description:
      'Full detail for one session: last prompt, last reply, open requests, files it edited, usage, and its recent events. Identify it by board key ("claude:<id>") or by bare session id.',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Board key or session id.' } },
      required: ['session'],
    },
  },
  {
    name: 'wait_for_session',
    description:
      'Block until a session reaches one of the given states (default: any state where its turn is over), or until the timeout. Use to wait for another session to finish instead of polling.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Board key or session id.' },
        until: { type: 'array', items: { type: 'string', enum: STATES }, description: 'States to wait for.' },
        timeout_seconds: { type: 'number', description: 'Give up after this long (default 60, max 600).' },
      },
      required: ['session'],
    },
  },
];

const brief = (s) => ({
  key: s.key,
  agent: s.agent,
  host: s.host,
  runtime: s.runtime,
  repo: s.repo,
  branch: s.branch,
  cwd: s.cwd,
  title: s.title,
  state: s.state,
  waiting_on_human: s.waiting ? { kind: s.waiting.kind, tool: s.waiting.tool, detail: s.waiting.detail } : null,
  seconds_in_state: null,
  doing: s.current_tool ? `${s.current_tool.tool}: ${s.current_tool.detail || ''}`.trim() : null,
  error: s.error,
});

export function createMcp({ call }) {
  const find = (snap, ref) =>
    snap.sessions.find((s) => s.key === ref) || snap.sessions.find((s) => s.session_id === ref) || null;
  const withAge = (snap, s) => ({ ...brief(s), seconds_in_state: Math.round((snap.now - s.since) / 1000) });

  const tools = {
    async whats_waiting() {
      const snap = await call('/api/sessions');
      const by = new Map(snap.sessions.map((s) => [s.key, s]));
      return { waiting: snap.queue.map((k) => withAge(snap, by.get(k))) };
    },
    async list_sessions({ state, repo } = {}) {
      const snap = await call('/api/sessions');
      const match = (s) =>
        (!state || s.state === state) && (!repo || `${s.repo || ''} ${s.cwd || ''}`.includes(repo));
      return { sessions: snap.sessions.filter(match).map((s) => withAge(snap, s)) };
    },
    async get_session({ session }) {
      const snap = await call('/api/sessions');
      const s = find(snap, session);
      if (!s) throw new Error(`no session matches "${session}"`);
      const events = await call(`/api/sessions/${encodeURIComponent(s.key)}/events`);
      return {
        ...withAge(snap, s),
        turns: s.turns,
        last_prompt: s.last_prompt,
        last_message: s.last_message,
        open_requests: s.requests.map((r) => ({ kind: r.kind, tool: r.tool, detail: r.detail })),
        files_edited: s.files,
        usage: s.usage,
        recent_events: events.slice(-30).map((e) => ({ at: new Date(e.ts).toISOString(), type: e.type, tool: e.data?.tool })),
      };
    },
    async wait_for_session({ session, until, timeout_seconds = 60 }) {
      const want = until?.length ? until : ['needs_input', 'review', 'idle', 'failed', 'unknown', 'ended'];
      const deadline = Date.now() + Math.min(Math.max(timeout_seconds, 1), 600) * 1000;
      for (;;) {
        const snap = await call('/api/sessions');
        const s = find(snap, session);
        if (!s) throw new Error(`no session matches "${session}"`);
        if (want.includes(s.state)) return { reached: true, ...withAge(snap, s), last_message: s.last_message };
        if (Date.now() >= deadline) return { reached: false, ...withAge(snap, s) };
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  };

  // JSON-RPC 2.0. Returns the response object, or null for notifications.
  return async function handle(msg) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    if (msg.id === undefined) return null;
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: msg.params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'session-board', version: '0.1.0' },
          instructions:
            'Read-only view of the human\'s coding-agent sessions. Use it to see what other sessions are doing or to wait for one to finish. It cannot approve, answer or send anything.',
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const fn = tools[msg.params?.name];
        if (!fn) return fail(-32602, `unknown tool: ${msg.params?.name}`);
        try {
          const out = await fn(msg.params.arguments || {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
        } catch (err) {
          return reply({ content: [{ type: 'text', text: String(err.message || err) }], isError: true });
        }
      }
      default:
        return fail(-32601, `method not found: ${msg.method}`);
    }
  };
}

export async function serveMcp({ endpoint }) {
  const call = async (path) => {
    const { url, token } = await endpoint(); // looked up per call: the hub may move
    const res = await fetch(url + path, { headers: token ? { authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res) throw new Error(`session-board hub is not reachable at ${url} (start it with: session-board serve)`);
    if (!res.ok) throw new Error(`hub answered ${res.status}`);
    return res.json();
  };
  const handle = createMcp({ call });
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      continue;
    }
    // Requests are answered as they finish, so a long wait does not block others.
    handle(msg).then((out) => out && process.stdout.write(JSON.stringify(out) + '\n'));
  }
}
