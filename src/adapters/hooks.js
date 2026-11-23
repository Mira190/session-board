// Claude Code and Codex hook payloads -> normalized events.
// Codex hooks deliberately mirror Claude Code's stdin schema, so one mapper
// serves both with small per-vendor branches.

// Did the tool call succeed? Claude Code tells us by which event it sends.
// Codex has no failure event (checked against its 0.171 binary), so there we
// only say so when the response carries an explicit exit status; otherwise
// the answer is "unknown" and no evidence is recorded either way.
function outcome(agent, p) {
  if (agent === 'claude') return p.hook_event_name === 'PostToolUse' && !p.tool_response?.interrupted;
  const r = p.tool_response;
  const code = r?.exit_code ?? r?.exitCode ?? r?.metadata?.exit_code;
  if (Number.isInteger(code)) return code === 0;
  if (typeof r?.success === 'boolean') return r.success;
  return undefined;
}

const text = (v) => (typeof v === 'string' ? v : v == null ? null : JSON.stringify(v));

export function fromHook(agent, p, { host, runtime, now = Date.now(), seq = null, source = null, tmux = null, cloudId = null } = {}) {
  if (!p || typeof p !== 'object' || !p.session_id || !p.hook_event_name) return [];
  const base = {
    ts: now,
    agent,
    session_id: String(p.session_id),
    host: host || null,
    runtime: runtime || null,
    cwd: p.cwd || null,
    transcript: p.transcript_path || null,
    ...(cloudId ? { cloud_id: cloudId, runtime: 'cloud' } : {}),
    ...(seq != null ? { seq, source } : {}),
  };
  // Events that carry an id of their own can be recognised if delivered twice.
  const eid = p.tool_use_id && /ToolUse/.test(p.hook_event_name) ? `${p.hook_event_name}:${p.tool_use_id}`
    : p.hook_event_name === 'UserPromptSubmit' && p.prompt_id ? `prompt:${p.prompt_id}` : null;
  const ev = (type, data = {}) => [{ ...base, ...(eid ? { eid } : {}), type, data }];

  switch (p.hook_event_name) {
    case 'SessionStart':
      return ev('session.started', { source: p.source, title: p.session_title, model: p.model, tmux });
    case 'UserPromptSubmit':
      return ev('prompt.submitted', { prompt: text(p.prompt) });
    case 'PreToolUse':
      return ev('tool.started', { tool: p.tool_name, input: p.tool_input });
    case 'PostToolUse':
    case 'PostToolUseFailure':
      // A command that exits non-zero arrives as PostToolUseFailure (verified
      // on Claude Code 2.1.330): that is how we know a test run failed.
      return ev('tool.finished', { tool: p.tool_name, input: p.tool_input, ok: outcome(agent, p) });
    case 'PreCompact':
      return ev('context.compacted', { trigger: p.trigger });
    case 'PermissionRequest':
      return ev('permission.requested', { tool: p.tool_name, input: p.tool_input });
    case 'PermissionDenied':
      return ev('permission.denied', { tool: p.tool_name });
    case 'Elicitation':
      return ev('question.asked', { message: text(p.message) });
    case 'Notification':
      switch (p.notification_type) {
        case 'permission_prompt':
          return ev('permission.requested', {});
        case 'elicitation_complete':
        case 'elicitation_response':
          return ev('request.resolved', { kind: 'question' });
        case 'elicitation_dialog':
        case 'elicitation_url_dialog':
        case 'agent_needs_input':
          return ev('question.asked', { message: text(p.message) });
        default:
          return ev('notification', { kind: p.notification_type, message: text(p.message) });
      }
    case 'Stop': {
      const bg = (p.background_tasks?.length || 0) + (p.session_crons?.length || 0);
      return ev('turn.completed', { message: text(p.last_assistant_message), background: bg });
    }
    case 'StopFailure':
      return ev('turn.failed', {
        error: [p.error, text(p.error_details)].filter(Boolean).join(': '),
        message: text(p.last_assistant_message),
      });
    case 'Interrupt':
      return ev('turn.interrupted', {});
    case 'SubagentStart':
      return ev('subagent.started', { agent_type: p.agent_type });
    case 'SubagentStop':
      return ev('subagent.stopped', { agent_type: p.agent_type });
    case 'SessionEnd':
      return ev('session.ended', { reason: p.reason });
    default:
      return ev('heartbeat', { hook: p.hook_event_name });
  }
}

// Hook events each agent should forward. Kept small on purpose.
export const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop',
  'SessionEnd', 'PostToolUseFailure', 'PreCompact',
];
export const CODEX_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'PreCompact',
];
