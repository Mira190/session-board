# Third-party / open-source / indie products for managing multiple AI coding agent sessions (state as of 2026-11-22)

Method note: facts below were collected 2026-11-22. GitHub numbers are from repo pages fetched that day (rounded as GitHub shows them). Many comparison articles in this space are written by vendors about their competitors (Nimbalyst, Paradev/Superset, Cloudroom, cmux, agentproto); such claims are marked "vendor-authored". The GitHub API was not available in this session, so latest-release dates and last-commit dates could mostly not be read.

## 1. What are the notable products?

### Takeaway
The field has four shapes: (a) terminal multiplexer TUIs over tmux/PTY (Claude Squad, Agent of Empires, Agent Deck, ccmanager, Herdr, workmux, dmux), (b) desktop "workspace-per-worktree" apps (Conductor, Paradev ex-Superset, Emdash, Nimbalyst ex-Crystal, Orca, Cloudroom, cmux, T3 Code, Sculptor), (c) kanban boards (Vibe Kanban, Cline Kanban, Nimbalyst's board), and (d) remote/mobile relays (Happy, Omnara, Paseo). By November 2026 the category has consolidated hard: Conductor was acquired by Meta, Bloop (Vibe Kanban) and Terragon shut down, Crystal and Opcode are dead or deprecated, and Omnara pivoted.

### Cited Findings

#### Terminal-first (tmux / PTY)

- **Claude Squad** (smtg-ai/claude-squad): Go TUI; one tmux session per agent plus one git worktree/branch per session; AGPL-3.0; 8.8k stars, 15 open issues, 39 open PRs on 2026-11-22; supports Claude Code (default), Codex, Gemini, Aider, also names OpenCode and Amp, any CLI via `-p`; requires tmux and `gh`; `-y` auto-accept flagged experimental; README FAQ covers a "failed to start new session" timeout, fixed by updating the underlying agent CLI — [GitHub](https://github.com/smtg-ai/claude-squad)
- Claude Squad star history: ~6.2k on 2026-03-06, 8,565 in Oct 2026 — [Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- Claude Squad weaknesses per a competitor comparison (vendor-authored, July 2026): no API, "caps at 2–5 agents", stops at screen lock, supervision level "L0" (human looks at each pane) — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Claude Squad has no native Windows build (WSL only) — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- A fork, Loom, split from claude-squad at v1.0.17 (April 2026) and "diverged substantially" — [search result citing aidan-bailey/loom README](https://raw.githubusercontent.com/aidan-bailey/loom/HEAD/README.md)
- **Agent of Empires (aoe)** (njbrake/agent-of-empires): Rust; one tmux session per agent, so agents survive TUI close / SSH drop; optional git worktrees, multi-repo workspaces, sandboxing via Docker/Podman/Apple Containers; TUI + CLI + web dashboard (`aoe serve`) with a phone-specific structured view + HTTP API; MIT; 4.7k stars, 283 open issues, 57 open PRs, 3,379 commits; agents: Claude Code, OpenCode, Mistral Vibe, Codex CLI, Gemini CLI, Pi, Copilot CLI, Factory Droid; Linux/macOS only (Windows via WSL2) — [GitHub](https://github.com/njbrake/agent-of-empires)
- **Agent Deck** (asheshgoplani/agent-deck): Go/Bubble Tea TUI over tmux; MIT; 1.3k stars, 6 open issues, 4,663 commits; agents: Claude Code, Codex, Gemini CLI, Antigravity CLI, OpenCode; session states working / waiting / done; groups, forking, MCP and skills managers, worktrees, optional Docker sandbox, cost dashboard, a "conductor"/"watchers" feature for supervising a fleet, web UI via `agent-deck web`; macOS, Linux, Windows via WSL — [GitHub](https://github.com/asheshgoplani/agent-deck)
- Agent Deck detects status by polling the tmux pane, with user-definable detection patterns in config.toml; it has to set tmux `extended-keys-format csi-u` so Shift+Enter reaches Claude Code — [Agent Deck troubleshooting doc](https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/skills/agent-deck/references/troubleshooting.md)
- **ccmanager** (kbwo/ccmanager): TypeScript TUI; explicitly no tmux, uses its own PTY session management; one worktree per session with create/merge/delete, multi-project mode; per-agent configurable state-detection strategies with states Idle / Busy / Waiting; "status hooks" run a user command on state change; experimental auto-approval using Claude Haiku; MIT; 1.3k stars, 788 commits; agents: Claude Code, Gemini CLI, Codex CLI, Cursor Agent, Copilot CLI, Cline CLI, OpenCode, Kimi, MiniMax Code, Grok Build. Limitation: session restore re-runs the command but restores neither terminal output nor conversation — [GitHub](https://github.com/kbwo/ccmanager)
- **Herdr**: single Rust binary, Apache-2.0, terminal multiplexer with a background server; marks each pane working / blocked / idle; agents can drive it through a CLI and socket API; no hosted cloud, no per-agent sandbox; "over 42,000 GitHub stars" (Oct 2026, not independently checked) — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents); [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- Smaller tmux tools as of 2026-03-06: workmux (~877 stars, Rust, tmux/kitty/WezTerm/Zellij, manages worktrees), dmux (~965 stars, Node), TmuxCC (~51 stars), crmux (monitor only) — [Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en)
- **Claude Code Agent Farm**: Python batch runner, MIT, Claude Code only, tmux + lock files, 20+ instances on lint/type-fix queues with a watchdog that restarts stalled agents — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)

#### Desktop workspace apps

- **Conductor** (conductor.build): proprietary macOS-only app; one git-worktree workspace per task with diff viewer and PR flow; Claude Code, Codex, Cursor (and OpenCode per one source); free local tier, $50/mo Pro for cloud workspaces, iOS app listed. **Acquired by Meta, confirmed by founder Charlie Holtz on 2026-11-04**; new sign-ups and downloads closed; Conductor Cloud read-only 2026-11-13 and shut down 2026-11-20 with cloud data deletion; local app gets new models and critical fixes until early 2027; team joins Meta Superintelligence Labs — [SiliconANGLE](https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/); [InfoWorld](https://www.infoworld.com/article/4245065/meta-acquires-conductor-as-ai-coding-shifts-toward-multi-agent-development.html); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **Paradev (called Superset until October 2026)**: desktop app (macOS; experimental Linux AppImage; no Windows) + CLI + iPhone/iPad/Android apps; each workspace gets its own worktree, branch, terminals and ports; **status comes from lifecycle hooks installed into each agent's config**; 20+ CLI agents (Claude Code, Codex, OpenCode, Gemini CLI, Cursor Agent, Copilot, Amp, Kiro, Devin); does not proxy model calls; cloud workspaces plus "Bring Your Own Cloud" on your own Linux server; iPhone Lock Screen Live Activity for agents that need you; mobile remote access requires Pro. Self-declared limits: status only works for agents launched through Paradev, some agents report only completion, worktrees neither sandbox processes nor prevent merge conflicts — [Paradev compare page, updated 2026-11-15](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Superset pricing and footprint (Oct 2026): Pro $20/user/mo; Electron, 391 MB download, 1.4 GB installed; cannot import existing Claude Code or Codex chats — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- Licence conflict: Paradev's own page says MIT open source — [Paradev](https://paradev.com/compare/manage-multiple-coding-agent-sessions); contradicted by sources describing Superset as Elastic License 2.0, source-available — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents); [search summary of Morph comparison](https://www.morphllm.com/comparisons/superset-vs-conductor-vs-emdash)
- **Emdash** (generalaction/emdash): Apache-2.0, free, macOS/Windows/Linux; 22+ agents per one source and 34 CLI agents per a later one; SSH remote development; built-in issue-tracker integration (Linear, Jira) — [search summary of Morph comparison](https://www.morphllm.com/comparisons/superset-vs-conductor-vs-emdash); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **Crystal → Nimbalyst**: Crystal (stravu) was deprecated in February 2026 and replaced by Nimbalyst — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- **Nimbalyst**: macOS, Windows (native, no WSL integration), Linux, plus iOS companion (session list, detail, notifications; no Android mentioned); Claude Code and Codex side by side, OpenCode, Gemini CLI in alpha; session kanban with phases backlog / planning / implementing / validating / complete; optional one-click worktree per session; files-edited sidebar and inline diffs; free for individuals, MIT for individual-use features; Teams $20/user/mo, free in beta — [Nimbalyst blog (vendor-authored)](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **cmux** (manaflow): native macOS terminal built on libghostty, GPL-3.0-or-later, free; sidebar showing branch, PR status, ports per workspace and "notification rings"; works with Claude Code, Codex, OpenCode; does not manage worktrees; ~4.3k stars on 2026-03-06; iOS beta; Pro $50/mo for cloud VMs in early access, where a reviewer found typing lag — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions); [Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **Orca**: MIT, macOS/Windows/Linux/iOS/Android; Codex, Claude Code, OpenCode, Pi each in its own worktree; diff annotations sent back to the agent; SSH worktrees for remote agents; list view, no kanban — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- **T3 Code**: free, MIT; controls 6 providers (Claude Code, Codex, Cursor, Grok, OpenCode, Antigravity); Windows, iOS and Android apps; no hosted cloud, "T3 Connect" tunnels to your own machine — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **Cloudroom**: Apache-2.0 desktop app with self-hostable core; local threads on 9 harnesses, cloud threads on 7 (Claude Code, Codex, Pi, OpenCode, fx, Hermes, Devin), each cloud thread in its own sandbox with its own branch; "Teleport" moves Claude Code/Codex/Pi/OpenCode threads between local and cloud keeping history; uses the user's own subscriptions; Free (3,000 cloud credits / 30 days), Pro $50/mo, Ultra $500/mo; phone access via web app — [Cloudroom blog (vendor-authored)](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **Sculptor** (Imbue): desktop app running each agent in its own container; Imbue's page calls it free, open source, MIT; described as a research preview for Mac and Linux; runs Claude Code, Pi and other agents; user pays model tokens — [search summary of imbue.com/product/sculptor and AlphaSignal](https://imbue.com/product/sculptor)
- **Opcode (formerly Claudia)**: MIT GUI for Claude Code only (session history/resume, custom agents, MCP management, usage analytics, checkpoints); no commits since October 2025; "no longer actively developed" — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/); [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)

#### Kanban boards

- **Vibe Kanban** (BloopAI): Rust backend + web UI run with `npx vibe-kanban`, manages worktrees; ~22.5k stars on 2026-03-06; launched June 2025 — [Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en); [Vibe Kanban shutdown post](https://vibekanban.com/blog/shutdown)
- **Cline Kanban** (cline/kanban): research preview launched around 2026-03-26; browser board started with `npx kanban` or `cline --kanban`; each card gets its own worktree and terminal; trashing a card removes the worktree; cards show the agent's latest message or tool call; diff review with inline comments, Commit / Open PR; agents: Cline, Claude Code, Codex, OpenCode; Apache-2.0; uses experimental features that bypass permissions and runtime hooks — [Cline docs](https://docs.cline.bot/kanban/overview); [TestingCatalog](https://www.testingcatalog.com/cline-debuts-kanban-for-local-parallel-cli-coding-agents/)

#### Remote / mobile relays

- **Happy** (slopus/happy): MIT; 24.8k stars, 691 open issues, 448 PRs, 5,108 commits; the `happy` CLI wraps Claude Code and Codex so the session can be continued from a phone; happy-server relays encrypted sync; happy-push-server (Cloudflare Worker) sends APNs/FCM pushes; native iOS (Swift) and Android (Kotlin) apps, web, and a newer desktop app on its own "happy-agent" runtime; supports Claude, Codex, Grok, Gemini (via Antigravity), and OpenCode or any ACP agent as a harness; multiplayer sessions; no separate bill. The original CLI covers only Claude Code and Codex; multi-model needs the desktop app — [GitHub](https://github.com/slopus/happy)
- A fork called Happier ("Claude Codex OpenCode") exists as a separate App Store app — [App Store listing](https://apps.apple.com/gb/app/id6758554297)
- **Omnara** (YC S25): the Apache-2.0 repo was archived 2026-02-02; README says the team moved to a new voice-first coding agent platform at omnara.com built on the Claude Agent SDK; originally wrapped the Claude Code CLI and synced terminal/web/mobile — [GitHub](https://github.com/omnara-ai/omnara); [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- **Paseo**: local daemon owns agent processes, with desktop, web, CLI, iOS and Android clients, QR pairing, voice control, schedules, opt-in MCP server; AGPL-3.0; 10.3k stars on 2026-07-13; one-person company; agents: Claude Code, Codex, Copilot, OpenCode, Pi, ACP agents. A reviewer measured $0.29 for a one-word test prompt because the default model was Opus — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk). Licence conflict: Apache-2.0 "per its site" — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- **CloudCLI / claudecodeui** (siteboon): self-hosted web UI for Claude Code and Codex plus a hosted cloud option — [GitHub](https://github.com/siteboon/claudecodeui)

#### Hook-based observability

- **disler/claude-code-hooks-multi-agent-observability**: 1.6k stars, 16 commits; pipeline is Claude hook scripts (Python via uv) → HTTP POST → Bun server → SQLite (WAL) → WebSocket → Vue 3 client; 12 hook events (PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, UserPromptSubmit, Stop, SubagentStop, SubagentStart, PreCompact, SessionStart, SessionEnd); Claude Code only; observe-only (no start/stop/steer from the dashboard, though hooks can block commands); `.claude` directory must be copied into every project; no auth; client shows last 100 events by default — [GitHub](https://github.com/disler/claude-code-hooks-multi-agent-observability)

#### Cloud background-agent orchestrators

- **Terragon**: "remote background agent orchestrator for running Claude Code, Codex and other coding CLIs in the cloud"; the terragon-oss README carries a notice dated 2026-01-16 that the code is a snapshot at shutdown, provided as-is; ~240 stars — [third-party mirror of terragon-oss](https://relatedrepos.com/gh/terragon-labs/terragon-oss)

#### First-party tools that now compete directly

- Claude Code `claude agents` view lists background sessions with states Working / Needs input / Idle / Completed / Failed; sessions start with `claude --bg` or `/bg`; dispatched sessions get worktrees under `.claude/worktrees/`; Claude only — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Claude Code desktop app was redesigned for parallel work on 2026-04-14; Claude models only; cloud sessions run on Anthropic infrastructure. The Codex app (ChatGPT desktop) runs parallel Codex chats locally and in OpenAI's containers; Codex only — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- VS Code's sessions list (since the January 2026 release) runs Claude Code, Codex and Copilot agents side by side, but hides other apps' sessions by default and some features do not apply to Codex — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)

### Inferences
- Stars rank roughly: Herdr (~42k, unverified) > Happy (24.8k) > Vibe Kanban (22.5k in March, now ownerless) > Paseo (10.3k in July) > Claude Squad (8.8k) > Agent of Empires (4.7k) > hooks observability (1.6k) > Agent Deck / ccmanager (1.3k each). The most-starred survivors are the remote/mobile relay and the plain multiplexer, not the worktree-workspace apps.
- Issue backlog is a maturity signal: Happy (691 open) and Agent of Empires (283 open) have large backlogs relative to team size; Claude Squad (15) and Agent Deck (6) are small.
- For a solo developer in late November 2026, Conductor is no longer adoptable (downloads closed), which removes what most 2026 comparisons had ranked as the default Mac choice.

### Gaps
- Latest release dates and last-commit dates for almost every repo: GitHub pages returned no release data and the API was blocked in this session.
- Emdash, Orca, Herdr, T3 Code, Cloudroom, Sculptor and Terragon were characterised only through secondary or vendor sources; their repos were not read directly. Herdr's 42k stars is a single unverified claim.
- Paradev/Superset licence (MIT vs ELv2) and Paseo licence (AGPL-3.0 vs Apache-2.0) are unresolved conflicts.
- The Terragon notice was read through a third-party mirror, not the official repo.
- No usable Hacker News or Reddit threads were retrieved for individual products; user-complaint evidence is thin and mostly from blogs and READMEs.

## 2. Which are truly cross-vendor AND cross-runtime? Does anything unify cloud and local sessions in one view?

### Takeaway
No product was found that shows vendor-hosted cloud sessions (Claude Code on the web, Codex cloud) alongside local sessions from both vendors in one view. Cross-vendor tools reach "cloud" only by running the agent CLI in their own sandbox or on your own server; the vendors' own apps unify local and cloud but for a single vendor.

### Cited Findings
- A search for a unified view found no source confirming any native or third-party view combining Claude Code local, Claude Code cloud and Codex cloud sessions; the closest items were single-vendor or local-only — [Anthropic docs: Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
- Claude Desktop is reported to have a sessions hub with one sidebar filterable by Local or Cloud environment; Claude only; secondary source — [Crypto Briefing](https://cryptobriefing.com/claude-desktop-sessions-hub-local-cloud/)
- An issue on the Claude Code repo states that claude.ai does not show sessions running on the user's local machines and local installs do not show claude.ai sessions; may be outdated — [anthropics/claude-code #58039](https://github.com/anthropics/claude-code/issues/58039)
- Cloudroom is cross-vendor and cross-runtime in its own cloud: local threads on 9 harnesses, cloud threads on 7, and Teleport moves Claude Code/Codex threads between local and its cloud. These are Cloudroom sandboxes, not Anthropic's or OpenAI's cloud sessions — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- Paradev offers cloud workspaces and Bring Your Own Cloud for 20+ agents, but states that status works only for agents launched through Paradev — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Conductor had cross-vendor cloud workspaces ($50/mo Pro); that cloud shut down 2026-11-20 — [SiliconANGLE](https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/)
- Cross-vendor with remote reach to your own machines only (no hosted cloud): Happy, Paseo, T3 Code (T3 Connect), Herdr (SSH), Orca (SSH worktrees), Emdash (SSH), Agent of Empires (web dashboard over your own host) — [Happy GitHub](https://github.com/slopus/happy); [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents); [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/); [AoE GitHub](https://github.com/njbrake/agent-of-empires)
- Superset cannot import existing Claude Code or Codex chats — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- Terragon was the cross-vendor cloud-only orchestrator and shut down by January 2026 — [terragon-oss mirror](https://relatedrepos.com/gh/terragon-labs/terragon-oss)

### Inferences
- Every third-party tool observes only the sessions it launched (its own tmux session, PTY, workspace or sandbox). Sessions started elsewhere, in a plain terminal, in the vendor desktop app, or in the vendor cloud, are invisible to it. Paradev says so explicitly; for the others it follows from the architecture.
- The unfilled position is a read-mostly aggregator that discovers sessions it did not launch: local Claude Code and Codex sessions, plus claude.ai/code and Codex cloud tasks. Whether vendor cloud sessions expose an API a third party could list is outside what this research established.
- Cloudroom is the nearest functional equivalent (both vendors, local and cloud, one list) but achieves it by replacing the vendor cloud rather than aggregating it.

### Gaps
- Whether Anthropic or OpenAI expose supported APIs for listing a user's cloud sessions was not researched here.
- Cloudroom's claims are vendor-authored and untested; its star count and maturity are unknown.
- Whether the vendor apps' session lists pick up CLI sessions started outside the app was not verified from primary docs.

## 3. Core abstraction and "needs attention" / notification model

### Takeaway
Abstractions split between the session/pane (tmux tools, relays), the worktree-backed workspace (desktop apps) and the task card (kanban tools). Attention models converge on three states, working / waiting-for-input / idle-or-done, but differ in how the state is obtained: terminal-screen pattern matching, agent lifecycle hooks, or owning the agent process through a wrapper or SDK.

### Cited Findings
- Session-per-tmux-session + worktree: Claude Squad — [GitHub](https://github.com/smtg-ai/claude-squad)
- Session states working / waiting / done from pane polling with custom patterns: Agent Deck — [GitHub](https://github.com/asheshgoplani/agent-deck); [troubleshooting doc](https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/skills/agent-deck/references/troubleshooting.md)
- Session-per-worktree over a PTY, states Idle / Busy / Waiting from per-agent detection strategies, with a user command fired on state change: ccmanager — [GitHub](https://github.com/kbwo/ccmanager)
- Pane states working / blocked / idle with a socket API: Herdr — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- Workspace = worktree + branch + terminals + ports; status via lifecycle hooks written into each agent's config; mobile Live Activity for "agents that need you": Paradev — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Terminal workspace with notification rings and a sidebar, no worktree management: cmux — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Task card = worktree + terminal, card surface shows latest message or tool call: Cline Kanban — [Cline docs](https://docs.cline.bot/kanban/overview)
- Session card moving through backlog / planning / implementing / validating / complete, with iOS push when input is needed: Nimbalyst — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/); [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Wrapped session relayed to phone with APNs/FCM push: Happy — [GitHub](https://github.com/slopus/happy)
- Daemon-owned agent with permission relay to phone, confirmed working in a hands-on test on 2026-07-13: Paseo — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Event stream (no session abstraction, no control): hooks observability dashboard, including PermissionRequest, Notification and Stop events — [GitHub](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- Hook-written status files as an alternative to pane scraping: agent-manager launches sessions with a generated settings file whose hooks write working / waiting / finished / idle to a per-session file — [pkg.go.dev, YoanWai/agent-manager](https://pkg.go.dev/github.com/YoanWai/agent-manager@v0.14.1)
- First-party reference model: Claude Code agent view uses Working / Needs input / Idle / Completed / Failed — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- One reviewer's supervision scale: most cockpits are "L0" (human inspects each pane), watchdogs "L1", phone approval "L2", grader/verifier loops "L3", external policy gates "L4" — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)

### Inferences
- Three detection generations are visible: screen scraping (Claude Squad, Agent Deck, ccmanager), agent hooks (Paradev, agent-manager, disler's dashboard), and process ownership via SDK/ACP (Omnara's rebuild, Happy's harness, Paseo's daemon). Each step gains accuracy and loses the ability to see sessions the tool did not start.
- Hooks are the only mechanism here that can, in principle, report on sessions started outside the tool, because they are installed in the agent's own config rather than in the launcher. Paradev nonetheless limits status to sessions it launched.
- Nobody found treats "needs attention" as a ranked queue across sessions; it is a per-row badge plus, at best, a push notification.

### Gaps
- Agent of Empires' status-detection method is not described on its repo page.
- Conductor's, Emdash's and Vibe Kanban's internal status mechanisms were not established from primary sources.
- Notification specifics (desktop alerts, sounds, debounce) for most TUIs were not documented in what was read.

## 4. Recurring failure modes and complaints

### Takeaway
The documented problems are structural rather than tool-specific: screen-scraped state is unreliable, worktrees isolate files but not merges or processes, human review is the real throughput limit, and the tools themselves keep disappearing. Direct user complaints from issue trackers, HN and Reddit were mostly not retrievable, so this section leans on READMEs, design docs and blog reports.

### Cited Findings
- State detection: ccmux's architecture doc says pattern-based detection can miss prompts that scrolled off, and that Claude Code writes a permission-gated tool_use to the transcript only after the user resolves the prompt, so "waiting for permission" cannot be inferred from the transcript alone — [ccmux architecture doc](https://raw.githubusercontent.com/epilande/ccmux/main/docs/architecture.md)
- Hook-based status has gaps too: some agents report only completion, and status exists only for sessions the tool launched — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- tmux fragility: Agent Deck must reconfigure tmux key encoding for Shift+Enter to work in Claude Code; Agent of Empires' README attributes Claude Code screen flicker under tmux to an upstream Claude Code issue; Claude Squad documents a "failed to start new session" timeout tied to the agent CLI version — [Agent Deck troubleshooting](https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/skills/agent-deck/references/troubleshooting.md); [AoE README](https://raw.githubusercontent.com/njbrake/agent-of-empires/main/README.md); [Claude Squad GitHub](https://github.com/smtg-ai/claude-squad)
- tmux dependence excludes native Windows: Claude Squad, Agent of Empires and Agent Deck are WSL-only — [AoE GitHub](https://github.com/njbrake/agent-of-empires); [Agent Deck GitHub](https://github.com/asheshgoplani/agent-deck); [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- Workflow lock-in of worktree managers: the workflow becomes tool-centric, existing tmux sessions and panes are hard to reuse, and tool-driven merge and cleanup can clash with existing Git practice — [Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en)
- Worktrees do not prevent merge conflicts or sandbox processes — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions); [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- Ten agents in separate worktrees produced three merge conflicts, all in one shared CLI file — [Bernstein blog](https://bernstein.readthedocs.io/en/latest/blog/ten-agents-one-release/)
- Conductor made it "dangerously easy" to spin up agents, ending in conflicting PRs; clean git merges can still be semantically broken — [DEV, helgesverre](https://dev.to/helgesverre/agentic-drift-its-hard-to-be-multiple-developers-at-once-4872)
- Review is the bottleneck: Simon Willison and Armin Ronacher are cited as limited by their own review capacity — [Pragmatic Engineer](https://blog.pragmaticengineer.com/new-trend-programming-by-kicking-off-parallel-ai-agents/); a four-agent experiment concluded the human was the bottleneck — [Towards AI](https://pub.towardsai.net/i-ran-4-claude-code-agents-in-parallel-the-bottleneck-was-me-f596bc7f393e)
- Without a coordination layer the human becomes the scheduler deciding merge order — [DEV, switchmandev](https://dev.to/switchmandev/i-tried-running-multiple-ai-coding-agents-on-one-repo-it-got-messy-fast-56d1)
- Token cost: Paseo's Opus default cost $0.29 for a one-word prompt in one test — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Approval fatigue on phone-approval tools (Omnara) — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Wrapper fragility: Omnara rebuilt on the Claude Agent SDK after its Claude Code CLI wrapper "became unmaintainable" — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- Session restore is shallow: ccmanager re-runs the command but restores neither output nor conversation — [ccmanager GitHub](https://github.com/kbwo/ccmanager)
- Heavy footprint and no history import: Superset is 1.4 GB installed and cannot import existing chats — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)
- Per-project setup burden and no auth for hook dashboards — [disler GitHub](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- Safety trade-off: Cline Kanban relies on experimental features that bypass permissions — [Cline docs](https://docs.cline.bot/kanban/overview)
- Abandonment risk: advice to treat open-source agent tools as local tools you own, not SaaS, after the Vibe Kanban shutdown — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)

### Inferences
- The permission-prompt case is the hardest state to detect and the most valuable one to surface; the transcript cannot show it, the screen can miss it, and only the PermissionRequest/Notification hooks or process ownership report it reliably.
- A monitor-only tool avoids the two most-cited adoption objections (workflow lock-in, tmux/worktree imposition) at the cost of offering no isolation, which matches the "monitoring type" vs "management type" split in the Zenn comparison.

### Gaps
- No direct quotes from GitHub issues, Hacker News or Reddit (r/ClaudeAI, r/ClaudeCode, r/codex) were obtained; searches returned vendor blogs instead. Claims about state-detection inaccuracy in Claude Squad specifically are unverified.
- No quantitative data on worktree disk/setup overhead or on token cost of parallel sessions was found.
- Happy's 691 open issues were counted but not read; their content is unknown.

## 5. Which have shut down or pivoted, and why?

### Takeaway
At least six of the named products are gone, frozen or changed hands within about twelve months, and the stated reasons point the same way: free users, no business model, and first-party vendor apps absorbing the feature set.

### Cited Findings
- **Vibe Kanban / Bloop**: shutdown announced 2026-04-10 by Louis Knight-Webb. Stated reason: thousands of daily users but mostly free, and "we couldn't find a business model that we could get excited about." Remote services ran 30 more days, then a fully local architecture; kanban issues, comments, projects and organisations removed; refunds for the last 30 days; continues as community-maintained open source — [Vibe Kanban shutdown post](https://vibekanban.com/blog/shutdown)
- Since v0.1.44 (2026-04-24) opening a project shows "Project functionality has been retired" with an export button — [BloopAI/vibe-kanban releases](https://github.com/BloopAI/vibe-kanban/releases)
- **Conductor**: acquired by Meta, confirmed 2026-11-04; price undisclosed; sign-ups and downloads closed; cloud read-only 2026-11-13, shut down 2026-11-20; local app maintained until early 2027; Meta has not said what it will do with the technology — [SiliconANGLE](https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/); [The Register](https://theregister.com/ai-and-ml/2026/11/05/meta-brings-conductor-on-board-its-model-train/5307711)
- **Terragon**: shut down; open-sourced snapshot with a notice dated 2026-01-16, no maintenance promised. No stated reason found — [terragon-oss mirror](https://relatedrepos.com/gh/terragon-labs/terragon-oss)
- **Omnara**: repo archived 2026-02-02; pivoted to a hosted voice-first agent platform on the Claude Agent SDK; reported reason for the rebuild is that the CLI wrapper became unmaintainable; YC lists the company as active — [GitHub](https://github.com/omnara-ai/omnara); [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk); [YC](https://ycombinator.com/companies/omnara)
- **Crystal**: deprecated February 2026, succeeded by Nimbalyst from the same team — [DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk)
- **Opcode / Claudia**: no commits since October 2025 — [Nimbalyst blog](https://nimbalyst.com/blog/best-session-managers-for-claude-code-and-codex/)
- **Superset**: renamed Paradev in October 2026; company still "Superset Inc."; no reason given on the page — [Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- **Happy**: shifted from a phone relay for Claude Code into a multi-model desktop orchestrator with its own agent runtime and harness — [GitHub](https://github.com/slopus/happy)
- First-party pressure: Anthropic redesigned the Claude Code desktop app for parallel work on 2026-04-14, four days after the Bloop announcement, and both vendors now ship parallel-session apps bundled with their plans — [Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents)

### Inferences
- Bloop's own explanation (free users, no model) plus the vendors bundling parallel-session UIs into existing subscriptions suggests a paid single-vendor or local-only orchestrator is not a viable business; survivors are either free open source run by individuals (Claude Squad, AoE, Agent Deck, ccmanager, Paseo) or selling compute (Cloudroom, Paradev cloud, cmux cloud VMs).
- The durable gap the vendors have no incentive to fill is cross-vendor aggregation, which is consistent with section 2.
- For a solo developer choosing a dependency, bus-factor and vendor-exit risk is as material as features: three of the most-recommended tools of early 2026 (Conductor, Vibe Kanban, Crystal) are not adoptable in their original form by November 2026.

### Gaps
- Terragon's reason for shutting down and the official wording were not found.
- Conductor's founder blog post was not read directly; details come from press coverage.
- Sculptor's current status after 2026 (active vs dormant) could not be confirmed from a dated primary source.
- Whether the Vibe Kanban community edition roadmap was ever published, and its current commit activity, is unknown.
