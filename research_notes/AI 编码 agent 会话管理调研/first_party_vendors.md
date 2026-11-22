# First-party vendor surfaces for managing multiple AI coding agent sessions (state as of Nov 2026)

Research date: 2026-11-22. Primary sources are vendor docs/blogs fetched on that date unless marked "search snippet only" (page not opened, lower confidence) or "third-party".

## Anthropic: how Claude Code surfaces let a user manage/supervise many sessions (cloud sessions, desktop/mobile, Remote Control, agent view, Projects, subagents/teams, scheduled tasks) and what Anthropic recommends

### Takeaway
Anthropic has no single board; it has at least four overlapping session lists: terminal "agent view" (local background sessions only), the claude.ai/code + mobile + desktop sidebar (cloud sessions plus local sessions that opted in via Remote Control), "Projects" (Claude-coordinated threads with an Overview pane), and in-session lists (`/tasks`, `/workflows`). Each uses a slightly different state vocabulary, local-to-cloud handoff is asymmetric and copy-based, and every worker must be a Claude session.

### Cited Findings

**Five official "parallel" mechanisms**
- Docs list five ways to run work in parallel: subagents, agent view, agent teams, dynamic workflows, projects; plus supporting tools worktrees, cross-session messaging, `/batch` (splits one change into "5 to 30 worktree-isolated subagents"). — [Run agents in parallel](https://code.claude.com/docs/en/agents.md)
- Selection rule is "who coordinates the work, whether the workers need to communicate, and whether they edit the same files". Agent view = "You hand off independent tasks and check back later"; agent teams = "Claude plans, assigns, and supervises a group of workers", "experimental and disabled by default". — [Run agents in parallel](https://code.claude.com/docs/en/agents.md)
- "In every approach the workers are Claude sessions. To involve a different tool, expose it to Claude as an MCP server." (explicitly single-vendor) — [Run agents in parallel](https://code.claude.com/docs/en/agents.md)
- Status checking is fragmented by mechanism: `claude agents` for background sessions, `/tasks` for anything in the background of the current session, `/workflows` for workflow runs, the @-mention typeahead for named subagents, and the desktop sidebar "for a desktop view of all your sessions". — [Run agents in parallel](https://code.claude.com/docs/en/agents.md)
- Agent teams do not isolate teammates in worktrees; users must "partition the work". — [Run agents in parallel](https://code.claude.com/docs/en/agents.md)

**Agent view (terminal, local, research preview)**
- `claude agents` is "one screen for all your background sessions: what's running, what needs your input, and what's done"; status: research preview, "the interface and keyboard shortcuts may change". Docs reference CLI versions up to v2.1.323; no launch date on the page. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- States: Working, Needs input, Idle, Completed, Failed, Stopped. Groups: Pinned, Ready for review (session has an open PR that needs review or has failing checks), Needs input, Working, Completed. Toggle between state grouping and directory grouping. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Machine-readable: `claude agents --json --all` with `state` values `working`, `blocked`, `done`, `failed`, `stopped`, plus `status` and `waitingFor`; files under `~/.claude/jobs/` are declared not a stable interface. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- PR is a first-class row attribute: `#1234` / GitLab `!1234` labels colour-coded yellow (waiting on checks/review or checks failed), green (passed), purple (merged), grey (draft/closed). — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Interaction model: peek (see the exact pending question or result), reply from peek, attach for full session; permission prompts cannot be answered from peek. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Notifications: when a local background session "needs input, finishes, or fails", via the terminal notification channel and `Notification` hook types `agent_needs_input` / `agent_completed`; terminal title shows e.g. `2 awaiting input · claude agents`; a regular session footer shows `← 2 agents`. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Isolation: a dispatched session moves into its own worktree under `.claude/worktrees/` before editing; commits, pushes and opens a draft PR; never pushes to main, force-pushes or merges. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Scope limits: "Interactive sessions you have open in other terminals don't appear until you background them"; "Subagents and teammates a session spawns aren't listed as separate rows". A supervisor daemon hosts sessions; idle unattached sessions stop after about an hour and resume on reply. Sessions run "on your machine" and are contrasted with Projects in the cloud. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- CLI verbs: `claude --bg`, `attach`, `logs`, `stop`, `respawn`, `rm`, `daemon status`. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)

**Cloud sessions (Claude Code on the web)**
- Start surfaces: browser claude.ai/code, mobile Code tab, desktop app (Cloud environment), terminal `claude --cloud` (`--remote` is a deprecated alias), and cloud scheduled tasks (each run is a cloud session). Plans: Pro, Max, Ultra, Team, Enterprise premium seats. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Session list is the sidebar at claude.ai/code; archive removes from the sidebar, archived list at claude.ai/code/sessions; sharing is Private/Team (Team, Enterprise) or Private/Public (Pro, Max, Ultra), and a shared view "doesn't update in real time". — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Handoff asymmetry: "From the CLI, session handoff is one-way: you can pull cloud sessions into your terminal with `--teleport`, but you can't push an existing terminal session to the cloud." The Desktop app can send a local Code-tab session to the cloud via "Open in", carried over "as a summary". — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web); [Desktop docs](https://code.claude.com/docs/en/desktop.md)
- Teleport makes a copy, not a move: "The terminal gets its own copy of the session: new work there stays local and doesn't appear in the cloud session". `--resume` "doesn't list cloud sessions". Requirements: clean git state, same repo (not a fork), branch pushed, same account. Compacted history is not copied. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Follow-ups can be queued from any machine: `claude -p "msg" --cloud <session-id>`. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Review: Changes card with diff view, inline comments sent back to Claude; Auto-fix subscribes the session to PR CI failures and review comments; cannot react to merge conflicts because GitHub emits no webhook. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)
- Limits: cloning/PR creation require GitHub (GitLab/Bitbucket only as an upload bundle that cannot push back); not available via Bedrock/Vertex providers, ZDR, HIPAA or CMEK orgs; idle sessions expire and lose background shells, subagents and session-scoped scheduled tasks; parallel sessions consume shared rate limits proportionately. — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Remote Control (local sessions shown in the cloud list)**
- Connects claude.ai/code or the mobile app to a session running on the user's machine; execution stays local. Sessions appear "in the session list at claude.ai/code"; "Remote Control sessions show a computer icon with a green status dot when online". Plans: Pro, Max, Ultra, Team, Enterprise; no API keys. — [Remote Control docs](https://code.claude.com/docs/en/remote-control.md)
- Opt-in per session/process: one remote session per interactive process; server mode `claude remote-control` hosts multiple, `--capacity` default 32, `--spawn` same-dir or worktree. — [Remote Control docs](https://code.claude.com/docs/en/remote-control.md)
- Mobile push: "when a long-running task finishes or when Claude needs a decision"; two toggles ("Push when Claude decides", "Push when actions required"); "there is no per-event configuration"; pushes are suppressed while the user is at the connected terminal. — [Remote Control docs](https://code.claude.com/docs/en/remote-control.md)
- Fork from the web creates a new session in the list while the original keeps running (needs CLI v2.1.277+). — [Remote Control docs](https://code.claude.com/docs/en/remote-control.md)

**Desktop app Code tab**
- "each conversation is a session"; sidebar lists sessions with Group by / Sort by and an Archived tab; split view and separate windows; optional per-session Worktree (off by default). Environments: Local, Cloud, SSH, WSL. — [Desktop docs](https://code.claude.com/docs/en/desktop.md)
- OS notification "when a Code session finishes a task and you aren't currently viewing that session". Auto-archive after PR merge/close is a setting (not for cloud or running sessions). — [Desktop docs](https://code.claude.com/docs/en/desktop.md)
- Claude itself can "list, read, and message your other Code tab sessions, and rename or archive them" (20 most recently active by default). — [Desktop docs](https://code.claude.com/docs/en/desktop.md)
- SSH/WSL sessions cannot be moved to the cloud; "Merge when ready" disabled there. Dispatch (phone to desktop) is "not available to new users". — [Desktop docs](https://code.claude.com/docs/en/desktop.md)

**Projects (Claude as the coordinator)**
- "A project is one ongoing conversation where Claude coordinates a stream of related work"; it "starts a thread for each task"; each thread is usually a cloud session, or runs on the user's computer through Remote Control on request. Public beta on Pro, Max, Ultra; not on Team/Enterprise yet. — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)
- Overview pane buckets: Ready for review (PR open, awaiting review), Waiting on you (needs reply or approval, or failed), Working, Idle. A dot on the Threads button signals a waiting thread. — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)
- Desktop notification by default "when Claude posts in the conversation, a thread hits an error, or a thread needs your input"; in a browser only the dot. — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)
- Approval routing gap: a permission prompt lives inside the thread; "Telling Claude in the project conversation to go ahead doesn't reach it." — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)
- Published operating advice: write project instructions (branch target, how a thread checks its work, what needs go-ahead); "propose threads before starting them and to run a few at a time", then relax; a thread limit given conversationally "isn't a hard cap". — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)

**Engineering-blog guidance (search snippets only; pages not opened in this pass)**
- Multi-agent research system: orchestrator-worker; Opus 4 lead + Sonnet 4 subagents beat single-agent Opus 4 by 90.2% on an internal eval; multi-agent suits breadth-first, independent directions. — [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Long-running harness posts: structured artifacts to hand off context between sessions; separate the working agent from the judging agent; context resets rather than compaction alone. — [Harness design for long-running apps](https://anthropic.com/engineering/harness-design-long-running-apps); [Effective harnesses for long-running agents](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- C-compiler post: "One Claude Code session can only do one thing at a time", motivating parallel instances. — [Building a C compiler](https://anthropic.com/engineering/building-c-compiler)

### Inferences
- Anthropic's own state vocabularies differ by surface: agent view UI (Working / Needs input / Idle / Completed / Failed / Stopped), agent view JSON (working / blocked / done / failed / stopped), Projects (Ready for review / Waiting on you / Working / Idle, with failed folded into Waiting on you). A unifying board must normalise even within one vendor.
- "Ready for review" is derived from PR state in both agent view and Projects, i.e. the PR, not the transcript, is the review signal.
- Local and cloud are joined only when the user opts each local session into Remote Control; plain terminal sessions and agent-view background sessions are not stated to appear in the claude.ai/code list. Teleport forks history rather than moving a session, so one logical task can end up as two diverging sessions.
- Agent view exposes the only documented script-friendly local interface (`claude agents --json`); this is the most natural integration point for a third-party board, but it is research preview.

### Gaps
- No product named "FleetView" was found in any Anthropic source; treat the name as unverified/nonexistent.
- Launch dates for agent view, Projects, and Remote Control were not confirmed from primary sources in this pass (a blog post exists at claude.com/blog/agent-view-in-claude-code but was not opened).
- Claude Agent SDK session management, cloud scheduled tasks ("routines") details, and the mobile app's exact status badges were not fetched.
- Whether the claude.ai/code sidebar shows per-session status badges (working / needs input) is not documented on the pages read; the desktop page explicitly did not document status labels in the portion read (page truncated at 100k of 230k characters).
- The 2025 "Claude Code best practices" post (worktrees, multiple checkouts) was not re-verified.

## OpenAI: how Codex models tasks/threads across app, CLI, IDE, cloud, and what guidance it publishes

### Takeaway
Codex's unit is the thread (docs now also say "chat"), organised under projects in a desktop app that offers Local, Worktree and Cloud modes with a first-class "Handoff" between Local and Worktree; local threads sync between app and IDE extension, while cloud tasks are a separate track. OpenAI's main published guidance ("Harness engineering", Feb 2026) is about making the repo legible to agents and shifting review to agents, not about UI for supervising many sessions.

### Cited Findings
- New-thread composer offers Local, Worktree and Cloud; Local and Worktree run on the user's computer, Cloud runs in a configured cloud environment (search snippet of the app features page). — [Codex app features](https://developers.openai.com/codex/app/features)
- Handoff is "The flow that moves a chat between Local and Worktree"; "Handing off to or from Local moves your chat and code so you can continue in the other checkout"; "Each chat keeps the same associated worktree over time". Gitignored files do not follow unless listed in `.worktreeinclude`. — [Worktrees docs](https://learn.chatgpt.com/docs/environments/git-worktrees.md)
- Worktree lifecycle: "By default, Codex keeps your most recent 15 Codex-managed worktrees"; not deleted while the chat is pinned or in progress; deleted on archive; a snapshot is saved and can be restored. Scheduled tasks/automations run on dedicated background worktrees. — [Worktrees docs](https://learn.chatgpt.com/docs/environments/git-worktrees.md)
- Naming drift: developers.openai.com/codex/app/* now 308-redirects to learn.chatgpt.com/docs/*, and those pages say "ChatGPT desktop app" with "Codex" as the agent name. — [Worktrees docs](https://learn.chatgpt.com/docs/environments/git-worktrees.md); [Features](https://learn.chatgpt.com/docs/features.md)
- Features index lists: projects ("Keep related chats, context, and work together"), mobile ("Start tasks, approve actions, and review work from your phone"), scheduled tasks ("Schedule recurring work and review completed results"), notifications ("Choose how ChatGPT tells you when work needs attention"), long-running work. — [Features](https://learn.chatgpt.com/docs/features.md)
- App and IDE extension "automatically sync when both are in the same project"; threads running in the app are visible in the IDE extension and vice versa; the app picks up session history and config from CLI and IDE extension (search snippets). — [Codex app docs](https://developers.openai.com/codex/app); [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- IDE can offload to cloud and "track progress and review results without leaving your IDE"; a cloud task started from a local conversation keeps the conversation context (search snippet). — [Codex IDE cloud tasks](https://developers.openai.com/codex/ide/cloud-tasks)
- User-reported gaps: Codex Cloud "lacks the same practical project-based organization experience" as local folders in the desktop app; users ask the app to "clearly distinguish local-only tasks from cross-device sync" (community posts, not OpenAI statements). — [Community request 1](https://community.openai.com/t/please-add-cloud-synced-project-folders-to-codex-cloud/1408669.md); [Community request 2](https://community.openai.com/t/codex-desktop-should-clearly-distinguish-local-only-tasks-from-cross-device-sync/1393084)
- "Harness engineering: leveraging Codex in an agent-first world" (Ryan Lopopolo, Feb 11 2026): the human role shifts to designing environments and feedback loops; app made bootable per git worktree so one instance runs per change; Codex reviews its own changes and requests further agent reviews; give the agent "a map" rather than a giant instruction file (search snippet; date from snippet). — [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- Third-party anecdote: starting several threads in Local means they all touch the same files; worktree directories accumulate. — [macaron.im (third-party)](https://macaron.im/blog/codex-app-worktrees-parallel-agents)

### Inferences
- Codex treats local vs worktree as a cheap, reversible placement of the same thread (foreground/background), which is a cleaner model than Anthropic's copy-based teleport; but local-to-cloud remains a delegation that creates a separate cloud task rather than a move.
- Auto-pruning worktrees (keep 15, snapshot before delete) is the only published vendor answer found to worktree sprawl.

### Gaps
- Thread status names, the automations inbox/triage design, and notification specifics were not retrievable (the features page is now an index; sub-pages not fetched).
- Codex app launch date, Codex SDK, Codex in Slack/GitHub, and Codex subagent/multi-agent features were not verified from primary sources in this pass.
- Exact mechanics of applying a cloud task's diff locally were not found.

## GitHub: Agent HQ / mission control / Agents tab, and VS Code's sessions surfaces

### Takeaway
GitHub offers the only first-party multi-vendor session list (Copilot, Claude, Codex, partner and custom agents), but it unifies sessions that run through GitHub (cloud agent runs on a repo, plus sessions inside VS Code); it does not claim to list sessions running in vendors' own clouds or arbitrary terminals. VS Code is converging on an "Agents window" with an agent host that runs Copilot and Claude harnesses, and since Aug 2026 can continue some externally created sessions.

### Cited Findings
- Agent HQ was announced at GitHub Universe (Oct 28 2025) with "mission control" as a command centre across GitHub, VS Code, mobile and CLI (search snippet). — [GitHub blog: Introducing Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/)
- Nov 27 2025 changelog: "A mission control to assign, steer, and track Copilot coding agent tasks"; Jan 26 2026: Agents tab introduced in each repository (titles from search results). — [Changelog 2025-11-27](https://github.blog/changelog/2025-11-27-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/); [Changelog 2026-01-26](https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository)
- Feb 4 2026: Claude and Codex in public preview on Agent HQ for Copilot Pro+ and Copilot Enterprise; must be explicitly enabled; start from github.com Agents tab, issues/PR assignment, `@Claude`/`@Codex` mentions, GitHub Mobile, VS Code 1.109+. "Each coding agent session consumes one premium request." Multi-agent in Copilot CLI "coming soon". — [GitHub blog: Pick your agent](https://github.blog/news-insights/product-news/pick-your-agent-use-claude-and-codex-on-agent-hq/)
- VS Code session types as of that post: Local (interactive, incl. Claude and Codex), Cloud (autonomous, runs on GitHub), Background (asynchronous local, Copilot only). — [GitHub blog: Pick your agent](https://github.blog/news-insights/product-news/pick-your-agent-use-claude-and-codex-on-agent-hq/)
- Current docs: Agents tab is "one centralized control page to jump between agent sessions"; view "all active agent sessions that have been started in the repository"; live session log; steering mid-run "without stopping the run", billed in AI credits per message; a session can be opened in VS Code or Copilot CLI to "bring the session to your local machine". The page defines no named status taxonomy. — [GitHub docs: About agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management)
- Cloud agent sessions are shared by default and appear in "All sessions"; local sessions are unshared by default (search snippet from GitHub Copilot app docs). — [GitHub docs: agent sessions](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/github-copilot-app/agent-sessions)
- VS Code timeline (search snippets of release notes): Agent Sessions view grouping by state and age, archive, read state (1.108, Dec 2025); "home for multi-agent development" (1.109, Jan 2026); Agents window preview in Stable (May 2026); dedicated agent host process running harnesses such as Copilot, Claude, Codex, opt-in (1.129, Jul 2026). — [VS Code 1.108](https://code.visualstudio.com/updates/v1_108); [1.109](https://code.visualstudio.com/updates/v1_109); [1.129](https://code.visualstudio.com/updates/v1_129)
- Aug 2026 (1.132 to 1.135): "Continue external agent sessions": recent Copilot or Claude agent sessions created in other applications can be viewed and continued from the Sessions list; agent host lets you "connect to the same agent session from multiple VS Code windows"; Agents window can open without GitHub sign-in when Claude is configured with an API key (experimental). Codex not mentioned for external sessions. — [GitHub changelog 2026-08-31](https://github.blog/changelog/2026-08-31-github-copilot-in-vs-code-august-2026-releases/)
- VS Code 1.136 (Sep 2 2026): sessions list is hierarchical ("Chats appear as children of their parent session"), each chat row shows title, status and pending approvals; "VS Code can notify you when an agent session needs your input or finishes its work", by default only when the window is unfocused; agent host is based on the Agent Host Protocol (AHP). — [VS Code 1.136](https://code.visualstudio.com/updates/v1_136)

### Inferences
- GitHub's unification is by venue (the repo/PR and the editor), not by vendor account: a Claude session started at claude.ai/code or a Codex cloud task started in ChatGPT is a different object from "Claude on Agent HQ". No source read states that vendor-native cloud sessions appear in the Agents tab.
- VS Code's "continue external sessions" (Copilot, Claude) is the closest first-party step toward cross-app local unification, likely by reading on-disk session stores; this mechanism is my inference and is not stated in the changelog.
- Billing differs between sources (one premium request per session in Feb 2026 vs AI credits per steering message in current docs), implying the pricing model changed during 2026.

### Gaps
- Whether Agent HQ third-party agents are still in preview and on which plans in Nov 2026 was not confirmed.
- Named session statuses in the github.com Agents tab were not found in docs.
- "GitHub Copilot app" (a docs section exists under /how-tos/github-copilot-app/) was not investigated; its nature and launch date are unverified.

## Google, Cursor, and others (Devin, Warp, Zed, Amp, Factory, JetBrains)

### Takeaway
Google consolidated everything into Antigravity during 2026 (Gemini CLI replaced by Antigravity CLI in May/June; Jules read-only since Nov 11 and shutting down Dec 31), leaving it without a confirmed shipped cloud-agent surface at the time Jules closes. Cursor 3 (Apr 2 2026) has the most complete single-vendor unification: one sidebar for local, cloud and externally triggered agents with two-way local/cloud handoff.

### Cited Findings

**Google**
- Antigravity 2.0 (May 19 2026) is "a new, standalone desktop application" for macOS, Linux, Windows; "there is no IDE"; it "retains many of the core principles of the Antigravity IDE's Agent Manager surface". Conversations are grouped by "project" spanning multiple folders; dynamic subagents; background async tasks; artifacts users can comment on; crons and `/schedule`. Remote Control and "cloud-deployed agents" are listed as future plans. — [Antigravity blog: Introducing Antigravity 2.0](https://www.antigravity.google/blog/introducing-google-antigravity-2)
- Gemini CLI transitions to Antigravity CLI (announced May 19 2026); Gemini CLI stopped serving Google AI Pro/Ultra and free users on June 18 2026 (still available with paid API keys/enterprise); Antigravity CLI shares the agent harness with the desktop app and supports multiple background agents. — [Google Developers Blog](https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- Jules: press reports a changelog notice dated Oct 29 2026; read-only from Nov 11 2026; shut down Dec 31 2026; data export offered; folded into Antigravity (secondary sources, official changelog not opened). — [TechRadar](https://techradar.com/pro/google-kills-off-jules-its-ai-coding-agent-which-promised-to-do-all-the-jobs-you-didn-t-want-to); [TestingCatalog](https://www.testingcatalog.com/cloud-execution-is-coming-to-antigravity-soon/)
- TestingCatalog reports cloud execution "isn't currently available in Antigravity" though it was a Jules core capability; a 9to5Google item describes cloud "Remote Agents" rolling out to AI Pro/Ultra (conflicting, both secondary, neither opened). — [TestingCatalog](https://www.testingcatalog.com/cloud-execution-is-coming-to-antigravity-soon/); [9to5Google](https://9to5google.com/?p=735905)
- Agent Manager inbox collecting requests needing intervention plus OS notifications: described in a conference talk and third-party articles only. — [AI Engineer talk](https://ai.engineer/talks/HN-F-OQe6j0-defying-gravity)

**Cursor**
- Cursor 3 (Apr 2 2026): Agents Window is "a unified workspace for building software with agents"; all local and cloud agents appear in one sidebar, including those started from mobile, web, desktop, Slack, GitHub and Linear; multi-workspace across repos. — [Cursor blog: Cursor 3](https://cursor.com/blog/cursor-3)
- Two-way handoff: "Move an agent session from cloud to local when you want to make edits and test it on your own desktop", and local to cloud to keep running while offline. Cloud agents produce demos and screenshots for verification; diff view supports stage, commit, manage PRs. — [Cursor blog: Cursor 3](https://cursor.com/blog/cursor-3)
- Changelog says agents run "in parallel across repos and environments": locally, in worktrees, in the cloud, and on remote SSH (search snippet). — [Cursor changelog 3.0](https://cursor.com/changelog/3-0)
- Week of Oct 19 2026: cloud agent conversations on cursor.com/agents, the PR agent panel and side chats "now use the same transcript as the Agents Window"; June 17 2026: cloud subagents in Agents Window; June 2026: team MCP servers configured once across cloud agents, Agents Window, IDE, CLI (search snippets). — [Cursor cloud agents release notes](https://cursor.com/docs/release-notes/cloud-agents)
- Framing: engineers were micromanaging agents and juggling conversations, terminals and windows; aim is "pulling you up to a higher level of abstraction, with the ability to dig deeper when you want". — [Cursor blog: Cursor 3](https://cursor.com/blog/cursor-3)

**Others**
- Devin API v3: session `status` enum new, claimed, running, exit, error, suspended, resuming; `status_detail` while running: working, waiting_for_user, waiting_for_approval, finished; sessions carry `child_session_ids` (search snippet of API reference). — [Devin API reference](https://docs.devin.ai/api-reference/v3/sessions/get-enterprise-session.md)
- Zed: Parallel Agents with a Threads Sidebar giving an overview of all threads grouped by project, multiple agents in one window; vendor-open via the Agent Client Protocol (ACP) that Zed created; release dated Apr 22 2026 by a third-party write-up (search snippet). — [Zed blog: Parallel Agents](https://zed.dev/blog/parallel-agents)
- Warp: management UI showing status of all running agents with in-app and system notifications when an agent completes or needs help; vertical tabs show each agent's status, branch, directory; an Agent Management Panel shows parent and child runs; cloud fan-out via Oz CLI / Oz web app / Warp Platform API (search snippet). — [Warp docs: run multiple AI coding agents](https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents.md)

### Inferences
- Zed (via ACP) and Warp (terminal-level, agent-agnostic) and VS Code (agent host) are the first-party surfaces that manage other vendors' local agents; the model labs' own apps (Claude, Codex/ChatGPT, Antigravity, Cursor) each manage only their own agents.
- Google's consolidation removes its only mature async cloud agent (Jules) before Antigravity's cloud agents are confirmed GA, so Google's local+cloud story is the least settled of the majors in Nov 2026.

### Gaps
- Amp (Sourcegraph), Factory, and JetBrains (including any product called "Air") were not researched; no sources retrieved. Do not cite claims about them from this note.
- Devin's UI for parallel sessions, Cursor's status badge vocabulary and notification behaviour, and Antigravity's shipped inbox/notification behaviour are not confirmed from primary docs.
- Jules shutdown dates are from press, not the official changelog; Antigravity cloud/remote agent availability has conflicting secondary reports.

## Cross-vendor: common state model, unit of work, inbox/notification pattern, oversight guidance, and what remains unsolved

### Takeaway
Vendors have converged on roughly the same four-to-six attention states and on "PR open" as the review signal, with a list grouped by "who needs me" plus OS/push notifications for needs-input and finished. None unifies sessions across vendors' clouds, and local+cloud unification within a vendor is partial everywhere except Cursor.

### Cited Findings
- State vocabularies found:
  - Claude agent view: Working / Needs input / Idle / Completed / Failed / Stopped; JSON working / blocked / done / failed / stopped. — [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
  - Claude Projects: Ready for review / Waiting on you / Working / Idle. — [Projects docs](https://code.claude.com/docs/en/claude-projects.md)
  - Devin API: running sub-states working / waiting_for_user / waiting_for_approval / finished; plus suspended, error. — [Devin API reference](https://docs.devin.ai/api-reference/v3/sessions/get-enterprise-session.md)
  - VS Code: per-chat status and pending approvals; notifications for "needs your input or finishes its work". — [VS Code 1.136](https://code.visualstudio.com/updates/v1_136)
  - Warp: notifications when an agent "completes or needs help". — [Warp docs](https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents.md)
- Unit of work naming: Anthropic "session" (and "thread" inside a Project); OpenAI "thread"/"chat" within a project, "task" for cloud; GitHub "agent session"; VS Code "session" containing "chats"; Cursor "agent"; Zed "thread"; Devin "session" with child sessions. — [Desktop docs](https://code.claude.com/docs/en/desktop.md); [Projects docs](https://code.claude.com/docs/en/claude-projects.md); [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md); [GitHub agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management); [VS Code 1.136](https://code.visualstudio.com/updates/v1_136); [Cursor 3](https://cursor.com/blog/cursor-3); [Zed](https://zed.dev/blog/parallel-agents)
- Grouping containers above the unit: Anthropic Projects, Codex projects, Antigravity projects (multi-folder), Zed threads grouped by project, agent view directory grouping. — [Projects docs](https://code.claude.com/docs/en/claude-projects.md); [Features](https://learn.chatgpt.com/docs/features.md); [Antigravity 2.0](https://www.antigravity.google/blog/introducing-google-antigravity-2); [Zed](https://zed.dev/blog/parallel-agents); [Agent view docs](https://code.claude.com/docs/en/agent-view.md)
- Isolation convention: git worktree per parallel local task in Claude (agent view automatic, desktop optional), Codex (Worktree mode, auto-pruned to 15), Cursor (worktrees). — [Agent view docs](https://code.claude.com/docs/en/agent-view.md); [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md); [Cursor changelog 3.0](https://cursor.com/changelog/3-0)
- Notification pattern: fire on needs-input and on finish/fail; suppress when the user is already looking (VS Code only when unfocused; Claude desktop only when not viewing that session; Claude mobile push skipped while at the terminal). — [VS Code 1.136](https://code.visualstudio.com/updates/v1_136); [Desktop docs](https://code.claude.com/docs/en/desktop.md); [Remote Control docs](https://code.claude.com/docs/en/remote-control.md)
- Published oversight guidance: start with few parallel threads and have the coordinator propose before starting (Anthropic Projects); give each parallel task its own worktree or partition files (Anthropic); make the app bootable per worktree and shift first-pass review to agents (OpenAI); cloud agents should attach demos/screenshots as evidence (Cursor); separate worker from judge and hand off through structured artifacts (Anthropic harness posts). — [Projects docs](https://code.claude.com/docs/en/claude-projects.md); [Run agents in parallel](https://code.claude.com/docs/en/agents.md); [OpenAI harness engineering](https://openai.com/index/harness-engineering/); [Cursor 3](https://cursor.com/blog/cursor-3); [Anthropic harness design](https://anthropic.com/engineering/harness-design-long-running-apps)
- Cost is stated as the main limit on fan-out: parallel sessions "consume more rate limits proportionately" and "multiplies token usage". — [Claude cloud docs](https://code.claude.com/docs/en/claude-code-on-the-web); [Run agents in parallel](https://code.claude.com/docs/en/agents.md)

### Inferences
- A workable common state model that all the cited vendors map onto: working; needs input (split: question vs permission/approval); ready for review (PR open or diff ready); idle/done; failed; stopped/suspended. "Ready for review" and "needs input" are the two states every vendor promotes to the top of the list.
- Unsolved, based on what the sources do not offer:
  1. Cross-vendor cloud view: no first-party surface lists a Claude cloud session, a Codex cloud task and a Cursor cloud agent together. GitHub lists only GitHub-run sessions; VS Code/Zed/Warp cover local harnesses.
  2. Local + cloud in one list: Cursor does it; Anthropic needs per-session Remote Control opt-in and has separate agent view vs web lists; Codex users are still requesting clarity; Google has no confirmed shipped cloud side.
  3. Identity across handoff: Anthropic teleport copies, desktop "Open in Cloud" summarises; one task becomes multiple sessions with no shared ID. Codex Handoff preserves the thread but only between Local and Worktree.
  4. Nested work visibility: subagents/teammates are not rows in agent view; VS Code only added chat hierarchy in Sep 2026; Devin exposes child session IDs.
  5. Approval routing: approvals must generally be answered inside the specific session (Claude peek cannot answer permission prompts; Projects conversation cannot approve for a thread).
  6. No shared status schema or protocol across vendors; candidates are vendor-specific (ACP from Zed, AHP in VS Code, `claude agents --json`).
- These gaps define the opportunity for a third-party "session board": normalise states, key on repo/branch/PR as the cross-vendor join key, and aggregate needs-input into one inbox.

### Gaps
- No vendor-published quantitative guidance on how many parallel agents one human can supervise was found.
- An arXiv paper "ParallelPilot: Supporting Coordination and Monitoring in Parallel AI Coding" (arxiv.org/pdf/2609.33113) surfaced in search but was not read; it may contain independent HCI evidence.
- Several findings above rest on search snippets rather than opened pages (marked inline); verify before quoting verbatim.
