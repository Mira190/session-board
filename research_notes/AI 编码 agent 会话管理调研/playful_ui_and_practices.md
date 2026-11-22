# Playful / spatial agent UIs and parallel-agent practice (state as of 2026-11-22)

Reading notes for the writer:
- All star counts were read from the GitHub pages on 2026-11-22 unless another date is given.
- "Anecdote" = one person's self-report. "Measured" = a number someone counted. Almost nothing in this field is measured; I found no controlled study of any agent-visualization UI.
- Most pages were read through a summarizing fetch tool, so short quotes are reliable but long passages are paraphrased.

## 1. Which products visualize coding agents as characters in an office or game world, and how are they built and received?

### Takeaway
The genre is real and popular by star count (Pixel Agents about 10.3k stars, Star-Office-UI several thousand, Vibecraft 1.5k), and every project uses the same recipe: Claude Code hooks and/or JSONL transcript tailing feed a small local server, which drives a tool-to-animation lookup table. Evidence that these stay useful after the novelty fades is absent; the only critical review found calls Pixel Agents "motivational theater" because it observes but does not control, and the projects that respond to that criticism (AgentCraft, Pixel Agents' own roadmap) do so by adding control and "jump to the agent that needs me" features.

### Cited Findings

Pixel Agents (VS Code extension + standalone CLI)
- About 10.3k stars, 1.8k forks, MIT license; the repo now lives under the `pixel-agents-hq` organisation (previously `pablodelucca/pixel-agents`). Read 2026-11-22. — [GitHub](https://github.com/pablodelucca/pixel-agents)
- State detection is hybrid. Default "hooks mode": "a hook script receives Claude events such as SessionStart, PreToolUse, PermissionRequest, and Stop" and sends authenticated events to running Pixel Agents servers. Fallback "heuristic mode": status inferred by scanning JSONL transcripts under `~/.claude/projects/`. Transcripts are also read in hooks mode for detail the events lack. — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Early versions were transcript-only: a February 2026 review describes it as a tool that "watches .jsonl transcript files" with "zero modifications to the agent itself". So the project moved from pure tailing to hooks-first during 2026. — [UCStrategies, 2026-02-25](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/)
- State-to-animation mapping: characters "walk to their desks, sit down, type when they're editing files, read when they're searching"; they "flag you visually when they're stuck waiting for input"; speech bubbles appear when an agent needs input or permission or finishes its turn, with optional chimes. — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Sub-agents: "Sub-agents and teammates show up as their own characters." — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Layout editor: paint floors, walls, carpets; place and recolour furniture; clickable pets; named Areas that a directory's agents prefer to occupy; layouts export/import as JSON; external asset packs. — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Standalone mode: `npx pixel-agents` serves the same office in a browser; without the `?token=` URL it is read-only (no launching agents, no terminals, no edits). Requires Node 20+ for the CLI, VS Code 1.105.0+ for the extension. — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Only Claude Code is supported; "Codex, Gemini, Cursor, and others are on the roadmap." — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Roadmap has three goals: "Actually a game" (scores, furniture that does things, per-project offices); orchestration (team formation, handing work between agents, "agents picking up tasks from a board"); and support for any agent CLI. The README says "Most of this is still ahead." — [GitHub](https://github.com/pablodelucca/pixel-agents)
- Forks exist for other agents: a Codex fork and PixelClaw, "a fork of Pixel Agents, rewired to monitor OpenClaw agents instead of Claude Code terminals". — [pixel-agents-codex](https://github.com/MichaelMa907/pixel-agents-codex); [PixelClaw](https://github.com/emortoo/pixelclaw)
- Critical review (opinion, one author, February 2026): calls it "motivational theater"; says it "satisfies that urge without solving the underlying problem"; "you still can't stop an agent from doing something stupid"; "the worst of both worlds: automation without confidence"; notes polished assets required buying a tileset and that it was VS Code-only at the time. One developer is quoted calling the architecture "stupid simple". — [UCStrategies, 2026-02-25](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/)

Star-Office-UI (OpenClaw-oriented pixel office)
- "A pixel-art AI office dashboard" that is "Best experienced with OpenClaw" but works standalone; co-created by Ring Hyacinth and Simon Lee. — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Six states map to three rooms: `idle` to the breakroom sofa; `writing`, `researching`, `executing`, `syncing` to the desk; `error` to a "Bug Corner". — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- State is pushed by the agent itself, not observed: `python3 set_state.py writing "Organizing documents"` or `POST /set_state`; a rule in OpenClaw's `SOUL.md` tells the agent to call it when starting and finishing tasks. Guest agents join with `POST /join-agent` and a script that "auto-joins and pushes status every 15 seconds". — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Stack: Flask backend, static HTML frontend, optional Electron "desktop pet" wrapper (described as an "optional, experimental feature", mainly tested on macOS). — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- A stale-state auto-idle fix shipped 2026-03-04, which shows self-reported state goes stale when the agent forgets to report. Open-sourced around 2026-03-01 to 03-03. — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Extra feature: "Yesterday Memo" card that "Automatically reads the latest daily log from `memory/*.md`". — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Licensing trap: code is MIT but art is "Non-commercial use only (learning / demo / sharing)"; guest characters use free LimeZu assets. — [README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Popularity: one Chinese mirror listing gave about 4.8k stars, date unclear (unverified). — [cnb.cool mirror](https://cnb.cool/takenotes/github.com/ringhyacinth/Star-Office-UI)
- Several other OpenClaw office dashboards exist (pixel-office-openclaw, a read-only plugin reusing Star-Office sprites); one ClawHub "pixel-office" skill carried a "Skill flagged — review recommended" label. — [pixel-office-openclaw](https://github.com/neomatrix25/pixel-office-openclaw); [ClawHub](https://clawhub.ai/skills/pixel-office)

Vibecraft (3D workshop)
- 1.5k stars, 233 forks, MIT, only 5 commits on `main`; Three.js + TypeScript; needs Node 18+, `jq`, `tmux`. Read 2026-11-22. — [GitHub](https://github.com/Nearcyan/vibecraft)
- Events come from Claude Code hook scripts installed by `npx vibecraft setup`; a local WebSocket server (default port 4003) relays them. "macOS or Linux (Windows not supported - hooks require bash)". — [GitHub](https://github.com/Nearcyan/vibecraft)
- Tool-to-station table: Read to Bookshelf; Write to Desk; Edit to Workbench; Bash to Terminal; Grep/Glob to Scanner; WebFetch/WebSearch to Antenna; Task (subagents) to Portal; TodoWrite to Taskboard. — [GitHub](https://github.com/Nearcyan/vibecraft)
- Attention features: "Zones pulse when sessions need input or finish"; synthesized sounds per tool and event; "Spatial Audio"; "Claude celebrates commits, shakes head on errors"; thought bubbles while thinking. — [GitHub](https://github.com/Nearcyan/vibecraft)
- It is also a controller: spawn sessions with `Alt+N`, each "runs in its own tmux, with status tracking (idle/working/offline)", select sessions with number and letter keys, send prompts from the browser. — [GitHub](https://github.com/Nearcyan/vibecraft)
- A third-party write-up warns that the hook scripts could break on Claude Code updates. — [Starlog](https://starlog.is/articles/ai-dev-tools/nearcyan-vibecraft)

AgentCraft (RTS-style, Ido Salomon)
- Presented at AI Engineer Europe 2026 as "AgentCraft: Putting the Orc in Agent Orchestration". — [AI Engineer](https://www.ai.engineer/talks/kR64LOqBBCU-agentcraft-putting-orc-in-agent-orchestration)
- Per a secondary summary of a later talk (2026-10-01): agents are units on a map onto which the codebase is projected; a side panel shows each agent's status, last task and current task; files and directories appear as "runes"; heat maps show where effort concentrates; a spacebar-like key cycles to the agent that needs input; agents propose "quests" the user accepts in one click; agents can be "detected on-device or spawned directly". — [Sean Weldon summary, 2026-10-01](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- Quotes attributed to the talk: "we are the bottleneck, but we don't have to be"; "it's pretty exhausting to keep looking at what the agents are doing in the granularity of what files are they using"; "it's pretty lonely to just talk to agents all day". — [Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- No usage metrics reported; adoption evidence is anecdotal (non-technical users and children picked it up). The summary itself flags as open whether runes and heat maps reduce cognitive load or just move it to a visual channel, and whether visual evidence creates "false confidence". — [Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- Name collision: a separate MIT-licensed Minecraft (Fabric) mod also called AgentCraft puts Claude agents in a walkable studio with worktrees, in-game diffs and merge gating. — [AlphaSignal](https://alphasignal.ai/repo/agentcraft-turns-minecraft-into-a-live-claude-coding-agent-control-room)
- Other RTS-flavoured projects seen in search but not examined: "Age of Agents" ("A peaceful RTS for Claude Code, Codex, OpenCode & Koda") and Tide Commander. — [Age of Agents](https://agentsmill.github.io/age-of-agents/); [Tide Commander post](https://dev.to/deivid11/command-center-for-ai-coding-agents-claude-code-codex-3d5g)

Gas Town (Steve Yegge) — a roles metaphor, not a graphical UI
- Structure: a human Overseer talks to a coordinator (Mayor), which dispatches work to worker agents (Polecats) in isolated git worktrees. — [How to Think About Gas Town](https://news.lavx.hu/article/how-to-think-about-gas-town)
- Criticisms reported in commentary and HN summaries (anecdotal): the Mad Max naming is hard to keep track of; a 20-agent swarm can burn hundreds of dollars in a weekend; it installs "magic hooks and daemons all over your system". — [dehora.net, 2026-02](https://dehora.net/journal/2026/2/initial-thoughts-on-welcome-to-gas-town); [Rutigliano, 2026-01](https://daviderutigliano.github.io/portfolio-website/posts/2026/01/gas-town-the-industrial-revolution-of-vibe-coding/)
- Outcome: Yegge wrote (essay "The Shape of Things to Come", quoted by Simon Willison on 2026-08-04) that Gas Town "was intended to be reusable" but he only used it to build itself, that it worked through Opus 4.6, and that after a model behaviour change in Opus 4.7 it "effectively burned down". This is Yegge's own account. — [Simon Willison, 2026-08-04](https://simonwillison.net/2026/Aug/4/steve-yegge/)

AI Town / Stanford Generative Agents (UI precedent)
- AI Town: 10.8k stars, MIT, "Inspired by the research paper Generative Agents: Interactive Simulacra of Human Behavior". Rendering is PixiJS ("All interactions, background music and rendering ... are powered by PixiJS"); maps are authored in Tiled and exported as JSON; Convex is the backend and simulation engine. The simulation pauses after 5 minutes of inactivity. Read 2026-11-22. — [GitHub](https://github.com/a16z-infra/ai-town)

First-party non-playful baseline
- Claude Code has a terminal-native "Agent View" listing sessions with per-agent status (thinking, executing, waiting, complete, error) and letting the user answer a paused agent's question in place (third-party description, 2026-05-12). — [MindStudio, 2026-05-12](https://www.mindstudio.ai/blog/what-is-claude-code-agent-view)

### Inferences
- Two state-acquisition models exist and they fail differently. Observed state (hooks, transcripts: Pixel Agents, Vibecraft) is accurate but coupled to Claude Code's hook and transcript formats. Self-reported state (Star-Office-UI's `set_state`) is agent-agnostic but goes stale, which is why a stale-state auto-idle had to be added. For a session manager that already owns session state, the office view can be a pure renderer over existing state and avoid both problems.
- Pixel Agents' move from transcript tailing to hooks-first, with `PermissionRequest` and `Stop` as named events, suggests transcript heuristics were not good enough for the two states users care about most: "needs permission" and "finished".
- The mapping tables are small in every project (6 states in Star-Office, 8 stations in Vibecraft, about 4 animations in Pixel Agents). Nobody ships a rich state vocabulary; the walking and typing is decoration around a 3-to-6-state model.
- The one substantive critique (watching without control) and the direction of AgentCraft and the Pixel Agents roadmap point the same way: an office view is defensible when a character is also a control surface (click to open the session, answer the prompt, jump to next waiting agent).
- "Agent walks over to you" is not implemented in any project found. The nearest equivalents are speech bubbles (Pixel Agents), pulsing zones (Vibecraft) and a jump-to-attention hotkey (AgentCraft). It would be a novel mapping, which also means it is untested.
- Gas Town's history is a warning about heavy metaphor: unfamiliar role names were a recurring complaint, and the system did not survive a model change.

### Gaps
- No retention, DAU or long-term usage data for any visualizer. "Stays useful after novelty wears off" is unanswered by evidence; I found opinion only.
- I could not find a Hacker News or Reddit thread with substantive user debate on Pixel Agents; a targeted search returned only a one-line positive comment on a related Show HN. Marketplace install counts were not retrieved.
- Pixel Agents' rendering technology is not stated on the README page read. Prior knowledge says a React webview drawing on Canvas 2D with a custom loop, not Pixi or Phaser; treat as unverified.
- Star-Office-UI's frontend engine is not named in the README (it may be Phaser; unverified). Current star count not directly read.
- A product literally named "Claude Office" was not verified. Related names seen but not examined: agents-in-the-office, pixel-agent-desk, Agent Pixels.
- The Stanford Smallville paper itself was not opened. From memory (unverified here): 25 agents, sprite sandbox built on Phaser, arXiv 2304.03442, April 2023.
- AgentCraft's own repo or site was not read; details come from one secondary talk summary, and its tech stack and state-acquisition mechanism are unknown.
- Yegge's replacement for Gas Town, if any, was not identified.

## 2. What design lessons exist for making a playful visualization functionally useful?

### Takeaway
There is no measured evidence; lessons have to be read off what shipped and what critics said. The consistent pattern is that the valuable signal is a tiny set of attention states (needs input, needs permission, finished, error) carried by redundant channels (bubble, pulse, sound), and that the visualization earns its place only when it is also the shortest route to acting on that signal.

### Cited Findings
- Attention states get dedicated, redundant cues in every project: Pixel Agents uses speech bubbles plus optional chimes for needs-input, needs-permission and turn-finished; Vibecraft pulses zones "when sessions need input or finish" and adds sound. — [Pixel Agents](https://github.com/pablodelucca/pixel-agents); [Vibecraft](https://github.com/Nearcyan/vibecraft)
- Location encodes coarse state in Star-Office-UI (sofa = idle, desk = working, Bug Corner = error), so the state is readable from where the character is, without reading text. — [Star-Office-UI README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md)
- Fine-grained activity is reported as tiring to watch: "it's pretty exhausting to keep looking at what the agents are doing in the granularity of what files are they using" (attributed to AgentCraft's author); AgentCraft's response is aggregation (heat maps) and a key that cycles to the next agent needing input. — [Sean Weldon summary, 2026-10-01](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- Observation without control is the main criticism: Pixel Agents "offers emotional reassurance" rather than oversight (opinion). — [UCStrategies, 2026-02-25](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/)
- Visual proof can mislead: the AgentCraft summary raises "false confidence" from visual evidence without code-level verification as an open risk. — [Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- Background anxiety about unchecked threads is named as a real cost ("the ambient anxiety tax"), which is the problem a glanceable view claims to address (personal essay, no data). — [Addy Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/)
- Performance and lifecycle precedent: AI Town pauses its simulation after 5 minutes of inactivity. — [AI Town](https://github.com/a16z-infra/ai-town)
- Read-only by default for shared or remote views: Pixel Agents' standalone office is read-only without a token. — [Pixel Agents](https://github.com/pablodelucca/pixel-agents)
- Asset licensing constrains playful UIs: Star-Office art is non-commercial; Pixel Agents' polished look originally needed a purchased tileset. — [Star-Office-UI README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md); [UCStrategies](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/)
- Agent count in practice is low single digits to roughly 15 (see section 4), which bounds how many characters the scene must handle. — [Addy Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/)

### Inferences
- Design the office around four or five states, not around tools. Tool-level animation (Vibecraft's eight stations) is charm; the state that changes user behaviour is "blocked on me" versus "not blocked on me".
- "Walks over to you" should be reserved for states that require the human (permission, question, finished and awaiting review). If every finish triggers a walk, it reproduces notification fatigue in sprite form; consider a queue at the user's desk whose length is itself the glanceable metric, matching Ronacher's and Osmani's queue framing in section 4.
- Every character needs to be a link: click to open the session, answer inline, and a single hotkey for "next agent waiting" (AgentCraft pattern). Without this the view inherits the "motivational theater" critique.
- Pair it with a dense non-playful view (the kanban or a list) driven by the same state, so the office is an optional skin and never the only place a state is visible. Claude Code's own Agent View shows the dense baseline users will compare against.
- Do not let animation stand in for verification: a "celebrating" character on commit says nothing about correctness, so review status should be a separate, explicit indicator.
- Budget for idle cost: pause the render loop when the tab is hidden or nothing has changed, as AI Town does.
- Accessibility needs deliberate work because no project documents it: state must not be colour- or motion-only, a reduced-motion mode and text labels are needed, and sound must be optional.
- Commission or license original art from day one; both leading projects hit asset-licence friction.

### Gaps
- No HCI study, usability test or A/B data on agent-office visualizations was found. Calm-technology and peripheral-display literature (Weiser and Brown; ambient display research) is the obvious theoretical base but was not searched or cited in this pass.
- No project documents accessibility (screen readers, reduced motion, colour-blind safety) or measured rendering cost at N agents.
- No evidence on the information-density ceiling (how many characters remain readable). The 3-to-15 figure is derived from how many agents people run, not from a legibility test.

## 3. Kanban for agents: how are states mapped to columns?

### Takeaway
The settled pattern is four columns (backlog/to-do, in progress, review, done/trash), one card per task with its own git worktree, automatic moves driven by agent lifecycle, and human moves for ship and discard. The main design fork is whether "blocked on human approval" shares the Review column with "finished" (Cline does this) or stays in In Progress.

### Cited Findings

Cline Kanban
- `npx kanban`, labelled a research preview; "Each task card gets its own git worktree and terminal, so you can run multiple coding agents in parallel without merge conflicts." — [GitHub](https://github.com/cline/kanban); [Cline docs](https://docs.cline.bot/kanban/overview)
- Columns (third-party walkthrough, about 2026-03-28): Backlog, In Progress, Review, Trash. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)
- Auto-moves: pressing play moves a card to In Progress and starts it in its own worktree; a card moves to Review when it is blocked or finished; pressing Commit sends it back to In Progress while the agent commits, then to Review again; Trash archives the card and cleans up the worktree. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)
- Review holds two kinds of card: tasks "blocked waiting for user approval" and completed tasks; only completed ones show Commit and Open PR buttons. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)
- Dependencies: Cmd/Ctrl+click links cards; when a linked card completes and is trashed, the next one "automatically starts". — [Cline docs](https://docs.cline.bot/kanban/core-workflow.md)
- Card face shows the agent's "latest message or tool call"; opening a card shows the agent's TUI plus a diff against the base branch. Shipping is a manual click on Commit or Open PR, which the agent then carries out. — [Cline docs](https://docs.cline.bot/kanban/core-workflow.md)
- Worktrees are ephemeral; gitignored files such as `node_modules` are symlinked from the main repo, with a warning that agent changes to them affect the main copy. Each task keeps a resume ID so trashed work can be resumed. — [Cline docs](https://docs.cline.bot/kanban/core-workflow.md)
- Supports Cline, Claude Code and Codex as the agent behind a card. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)
- User view (one blogger): the pain is "realizing an hour later that a task had already finished long ago"; but "The cognitive load that comes with parallel work doesn't disappear entirely." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)

Vibe Kanban (Bloop)
- 28.8k stars (read 2026-11-22); the README opens "Vibe Kanban is sunsetting." — [GitHub](https://github.com/BloopAI/vibe-kanban)
- Bloop announced the shutdown on 2026-04-10; stated reason: most users were on the free tier and the team could not find a business model. Hosted services (issues, comments, projects, organisations) ended after 30 days; since v0.1.44 (2026-04-24) opening a project shows "Project functionality has been retired", while local workspaces still run and the code stays Apache-2.0. — [Shutdown post](https://vibekanban.com/blog/shutdown); [Nimbalyst analysis](https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/)
- Model: "each workspace gives an agent a branch, a terminal, and a dev server"; review is in-app: "Review diffs and leave inline comments" and "send feedback directly to the agent without leaving the UI"; built-in preview browser; PR creation with generated descriptions. — [GitHub](https://github.com/BloopAI/vibe-kanban)
- Classic flow per a third-party guide: To do, In Progress, In Review, Done, where In Review means the agent finished and awaits the human. — [skills.sh guide](https://skills.sh/itechmeat/llm-code/vibekanban)
- Supported Claude Code, Codex, Gemini CLI, GitHub Copilot, Amp, Cursor, OpenCode, Droid, CCR and Qwen Code. — [GitHub](https://github.com/BloopAI/vibe-kanban)

Linear
- Linear derives agent-session lifecycle from the most recent activity the agent posts, instead of requiring the agent to set status. — [Linear developer docs](https://linear.app/developers/agent-interaction)
- Linear's guidance: when an agent starts on a delegated issue that is not already started, completed or cancelled, it should move the issue to the first "started" status. — [Linear agent best practices](https://linear.app/developers/agent-best-practices)
- Linear shipped "Coding sessions" on 2026-06-11. — [Linear changelog](https://linear.app/changelog/2026-06-11-coding-sessions)
- Status sync can fail: a community thread reports Linear showing "Agent did not start" although the agent ran (anecdote). — [OpenAI community thread](https://community.openai.com/t/linear-agent-did-not-start/1400787)

Convergence
- Pixel Agents' roadmap includes "agents picking up tasks from a board", so the office genre is itself heading toward a board. — [Pixel Agents](https://github.com/pablodelucca/pixel-agents)

### Inferences
- Card granularity in both dedicated tools is the task (with one worktree and one or more agent runs behind it), not the raw session. A session manager adding a board has to decide whether a card is a session or a task that can own several sessions; the tools that started from the board chose task.
- Lifecycle-driven moves are automatic (start, blocked, finished); judgment moves are manual (commit, PR, trash/done). No tool auto-moves a card to Done without a human or an explicit auto-commit setting.
- Cline's merged Review column treats "anything waiting on the human" as one queue, which matches the practitioner view that the human is the serial resource. The cost is that a ten-second permission click and a thirty-minute code review look alike; distinguishing them inside the column (badge, sort order, or a split "Needs input" lane) is an obvious refinement. This is my inference, not a reported user complaint.
- Vibe Kanban's end is evidence about business viability, not about the pattern: it had the largest star count in this whole survey and thousands of daily users, and the UI model was picked up by Cline.
- The office and the board want the same state machine. Mapping: backlog = not in office; in progress = at desk; needs input / review = at the user's desk; done = left the building.

### Gaps
- GitHub Projects with Copilot coding agent, Agent HQ / "mission control" task states were not researched (the search returned nothing on them).
- Cline's official docs do not name the columns or describe how state is detected; column behaviour rests on one third-party walkthrough. The `autoReviewEnabled` / `autoReviewMode` settings are seen in a config sample but not explained.
- Vibe Kanban's exact auto-move rules were not confirmed from a primary source.
- No data on how many cards users keep in play or on WIP limits in any of these tools.

## 4. Practitioner best practices for parallel coding agents

### Takeaway
Experienced users converge on one message: human review and judgment are the bottleneck, so the right number of agents is what you can review, usually three to five actively supervised, with Boris Cherny's 10 to 15 across local and cloud sessions as the high end. The practices that follow are isolation per agent, a plan or spec up front, agent self-verification, batched review, and throttling intake to review rate.

### Cited Findings

How many agents
- Boris Cherny (creator of Claude Code), as reported by InfoQ on 2026-01-10: five local sessions in terminal tabs plus 5 to 10 on Anthropic's website; "10-20% of those sessions are abandoned". — [InfoQ, 2026-01-10](https://www.infoq.com/news/2026/01/claude-code-creator-workflow)
- Simon Willison, 2025-10-05: gives no number; "I frequently have multiple terminal windows open running different coding agents in different directories." — [Simon Willison, 2025-10-05](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Addy Osmani, 2026-04-07: personal ceiling "somewhere around three to four threads"; relays Willison's remark that running four parallel agents until 11am leaves you wiped out for the day; advises starting with one thread fewer than feels right (all anecdote). — [Addy Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/)
- Osmani, 2026-05-24 (from a Google I/O panel): the reviewable number is "Low single digit"; Richard Seroter: "You can't manage twenty agents successfully in your own brain." — [Addy Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/)
- Armin Ronacher told The Pragmatic Engineer he sometimes kicks off parallel agents but less than he used to, because of his own review capacity. — [The Pragmatic Engineer](https://blog.pragmaticengineer.com/new-trend-programming-by-kicking-off-parallel-ai-agents/)
- Gas Town-style swarms of about 20 concurrent instances are reported as costly (hundreds of dollars in a weekend; anecdote). — [Rutigliano, 2026-01](https://daviderutigliano.github.io/portfolio-website/posts/2026/01/gas-town-the-industrial-revolution-of-vibe-coding/)

The bottleneck
- Willison: "the natural bottleneck on all of this is how fast I can review the results" and "I can only focus on reviewing and landing one significant change at a time." — [Simon Willison, 2025-10-05](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Ronacher, 2026-02-13: "the pull request review clearly turns into the bottleneck"; "if input grows faster than throughput, you have an accumulating failure"; "backpressure and load shedding are the only things that retain a system that can still operate"; counted example: OpenClaw had "north of 2,500 pull requests open". — [Armin Ronacher, 2026-02-13](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/)
- Ronacher on accountability: "Non-sentient machines will never be able to carry responsibility", so he stays the bottleneck while he is accountable. — [Armin Ronacher, 2026-02-13](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/)
- Osmani: "What scales is your throughput of supervision, not your throughput of understanding"; applies Amdahl's Law with human judgment as the serial part; five agents are "five cold context reloads". — [Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/); [Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/)
- Mergify (June 2026) reports the same shift from writing to reviewing. — [Mergify](https://mergify.com/blog/how-agents-work-with-parallel-agents)

How they work
- Isolation: Cherny's local sessions each use their own git checkout (InfoQ says checkouts, other secondary sources say worktrees; the sources conflict). Willison had not adopted worktrees as of October 2025 and used fresh checkouts, often in `/tmp`. — [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow); [Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Plan first: Cherny: "If my goal is to write a Pull Request, I will use Plan mode, and go back and forth with Claude until I like its plan", then auto-accept edits. Willison: code that started from your own detailed spec is much less effort to review. — [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow); [Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Self-verification: Cherny calls giving the agent a feedback loop the most important tip, claiming it improves results "by a factor of 2–3" (his estimate, not a measurement); "Claude tests every single change I land to claude.ai/code using the Claude Chrome extension." Osmani: let the machine verify the "boring 80%". — [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow); [Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/)
- Permissions: Cherny almost never uses `--dangerously-skip-permissions`; he pre-approves safe commands via `/permissions`. Willison often runs in YOLO mode for tasks he trusts, and uses cloud agents for riskier ones. — [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow); [Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Task selection for parallel work (Willison): research and proofs of concept, understanding existing code, small maintenance, and carefully specified work; "Send out a scout" (a throwaway run to learn what a hard task touches). — [Simon Willison, 2025-10-05](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- Review practice (Osmani): batch reviews instead of checking one at a time; time-box sessions (his example: two hours, three threads, about thirty minutes of review each); shrink task scope before cutting agent count; keep judgment-heavy work serial and protect best hours for it; treat falling review confidence as the capacity signal. — [Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/); [Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/)
- Shared memory: Cherny's team keeps a `CLAUDE.md` in git (about "2.5k tokens") recording mistakes and practices; a PostToolUse hook runs the formatter. — [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow)
- Fresh-context review: Claude Code guidance, as quoted secondhand, says "a fresh context improves code review since Claude won't be biased toward code it just wrote." — [daily.dev roundup](https://daily.dev/agentic-ai-hub/orchestration-patterns/)
- Ronacher's AI Engineer Europe 2026 talk recommends explicit boundaries, mechanical checks and focused human review. — [AI Engineer](https://www.ai.engineer/talks/_Zcw_sVF6hU-friction-is-your-judgment)

How they get notified
- Cherny is reported (secondary LinkedIn summaries of his thread) to number his terminal tabs and rely on system notifications to know when a session needs input. — [LinkedIn summary](https://se.linkedin.com/in/zsolthalo)

Tooling wishes
- Explicit wishes are rare. Osmani dismisses spawn-20-agents features as "just a UI feature". Ronacher wants a visible queue, comparing the current state to a crowded Starbucks with no clear line or wait estimate. AgentCraft's author proposes "review kits" with screenshots or recordings to cut review effort. — [Osmani, 2026-05-24](https://addyosmani.com/blog/orchestration-tax/); [Ronacher](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/); [Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)

### Inferences
- The design target is 3 to 15 concurrent sessions per person, with 3 to 5 demanding attention at once. A UI optimised for dozens of simultaneously active characters solves a problem few people have.
- What practitioners describe wanting is a review queue with backpressure: how many items wait on me, how old is the oldest, and a nudge not to start more when the queue is deep. A WIP limit on the Review column or a visible line of agents waiting at the user's desk expresses this directly.
- Batch review argues against interrupting the user at every finish. "Needs permission" (cheap, blocks the agent) and "finished, awaiting review" (expensive, blocks nothing) deserve different urgency.
- Cherny's 10 to 20% abandonment rate means discard should be a first-class, cheap action (Cline's Trash column does this).
- All quantitative claims here are self-reports. The 2-to-3x verification gain, the 3-to-4 thread ceiling and the wiped-out-by-11am remark should be presented as anecdote.

### Gaps
- Not found or not searched in this pass: Geoffrey Huntley, OpenAI Codex team posts, Microsoft engineering blogs, and Anthropic's own best-practices page (seen only in secondhand quotation). Google is represented only through Osmani's personal blog and an I/O panel.
- Cherny's original X thread was not opened; session counts vary across secondary sources (about 10 versus 15+), and his notification setup rests on LinkedIn summaries (unverified).
- Yegge's own posts on Gas Town and its 1.0 were not read directly.
- No measured study of agents-per-person versus shipped output was found.

## 5. Notification channels and pain points

### Takeaway
People wire Claude Code's `Notification`, `PermissionRequest` and `Stop` hooks to sounds, desktop notifications, and phone push through ntfy or Pushover, and some approve permissions from the phone. The dominant complaint is the silent permission prompt that leaves an agent idle for minutes; hook behaviour differs across hosts, so home-made setups are fragile.

### Cited Findings
- Official mechanism: a `Notification` hook fires when Claude is waiting for input or permission, and a `permission_prompt` matcher narrows it to approvals; examples use `osascript` on macOS and `notify-send` on Linux. The docs note that `permission_prompt` timing differs between a terminal and hosts such as Claude Desktop or the VS Code extension. — [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- A `PermissionRequest` hook can answer on the user's behalf by returning "allow". — [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- Phone approval: community tools push to an ntfy topic with Approve / Always Approve / Deny buttons; on failure or timeout the hook returns `{"behavior":"ask"}` so the terminal prompt still appears. — [claude-remote-approver](https://github.com/yuuichieguchi/claude-remote-approver); [claude-push](https://github.com/coa00/claude-push)
- ntfy is popular because it needs no account and one `curl`; Pushover is the other common choice, with a one-time paid licence after a trial (as of September 2025). — [dev.to write-up](https://dev.to/coa00/how-i-built-a-mobile-approval-system-for-claude-code-so-i-can-finally-leave-my-desk-1ida); [Zenn article](https://zenn.dev/kawarimidoll/articles/7b93cd481de996)
- Sound cues: one developer plays the macOS Glass sound on `PermissionRequest` and Ping on `Stop` via `afplay`, so the two events are told apart by ear; overhead "maybe 50ms" (2026-05-13). — [dev.to, 2026-05-13](https://dev.to/zubrock/stop-missing-claude-code-permission-prompts-add-sound-notifications-in-10-seconds-1b7a)
- Pain point (anecdote): "I kept losing 5-10 minutes every time because I'd miss a permission prompt"; the author cites a GitHub issue with "hundreds of people complaining about the same thing" (issue not verified). — [dev.to, 2026-05-13](https://dev.to/zubrock/stop-missing-claude-code-permission-prompts-add-sound-notifications-in-10-seconds-1b7a)
- Reliability complaints from the same author: the `Notification` hook with `permission_prompt` "doesn't fire reliably in Claude Desktop"; `terminal_bell` works only in a terminal; wrapper scripts are "too fragile, breaks on updates". — [dev.to, 2026-05-13](https://dev.to/zubrock/stop-missing-claude-code-permission-prompts-add-sound-notifications-in-10-seconds-1b7a)
- Unnoticed completion is the mirror problem: "realizing an hour later that a task had already finished long ago". — [azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban)
- In-app equivalents: Pixel Agents (bubbles plus optional chimes), Vibecraft (pulsing zones, per-event synthesized sound, spatial audio), AgentCraft (Telegram integration and mobile clients, per secondary summary). — [Pixel Agents](https://github.com/pablodelucca/pixel-agents); [Vibecraft](https://github.com/Nearcyan/vibecraft); [Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft)
- Context-switch cost of checking is a stated concern even without notifications: the "ambient anxiety tax" and repeated cold context reloads. — [Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/)

### Inferences
- Two event classes need different treatment: permission/question (urgent, agent is stalled, answer takes seconds) and finished (not urgent, batchable). Distinct sounds per class, as in the Glass/Ping setup, is the cheapest proven differentiation.
- A session manager that already receives `PermissionRequest` and `Stop` events can offer notification as a built-in feature and remove the fragile per-user hook scripts people complain about.
- Because host differences make the `Notification` hook unreliable, `PermissionRequest` and `Stop` are the safer signals to build on; Pixel Agents' hooks mode uses exactly these.
- Remote approval from a phone is in demand, but it widens the security surface; fall back to the local prompt on any failure, as the community tools do.

### Gaps
- "Notification fatigue" as a named complaint was not found in a primary source; the documented pain is missed prompts, and fatigue is inferred from the cognitive-load essays.
- No data on which channel is most used. Slack as an attention channel was not confirmed by any source read.
- The GitHub issue said to have hundreds of complaints about missed permission prompts was not located or verified.
- Terminal-level features (iTerm2 or Ghostty notification settings, tmux bell monitoring) were not researched.
