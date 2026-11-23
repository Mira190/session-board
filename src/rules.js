// Standing rules: requests the human has said are always fine, in any session.
//
//   exact   this very command
//   prefix  this command with any further arguments ("git push origin …")
//
// Two things keep a rule from becoming a hole:
//   - a command that chains or redirects (; && | ` $( > newline) never matches
//     a prefix rule, so "npm install x; curl … | sh" is not "npm install …";
//   - anything that looks drastic never matches any rule and cannot be made
//     into one (see isRisky).
import { isRisky } from './reduce.js';

const CHAIN = /[;&|`<>\n]|\$\(/;
// A prefix this short hands over an interpreter, not a command.
const OPEN_ENDED = new Set([
  'sh', 'bash', 'zsh', 'fish', 'env', 'xargs', 'eval', 'exec', 'sudo', 'node', 'deno', 'bun', 'python', 'python3',
  'ruby', 'perl', 'php', 'npx', 'pnpx', 'bunx', 'uvx', 'ssh', 'docker', 'kubectl', 'make', 'time', 'nohup', 'watch',
]);

const words = (detail) => detail.trim().split(/\s+/);

// The "kind of command": its first two words (one, if that is all there is).
// null when the command chains, is drastic, or would be too open-ended.
export function stemOf(detail) {
  if (typeof detail !== 'string' || CHAIN.test(detail) || isRisky(detail)) return null;
  const w = words(detail);
  if (!w[0] || w[0].includes('=')) return null; // leading VAR=value
  if (w.length === 1) return null; // nothing varies: that is an exact rule
  if (OPEN_ENDED.has(w[0])) return w.length > 2 && !w[1].startsWith('-') ? `${w[0]} ${w[1]}` : null;
  return `${w[0]} ${w[1]}`;
}

// Why a rule may not be created, or null if it may.
export function ruleProblem({ tool, detail, mode = 'exact' }) {
  if (typeof tool !== 'string' || !tool || typeof detail !== 'string' || !detail.trim()) return 'tool and detail required';
  if (mode !== 'exact' && mode !== 'prefix') return 'mode must be exact or prefix';
  if (isRisky(detail)) return 'this looks drastic; it must be approved each time';
  if (mode === 'prefix') {
    if (CHAIN.test(detail)) return 'a rule for a kind of command cannot contain ; & | < > or $(';
    const w = words(detail);
    if (w.length < 2 && OPEN_ENDED.has(w[0])) return `"${w[0]} …" would allow running anything`;
    if (w.length < 2) return 'a rule for a kind of command needs at least two words';
  }
  return null;
}

export function ruleMatches(rule, tool, detail) {
  if (rule.tool !== tool || typeof detail !== 'string' || isRisky(detail)) return false;
  if (rule.mode === 'prefix') {
    return (detail === rule.detail || detail.startsWith(`${rule.detail} `)) && !CHAIN.test(detail);
  }
  return detail === rule.detail;
}
