# Named tools follow-up: Magpie, Octo, Orca, T3 Code, Paseo, Herdr

Research date: 2026-11-22. All facts below were read on that date unless noted.

Sources are primary: each project's README, LICENSE and docs fetched from `raw.githubusercontent.com`, the official docs sites (herdr.dev, onorca.dev), and the GitHub repo pages (star and issue counts as rendered that day). The GitHub API was blocked in this session, so last-commit and release dates could not be read; they are marked UNVERIFIED. No issue threads, Reddit or HN were read, so the "weaknesses" sections rest on limits the projects document themselves plus open-issue counts; third-party complaints are UNVERIFIED.

## Identification summary

| Name asked | Best match | Confidence | Other candidates |
|---|---|---|---|
| Magpie | `yetone/magpie` (usemagpie.ai): model gateway and menu-bar app for coding agents, with a Sessions and Usage page | High that this is the tool people mention (40.0k stars). It is NOT a session orchestrator | None found for session management |
| Octo | `hesamsheikh/octogent` ("Octogent"): Claude Code orchestration dashboard | Medium. No project named exactly "Octo" was found in this space | `ShreyPaharia/octomux` (closer to session-board in function), OctoAlly (Product Hunt listing only, not examined), `octo-agent` on PyPI (LangGraph CLI, unrelated) |
| Orca | `stablyai/orca` (onorca.dev) | High | Many same-name forks and mirrors; unrelated older "orca" projects |
| "tc code" | T3 Code, `pingdotgg/t3code` (t3.codes), by Theo's Ping/T3 Tools | High | No tool named "TC Code" found |
| Paseo | `getpaseo/paseo` (paseo.sh) | High | None |
| Herdr | `herdrdev/herdr` (herdr.dev); formerly `ogulcancelik/herdr`, which still redirects | High | Forks only |

Searches run: "Magpie AI coding agent sessions manager Claude Code Codex GitHub"; "Octo AI coding agents orchestrator Claude Code Codex sessions open source"; "Octo OR OctoAlly OR Octogent Claude Code Codex sessions dashboard"; plus one targeted search per remaining tool.

---

## 1. Magpie (`yetone/magpie`)

**What it is.** "Every agent's model. One place." A local gateway plus menu-bar app (also window, TUI, web UI, CLI, Docker, Termux) that lets any coding agent talk to any model provider: "Claude Code on Kimi. Codex on DeepSeek." It edits the model key in each agent's own config file, translates wire formats, and fails over between accounts when a quota runs out. It is a routing and accounting layer, not a session manager.

**Maker, licence, activity, price.** yetone (author of avante.nvim); MIT (LICENSE: "Copyright (c) 2026 yetone"). 40.0k stars, 3.7k forks, 4.9k open issues, 8,972 commits. Free; sponsored by Kimi and others. Last-commit date UNVERIFIED.

**Architecture relevant to us.**
- It sits on the request path (a local HTTP gateway), so it sees every model call of every wired agent without launching the agent.
- It also reads agents' own session files. The reference says a call can be "read from an agent's session file rather than seen by the gateway", and names Claude Code, Claude Desktop, Codex and OpenCode files. So it sees sessions it did not launch, including ones that bypass the gateway.
- It reads agents' sign-ins (Claude Code's and Codex's files, the Keychain) to discover subscriptions; this can be switched off.
- Does not launch, control or observe live state. No working / blocked model.

**Core abstraction.** Provider, model, routing group, agent. Sessions exist only as an accounting view.

**State and notification model.** None for agent state. It does have quota reminders ("a reminder before a window renews with much of it unused").

**Notable UI ideas.**
- Sessions page: "Every agent conversation with its cost and title, reopened in your terminal with one click."
- Context view: how full each request's context window is, how much came from cache, and what fills it.
- `magpie quota`: balances and quota windows for every key, plan and account in one command.
- Subagent attribution: usage rows carry `parent_agent` and read `<session>/subagents/agent-<id>.jsonl`.
- A doc on relocating Claude Code sessions after a project folder is renamed (`docs/session-relocation.md`), which means this breakage is common enough to document.
- OTLP export of usage.

