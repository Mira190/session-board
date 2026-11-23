// Status line bridge for Claude Code.
//
// Claude Code hands its status line command a JSON document that includes, for
// subscribers, how much of the 5-hour and weekly usage windows is used and
// when each resets. No hook carries that, so this is the one documented way to
// learn it. The bridge passes the document on to the hub and then prints a
// status line: the user's own, if they had one (it is run with the same
// input), or a plain one otherwise.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './endpoint.js';

const saved = () => join(home(), 'statusline.json');
export const originalCommand = () => { try { return JSON.parse(readFileSync(saved(), 'utf8')).command || null; } catch { return null; } };
export const rememberOriginal = (command) => { mkdirSync(home(), { recursive: true }); writeFileSync(saved(), JSON.stringify({ command }) + '\n'); };
export const forgetOriginal = () => { if (existsSync(saved())) rmSync(saved()); };

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export function plainLine(p) {
  const w = (name, x) => (x && Number.isFinite(x.used_percentage) ? `${name} ${Math.round(x.used_percentage)}%${x.resets_at ? ` (resets ${clock(x.resets_at * 1000)})` : ''}` : null);
  return [
    p.model?.display_name || p.model?.id,
    Number.isFinite(p.context_window?.used_percentage) ? `ctx ${Math.round(p.context_window.used_percentage)}%` : null,
    w('5h', p.rate_limits?.five_hour), w('7d', p.rate_limits?.seven_day),
  ].filter(Boolean).join(' · ');
}

export async function statusline({ url, token, stdin = process.stdin, out = process.stdout } = {}) {
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  // Tell the hub, without holding the status line up for it.
  const tell = fetch(`${url}/ingest/status?agent=claude`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw || '{}',
    signal: AbortSignal.timeout(400),
  }).catch(() => {});
  const original = originalCommand();
  if (original) {
    await new Promise((resolve) => {
      const child = spawn(original, { shell: true, stdio: ['pipe', 'inherit', 'ignore'] });
      child.on('close', resolve);
      child.on('error', resolve);
      child.stdin.end(raw);
    });
  } else {
    let p = {};
    try { p = JSON.parse(raw); } catch { /* print nothing useful rather than fail */ }
    out.write(`${plainLine(p)}\n`);
  }
  await tell;
}
