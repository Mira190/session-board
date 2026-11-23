// Language for text the hub itself produces (phone pushes, the triage agent's
// notes). Same rule as the web UI: SESSION_BOARD_LANG=en|zh wins; otherwise the
// system locale decides: Chinese for zh*, English for everything else.
export function serverLang(env = process.env) {
  const pick = env.SESSION_BOARD_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return String(pick).toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