**Weaknesses.** 4.9k open issues against 40k stars is a high ratio. Daily usage ping is on by default (random id, version, agents, providers). Account auto-switching across subscriptions is the kind of thing T3 Code's FAQ refuses to build, citing TOS-ban risk.

**Borrow.**
1. Per-session cost and context-fill as card fields, computed from the transcript files we already can read, with subagent usage rolled up to the parent session.
2. One-click "reopen in terminal" from any session row, using the agent's native resume command.
3. A quota row in the header (5-hour and weekly windows with reset countdown) so "blocked by rate limit" is visible as a board-level condition.
4. A session-relocation repair: detect when a session's `cwd` no longer exists and offer to re-point it.

**Do not copy.** Sitting on the model request path, rewriting agent config files, credential and Keychain reading, account failover. All are outside session-board's scope and raise trust and TOS questions.

---

## 2. Octo: Octogent (`hesamsheikh/octogent`), with Octomux as the alternative reading

### 2a. Octogent

**What it is.** "A thin orchestration dashboard over Claude Code for managing context, automation, and developer headspace." A local API plus web UI that runs several Claude Code terminals and lets one Claude Code coordinate others.

**Maker, licence, activity, price.** Hesam Sheikh; MIT; 1.4k stars, 246 forks, 13 open issues, 315 commits. Free. README says it "is not actively reviewing pull requests right now" and calls itself "a personal exploration". Last-commit date UNVERIFIED.

**Architecture.**
- Local Node 22 API owns PTY sessions via `node-pty`; the browser attaches over `WS /api/terminals/:id/ws`. A second socket, `WS /api/terminal-events/ws`, broadcasts terminal-created, -updated, -deleted and state-change events.
- Octogent writes Claude hooks into the target `.claude/settings.json`; hooks call back to the local API with `curl`.
- Documented hook mapping: `UserPromptSubmit` marks the terminal active and auto-names it from the first prompt; `PreToolUse` records the current tool and marks user-question waits; `Notification` marks permission waits and idle prompts; `Stop` parses the transcript into stored conversations; `PostToolUse` on `Edit|Write` feeds code-intel events.
- Optional worktree per terminal under `.octogent/worktrees/`.
- Claude Code only ("The current docs only cover Claude Code"). Binds to 127.0.0.1 with Host and Origin checks; remote needs `OCTOGENT_ALLOW_REMOTE_ACCESS=1`. No mobile app.
- Only sees terminals it started. PTYs do not survive an API restart; records left as `running` are reconciled to `stale` on startup.

**Core abstraction.** The "tentacle": a folder `.octogent/tentacles/<id>/` holding `CONTEXT.md`, `todo.md` and notes. Terminals attach to a tentacle; unchecked `todo.md` items become worker prompts.

**State model.** Exact state names are not listed in the docs read. Documented signals: active, user-question wait, permission wait, idle prompt, and `stale` for orphaned records.

**Notable UI ideas.** Context kept in files the agent can read and edit, separate from execution. Messages between agents are queued and injected only when the target session is idle (after an idle or stop hook). A cap of 32 live PTYs by default.

**Weaknesses (self-documented).** Claude-only; PTYs die with the API process; in-memory message queues; not accepting PRs.

### 2b. Octomux (`ShreyPaharia/octomux`), alternative candidate

"A local dashboard for running many Claude Code and Cursor agents in parallel." MIT, npm `octomux`, localhost:7777, no cloud, no telemetry. Stars UNVERIFIED (repo page not fetched). Features in README: one inbox that collects every "allow this tool?" prompt; a Monitor grid of live terminals; a "Command center" kanban from backlog to done; verify loops (`octomux loop-start --task <id> --verify "npm test" --max-iterations 8`) that rerun the agent in fresh context until the command exits 0; PR detection by branch that closes the task on merge. Launch-only (does not adopt outside sessions); no Codex.

**Borrow (from both).**
1. Octogent's hook-to-state table is almost exactly session-board's projection for Claude Code; adopt it as the baseline and add `PreToolUse` on `AskUserQuestion` as a distinct `needs_input` reason (question vs permission).
2. Auto-title a session from the first `UserPromptSubmit`.
3. Startup reconciliation: any session the projection still shows as working with no live process becomes `stale` (our `ended` or a sub-reason), never silently stays "working".
4. Octomux's inbox of permission prompts as the first screen, and task auto-close when the branch's PR merges.

