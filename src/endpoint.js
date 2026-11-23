// Where the hub is. `serve` writes this file; the hook bridge reads it on every
// call, so changing the port never needs the hooks to be reinstalled.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_URL = 'http://127.0.0.1:4590';
export const home = () => process.env.SESSION_BOARD_HOME || join(homedir(), '.session-board');
const file = () => join(home(), 'endpoint.json');

export function readEndpoint() {
  try {
    const e = JSON.parse(readFileSync(file(), 'utf8'));
    if (typeof e.url === 'string') return e;
  } catch {
    /* not written yet */
  }
  return { url: process.env.SESSION_BOARD_URL || DEFAULT_URL, token: process.env.SESSION_BOARD_TOKEN || null };
}

export function writeEndpoint(endpoint) {
  mkdirSync(home(), { recursive: true });
  writeFileSync(file(), JSON.stringify(endpoint, null, 2) + '\n', { mode: 0o600 });
}