**Do not copy.** Owning PTYs in the hub process; the tentacle file convention inside user repos; in-memory queues.

---

## 3. Orca (`stablyai/orca`)

**What it is.** Self-described "agent development environment (ADE)": a desktop app (macOS, Windows, Linux) with iOS and Android companions that runs CLI agents side by side, each in its own git worktree, with terminals, diff review, a built-in browser and SSH remotes. The README now leads with "Bots inside your agent IDE": bots reachable from Slack, Linear and GitHub that run on the user's own Claude Code or Codex.

**Maker, licence, activity, price.** Stably AI (LICENSE: "Copyright (c) 2026 Lovecast Inc."); MIT. 132.9k stars, 8.5k forks, "5k+" open issues, 23,986 commits; README says "we ship daily". Free; an "Orca Enterprise" page exists (pricing not read). Orca Relay requires sign-in. Last-commit date UNVERIFIED.

**Architecture.**
- Launches agents in PTYs inside real git worktrees. "Works with any CLI agent"; about 25 preconfigured.
- State comes from Orca-managed hooks: "Settings → Agents → Agent status hooks controls the Orca-managed hooks that report working / waiting / done into the UI." CLI: `orca agent hooks status|on|off --json`.
- Hook endpoints are written to disk (`{userData}/agent-hooks/endpoint.env`, `endpoint.cmd` on Windows) and re-sourced on every hook invocation, so a long-lived agent keeps reaching the server after an app restart.
- The Codex hook is written into `~/.codex` only when something changed, so Codex stops re-prompting the user to approve it.
- Agent Session History: "Orca scans the on-disk session transcripts that supported agent CLIs leave behind" for about 22 CLIs, and resumes with the native command (`claude --resume <id>`, `codex resume <id>`). So it discovers past sessions it did not launch, but live status exists only for agents it launched. Transcript search can span other connected computers; "searchable data stays on each computer".
- Remote: SSH worktrees, a self-hosted Remote Orca Server, per-worktree cloud VMs. Mobile pairs by one-time code over LAN or Orca Relay; "the paired desktop owns the agent sessions."
- Also offers a native Chat UI over the same session, and an `orca` CLI that agents can call.

**Core abstraction.** The worktree (workspace). Agents, terminals, browser and diffs are panes inside it. Worktrees can nest (parent and child).

**State and notification model.**
- Hook states: working / waiting / done. Mobile wording: "working / done / waiting on input".
- Notification rule: "When an agent transitions from working to idle, Orca fires a notification — system notification, sound, and a chip on the worktree."
- Failed or cancelled turns add no unread mark.
- Unread is separate from state: header bell across all worktrees, macOS Dock badge, "unread worktrees are bolded rather than badged", right-click "mark unread", per-workspace mute that still shows the dot.
- Per-machine notification switches stored as an opt-out list, so a newly added machine notifies by default. Separate server-side switches for agent completion, agent input and terminal bell.
- Mobile "Needs you" collects tool approvals and access requests.
- Hibernation (experimental, off by default): idle resumable agents are stopped after N minutes and relaunched with the resume command when the worktree is reopened. It refuses while a dispatch is unsettled or child agents are still attached.

**Weaknesses.** Very large surface (IDE, browser, bots, computer use, emulators). "5k+" open issues. The mobile doc lists "Stuck spinner on a worktree" (phone shows working while desktop says idle) as a known problem needing a manual refresh. List and sidebar only; no kanban found in the docs read.

**Borrow.**
1. The on-disk endpoint file re-read by every hook invocation. This solves "hub restarted on a new port, old sessions post into the void".
2. Idempotent hook install: write only on change; one command for `status|on|off`.
3. Read / unread as a dimension separate from state, with manual "mark unread" and mute-but-keep-the-dot.
4. Transcript scan plus native resume commands for sessions that predate hook install, and "copy resume command".

**Do not copy.** The IDE scope, bots, relay account. Also the choice to skip unread on failed turns: for session-board a failure is one of the highest-attention events.

---

## 4. T3 Code (`pingdotgg/t3code`), the reading of "tc code"

**What it is.** "The open-source control plane for coding agents." A server (bundled in the Electron desktop app, or `t3` / `npx t3@latest`) that drives installed agents and serves web, desktop, iOS and Android clients. Its FAQ insists it is not a harness; it uses Claude Code's and Codex's harnesses.

**Maker, licence, activity, price.** Ping / T3 Tools (Theo Browne). MIT. 71.5k stars, 12.1k forks, 1.3k open issues, 13,089 commits. Free: "There's no way to pay us to use T3 Code." T3 Connect is "free too, for now": 3 machines per account, 10 with T3 Chat Pro, 100 with Premier. Last-commit date UNVERIFIED.

**Architecture.**
- Claude is driven through Anthropic's Agent SDK and Codex through the Codex App Server (both stated in the FAQ); other agents through "official ACP bindings". Providers named: Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, any ACP agent.
- "Provider processes, terminals, Git, and project files belong to the server." Clients use authenticated RPC with subscriptions scoped so that "a client viewing one thread does not pay for every thread's history."
- Event-sourced core: "Orchestration state is decided as events, and projections are the source of truth once they apply them." Events, projections, the command receipt and outbox effects commit in one database transaction; an effect worker performs side effects afterwards.
- The log is pruned to "about a day of history for reconnect replay", "so projections cannot be rebuilt from the log". A client whose cursor is older than the pruned-through sequence resumes from a snapshot.
- Remote: LAN, Tailscale, or T3 Connect.
- Sessions it did not launch: not adopted. The reverse door exists: "Agents that T3 Code did not start can work with an environment through its MCP server", able to read projects and threads and to start and message threads.
- Checkpoints use hidden Git refs, adding no commits to the user's branch.

**Core abstraction.** The thread (one conversation, optionally in its own worktree), inside a project, inside an environment (a machine running the server). A turn is "one user-to-agent cycle".

**State and attention model.**
- Thread status names were not found in the docs read (UNVERIFIED).
- Documented rule: "A provider turn ending and its follow-up work settling are separate milestones", so late checkpoint or diff work must not keep the client showing provider work as active.
- Thread settlement is server-owned: the settlement service evaluates PR and inactivity settings with no client connected, and "Clients render the persisted result; they do not derive settlement from their own clocks."
- A merge done outside T3 (an agent running `gh pr merge`) sends no notification, so a reactor re-reads the thread's open PR links when a run that ran a merge or close command ends.

**Weaknesses.** Agent SDK use drained Claude's 5-hour limit about 1.7x faster until v0.1.7 (FAQ). T3 Connect disconnects have their own troubleshooting page, and the author says he keeps Tailscale as fallback. No local models, by choice. "Limited review capacity" for PRs. Launch-only.

**Borrow.**
1. Server-owned settlement: move a card to done or archived from persisted PR-merged and inactivity facts, computed in the hub, never from a browser clock.
2. Separate "agent turn ended" from "follow-up work settled" so slow post-processing never shows as working.
3. Idempotent ingestion with a receipt per event id, committed in the same transaction as the projection update.
4. Offer session-board as an MCP server so any agent can ask "what needs me?" and read session state.
5. Re-check PR state when a turn that ran `gh pr merge` or `gh pr close` ends.

**Do not copy.** Pruning the log so projections cannot be rebuilt. session-board's append-only log should stay replayable; compact with snapshots instead. Also do not drive agents through SDK or app-server: that is what makes T3 blind to outside sessions.

---

## 5. Paseo (`getpaseo/paseo`)

**What it is.** "One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents": a daemon plus desktop (Electron), Expo iOS / Android / web, and CLI clients. "The mobile app is the full app."

**Maker, licence, activity, price.** Mohamed Boudra, "built by one person", funded by GitHub Sponsors and logo sponsors. Licence is Apache-2.0: the LICENSE file reads "Paseo is licensed under the Apache License, Version 2.0" and the README ends "Apache-2.0". This resolves the AGPL-vs-Apache conflict in the earlier notes; AGPL appears only in stale copies. 24.7k stars (10.3k in July per earlier notes), 3.1k forks, 910 open issues, 6,756 commits. Free; no telemetry or forced login. Last-commit date UNVERIFIED.

**Architecture.**
- Daemon (`packages/server`) owns agent processes and exposes a WebSocket API on port 6767 plus an MCP server.
- Provider adapters: Claude via Anthropic Agent SDK; Codex via Codex AppServer; Copilot and Cursor via ACP; generic ACP wrapper.
- Transcript authority is the provider's own file (`~/.claude/projects/{cwd}/{session-id}.jsonl`, `~/.codex/sessions/{date}/rollout-{ts}-{id}.jsonl`): "provider history is the durable transcript authority and resumed agents rebuild from it."
- Relay: optional, daemon-outbound, end-to-end encrypted (Noise `NK`, falling back to NaCl `box`), "zero-knowledge". Production relay is a separate Elixir service; relay stays disabled until the user consents at pairing.
- Also direct TCP, Tailscale, SSH tunnel to a running daemon, Docker image with password.
- CLI lists `paseo agent ls/run/import/attach/...`. The `import` verb suggests adopting an existing provider session, but what it does was not read (UNVERIFIED). Live observation of sessions started elsewhere is not documented.
- Plugins run on the daemon and appear in every client; they can "answer permissions, follow up when a turn ends".
- TypeScript SDK `@getpaseo/client` (`agents.create`, `waitForFinish`).

**Core abstraction.** The agent (a daemon-managed provider session) in a workspace or worktree on a host.

**State model (exact, from `shared/agent-lifecycle.ts`).** `initializing → idle ⇄ running`, plus `error` ("last attempt failed; session is still attached") and `closed` ("terminal state, no live session"). Needing permission is not a lifecycle state; it is a separate event pair, `agent_permission_request` / `agent_permission_resolved`. Timeline rows have append-only sequence numbers with epochs (each run starts a new epoch), used for client-side dedup. Timestamps are "canonical daemon-owned"; clients must not guess from local clocks. Push tokens are stored in `push-tokens.json`.

**Weaknesses.** One maintainer against 910 open issues. Timeline rows are runtime memory only. Earlier notes recorded high token cost from an Opus default (secondary source). Plugins run with full access to the daemon machine.

**Borrow.**
1. Model "needs permission" as an open request with a matching resolved event, layered over lifecycle, not as a lifecycle state. `needs_input` is then derived as "has at least one unresolved request", and clears correctly however the request was answered.
2. `error` that keeps the session attached, distinct from `closed`. Maps to our failed vs ended.
3. Hub-assigned sequence numbers and hub-owned timestamps on every event; clients dedup by sequence and catch up by paging.
4. Outbound-only E2E relay that is off until pairing consent, if session-board ever adds phone access.
5. A `wait` verb in the CLI and SDK ("block until this session needs me or finishes").

**Do not copy.** Process ownership through SDK and app-server, for the same reason as T3 Code. Timeline kept only in memory.

---

## 6. Herdr (`herdrdev/herdr`)

**What it is.** "the runtime your coding agents live on": a terminal multiplexer in one Rust binary ("no electron") with a background server and attachable clients, tmux-style, which recognises coding agents in panes and marks their state.

**Maker, licence, activity, price.** Oğulcan Çelik, now under the `herdrdev` org. Apache-2.0 (LICENSE file and README). The AGPL and dual-licence claims seen in search come from forks or older versions (UNVERIFIED which). 52.3k stars (earlier notes had about 42k in October, then unverified), 4.2k forks, 512 open issues, 1,884 commits. Docs version 0.9.5. Free; sponsors; enterprise contact address. Linux, macOS, Windows beta.

**Architecture.**
- The server owns PTYs. Clients attach and detach (`ctrl+b q`). Saved SSH machines are merged into "a combined agent list".
- Two detection paths. Default: find the agent's foreground process in each pane and read "the live bottom of the pane"; rules in a per-agent detection manifest (TOML) decide idle, working or blocked. Manifests update remotely from herdr.dev without a restart, and local overrides at `~/.config/herdr/agent-detection/<agent>.toml` win.
- Second path: agent self-report. Every pane exports `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`; the agent or its hook runs `herdr pane report-agent <pane> --source X --agent X --state working|idle|blocked --seq N [--message ...] [--agent-session-id ID] [-- resume command]`.
- For Claude Code and Codex the installed hook reports only session identity (SessionStart, for resume): "Claude Code state comes from Herdr's screen manifest detection." For Devin and Droid the docs explain why: their hooks "do not emit a reliable state transition after every permission cancellation or user interrupt".
- Cannot see sessions outside its panes. No hosted cloud. No mobile app found in the docs read.
- Socket API and CLI let agents spawn panes, prompt each other, and `herdr agent wait`.

**Core abstraction.** Session (server namespace) > workspace > tab > pane; an agent is "a process Herdr recognizes inside a pane".

**State model (exact).** `blocked` (needs input, approval or a decision), `working`, `done` ("finished and you have not looked at it yet"), `idle` ("finished or waiting and has been seen"), `unknown` ("cannot confidently classify"). Notes from the docs:
- `done` vs `idle` is purely a seen flag. "Each client tracks which completions it has displayed. Viewing a completion in one client does not clear another client's Done badge", while CLI and API use the server's seen state.
- Workspace sidebar state "rolls up from the agents inside it".
- Blocked detection is "deliberately strict": only on a match with known approval, question or permission UI; otherwise it falls back to idle and labels the reason `default_known_agent_idle_fallback` in explain output.
- The docs warn that a mistaken idle can let automation type into an approval dialog.
- Antigravity and Grok count as idle at their prompt even with background tasks or subagents still running.

**Notable ideas.**
- `--seq`: "Herdr ignores reports whose number is not higher than the last one it accepted, so late or out-of-order reports can't overwrite newer state." A timestamp works as the value.
- `--source` namespaces who reported, with the `herdr:` prefix reserved.
- Resume command reported by the agent itself, with validation (plain command name on PATH, at most 64 arguments and 8 KiB).
- `release-agent` on exit, with a safety net that clears the agent once the pane is back at a shell prompt.
- Guidance to integrators: report in the background with a short timeout, ignore failures, send only the latest state.
- Restore matrix stating what survives detach, server restart and update.

**Weaknesses.** Screen-scrape rules lag new prompt shapes (self-documented). Server restart kills processes; only layout and resumable sessions return. Tied to living inside Herdr. Terminal-only UI; no kanban.

**Borrow.**
1. `seq`-guarded reports: every hook event carries a monotonic number (hook-side nanosecond timestamp); the projection ignores anything not newer per session and source.
2. The done / idle split as a seen flag, giving `review` (finished, unseen) vs `idle` (finished, seen) with no extra hook.
3. An `unknown` state and an "explain" output naming which rule produced the current state.
4. A public one-line report command (`session-board report --session ID --state ... --seq ... -- resume cmd`) so any agent or wrapper can join without a change to session-board; reserve a source prefix for our own hooks.
5. Roll-up of the worst state to project and machine level.

**Do not copy.** Screen-scrape manifests as the main signal, or owning terminals. Do keep in mind Herdr's finding that hooks alone miss interrupts and permission cancellations.

---

## Comparison table (2026-11-22)

| | Magpie | Octogent | Orca | T3 Code | Paseo | Herdr |
|---|---|---|---|---|---|---|
| Kind | Model gateway + usage | Claude Code dashboard | Desktop ADE | Control-plane GUI | Daemon + clients | Terminal multiplexer |
| Licence | MIT | MIT | MIT | MIT | Apache-2.0 | Apache-2.0 |
| Stars | 40.0k | 1.4k | 132.9k | 71.5k | 24.7k | 52.3k |
| Open issues | 4.9k | 13 | 5k+ | 1.3k | 910 | 512 |
| Maker | yetone (individual) | Hesam Sheikh (individual) | Stably AI (company) | Ping / T3 Tools (company) | Mohamed Boudra (individual) | Oğulcan Çelik / herdrdev |
| How it gets state | None; request path + session files | Claude hooks → local API | Managed hooks + PTY | Agent SDK / app-server / ACP | Agent SDK / app-server / ACP | Screen manifests + self-report CLI |
| Sees sessions it did not launch | Yes, usage only | No | History only (transcript scan) | No (outside agents call in via MCP) | No (`import` unverified) | No (only inside its panes) |
| Agents | 25+ | Claude Code | Any CLI, ~25 preset | 10 + ACP | 9 + ACP | ~28 |
| Mobile | No | No | iOS, Android | iOS, Android | iOS, Android (full app) | Not found |
| Remote | Remote magpie, Docker | Opt-in flag | SSH, server, cloud VM, relay | LAN, Tailscale, T3 Connect | TCP, Tailscale, SSH, E2E relay | SSH machines |
| State names | n/a | active / question wait / permission wait / idle / stale | working / waiting / done + unread | not found | initializing / idle / running / error / closed + permission events | blocked / working / done / idle / unknown |
| Main view | Menu bar, usage tables | Terminal deck + todo | Worktree sidebar, panes | Thread list, chat | Workspace + chat, panes | TUI panes + sidebar |
| Price | Free | Free | Free; enterprise tier | Free; T3 Connect machine cap | Free | Free |

None of the six adopts live sessions started elsewhere and tracks their state. Orca and Magpie come closest, and only by reading transcripts after the fact. That gap is session-board's position.

## Ranked ideas to borrow

1. **Sequence-guarded, source-tagged event reports** (Herdr `--seq` / `--source`; Paseo sequence numbers). Protects the projection from late and out-of-order hook deliveries. Cheap, and needed from day one.
2. **Permission and question as open requests layered over lifecycle** (Paseo `agent_permission_request` / `_resolved`; Octogent's `Notification` and `PreToolUse` mapping). `needs_input` is derived from "unresolved request exists", which removes the stuck-in-needs_input bug class.
3. **Seen flag separate from state** (Herdr done vs idle; Orca unread, mark-unread, mute-keeps-dot). Gives `review` vs `idle` and makes the inbox dismissible without lying about state.
4. **Endpoint file re-read on every hook call, plus idempotent hook install with on / off / status** (Orca). Makes hooks survive hub restarts and port changes, and avoids Codex re-approval prompts.
5. **Transcript-scan backfill and native resume** (Orca Session History; Magpie Sessions). Covers sessions that started before hooks were installed and supplies title, cwd, branch, model, cost; adds "resume" and "copy resume command" to every card.
6. **Server-owned settlement and startup reconciliation** (T3 Code settlement service; Octogent `stale`). The hub alone moves cards to done on PR merge or inactivity, and downgrades "working" sessions with no live process on restart.
7. **`unknown` state with an explain output** (Herdr). Honest when signals conflict, and a debugging aid for the projection rules.
8. **Public report CLI and an MCP read surface** (Herdr `report-agent`; T3 Code outside-agents; Paseo `wait`). Lets other agents and tools join or query without a session-board release.
9. **Cost, context-fill and quota windows on the board** (Magpie; Orca usage tracking). Adds "blocked by rate limit" as a visible reason.
10. **Roll-up of worst state to project and machine, with per-machine notification opt-out** (Herdr workspace roll-up; Orca per-machine switches).

## Things not to copy, in one place

- Owning the agent process (PTY, SDK, app-server, ACP): every tool here that does so cannot see outside sessions.
- Screen scraping as the primary signal (Herdr), though it is a valid fallback idea for interrupts that hooks miss.
- Pruning the event log so projections cannot be rebuilt (T3 Code).
- Skipping attention on failed turns (Orca).
- Request-path interception and credential reading (Magpie).
- IDE-scale scope (Orca) and account-gated relays as a requirement.

## Open items

- Last-commit and release dates for all six (GitHub API blocked).
- T3 Code's thread status names; Paseo's `agent import` behaviour; Octogent's exact state enum; Octomux and OctoAlly details and stars.
- Whether Herdr has a mobile client; origin of the AGPL claim seen in forks.
- User complaints from issues and forums for all six.
- Whether the user meant Octogent or Octomux by "Octo".
