# User pain points of running multiple AI coding agent sessions in parallel (state as of 2026-11-23)

Purpose: decide what session-board builds next by the size of the pain, using first-hand user voices rather than vendor claims.

## Method and limits (read first)

- Collected 2026-11-23. All GitHub reaction counts ("+N" = thumbs-up on the issue body, "Nc" = comment count) are as returned by the GitHub search API on 2026-11-23. Issue dates are creation dates.
- GitHub: I could read issue **titles, bodies, reaction and comment counts** through the search API. I could **not** open comment threads (the per-repo API and HTML pages returned 403 in this environment), so no quote below comes from an issue comment; every GitHub quote is from the issue body or title. Where I only saw the title, I say "title only".
- Repos covered: `anthropics/claude-code` (CC), `openai/codex`, `pingdotgg/t3code`, `stablyai/orca`, `slopus/happy`, `getpaseo/paseo`, `herdrdev/herdr`, `smtg-ai/claude-squad`, `BloopAI/vibe-kanban`. `superset-sh/superset` could not be resolved by the search API (422) — not covered.
- Hacker News: Algolia search API, stories and comments dated 2026-01-01 onward. HN quotes carry comment id, author, date.
- Practitioner posts opened and read: Addy Osmani (3 posts), Mitchell Hashimoto (3), Simon Willison (1), Armin Ronacher (2, little relevant content), Manuel Schipper (1), Sergey Kuhne (1). Not read: Steve Yegge, Geoffrey Huntley, Peter Steinberger (his index shows no 2026 post on this topic).
- Reddit: blocked (HTTP 403 on old.reddit.com `.json`); nothing from Reddit is included.
- Bias to keep in mind: GitHub reactions measure what people bother to file against one vendor, and issue trackers of launcher apps over-represent "support my agent/OS" requests. Many HN "Show HN" authors describe their own pain as the motivation for a tool; that is first-hand but self-selected. Reaction counts across repos are not comparable in absolute terms (CC has far more traffic than herdr).
- Quotes are verbatim, at most 25 words, typos kept.

---

## A. Ranked pain list

Ranking = my judgment of (how many independent voices) x (how strongly they put it) x (how specific it is to running several sessions at once). Pains that hit every user of one agent (for example plain quota complaints) are ranked by their multi-session part.

### 1. Human review is the bottleneck: agents produce in parallel, I review one at a time

- Evidence
  - Addy Osmani, "The Orchestration Tax", 2026-05-24: "The constraint is the review step and the throughput of your system equals exactly the throughput of that step." https://addyosmani.com/blog/orchestration-tax/
  - Addy Osmani, "Your parallel Agent limit", 2026-04-07: "by noon you’re not reviewing anything carefully anymore - you’re just accepting output." https://addyosmani.com/blog/cognitive-parallel-agents/
  - HN 48246797, cold_harbor, 2026-05-23: "agents parallelize, humans review sequentially — 8 parallel cards means 8x the diffs to read". https://news.ycombinator.com/item?id=48246797
  - HN 50418490, acheron9383, 2026-11-08: "Code review remains the bottleneck."
  - HN 48248881, jappgar, 2026-05-23: "20 minutes planning, 20 minutes coding, 200 minutes review and refactor".
  - Simon Willison, 2026-05-06: "I’m not reviewing every line of code that they write anymore, even for my production level stuff." https://simonwillison.net/2026/May/6/vibe-coding-and-agentic-engineering/ (HN thread 787 points, 885 comments)
  - CC #33932 (+227, 52c, open, 2026-03-13), VS Code diff review UI: "I have to leave the Claude Code panel and manually check the Source Control panel or run `git diff`". https://github.com/anthropics/claude-code/issues/33932
  - codex #2998 (+244, 70c, open, 2025-08-31) "IDE-integrated diff / approval" (title only).
  - orca #4540 (+7, open, 2026-06-03): "you re-review files you already cleared and lose your place in large changesets". https://github.com/stablyai/orca/issues/4540
  - SECONDARY: Addy Osmani "Agentic Code Review" (2026-06-15) cites third-party telemetry (review duration up, PRs merged with zero review up); I did not open the underlying reports. SECONDARY: Ars Technica 2026-10-10 headline on HN, "gains 'absorbed' by human review 'bottleneck'" (title only).
- Spread and intensity: the most consistent theme across practitioner posts and HN in 2026; stated as *the* limit on useful parallelism, not as an annoyance. Very high.
- Existing tools: T3 Code, Orca, Paseo, Conductor-style apps give a diff panel and inline comments back to the agent (t3code #79, paseo #499, both closed as done); Orca users still ask for "viewed" marks and submitting PR reviews (#9512 +21). Agent-run review (Copilot review, `/review`) reduces reading but users say it does not remove the human pass. Nobody is praised for solving it.

### 2. A blocked session sits unnoticed; I cannot tell which session needs me

- Evidence
  - HN 50490448, sirallap-agentg, 2026-11-13: "what kills me is the one stuck on a permission prompt while i'm looking at another one".
  - HN 47302693, binwen, 2026-03-08 (author of oly): "come back to find it's been stuck on a y/n prompt for 20 minutes. All that work, frozen."
  - HN 50343932, lcx, 2026-11-02 (author of Repobs): "I kept forgetting which agent was working on which branch/worktree, which sessions were waiting for me, and which changes I still needed to review".
  - Manuel Schipper, 2026-02-26: "With 6+ agents running, there’s always something waiting for me". https://schipper.ai/posts/parallel-coding-agents/ (HN 189 points, 131 comments)
  - CC #13922 (+43, open, 2025-12-13): "we often don't realize Claude is waiting for our input until we manually check back much later". https://github.com/anthropics/claude-code/issues/13922
  - CC #57230 (+57, open, 2026-05-08), VS Code: "Both are easy to miss when focus is on another window or monitor."
  - CC #13024 (+81, closed, 2025-12-04) hook for waiting on user input; codex #3962 (+203, 61c, open, 2025-09-20): "It’s frustrating that I have to sit and stare at the screen just to know when it’s done."
  - t3code #780 (+64, closed, 2026-03-10): "if a task finishes in a chat while the user is in another app, they get no signal."
  - codex #22321 (+50, closed, 2026-05-12), Agent View request: "This becomes hard when agents are running in different worktrees, waiting for user input, or finishing at different times."
  - herdr #318 (+9, closed, 2026-05-27): "A blocked agent at the bottom of the list stays at the bottom until scanned for."
  - Mitchell Hashimoto, 2026-10-06, names the product category: "a single view across every running agent showing which are working, which are done, and which are waiting on you." https://mitchellh.com/writing/program-status-osc7501
- Spread and intensity: very high; it is the stated reason behind most "Show HN" dashboards of 2026 (Myrlin, Repobs, Aq, oly, CCBot, claude-code-dashboard). High frequency per day per user.
- Existing tools: every launcher app now has status badges and desktop notifications; herdr added priority sort; first-party Agent View exists in both CLIs. Still-open complaints are about wrong status and noise (see pain 9), not absence.

### 3. Context switching wears me out and I lose track of what each session is doing

- Evidence
  - Addy Osmani, 2026-04-07: "It creeps up until you realize you’re exhausted by noon and can’t tell which thread got away from you."
  - Addy Osmani, 2026-05-24: "Everytime you check on an agent you been away from you pay a context switch cost."
  - Manuel Schipper, 2026-02-26: "Past that, I lose track of what each one is doing and design decisions suffer."
  - Sergey Kuhne, "How I'm fighting the AI Brain Fry", 2026-11-08 (HN 317 points): "you don't know anymore what you were doing, where you started, and where you were supposed to finish." https://sergeykuhne.com/blog/fighting-ai-brain-fry
  - HN 50417584, silcoon, 2026-11-08: "it's impossible to focus deeply on one task if your thought process is constantly interrupted every few minutes."
  - HN 50422154, kimseungyong, 2026-11-09: "Once I started handling more than three tasks simultaneously, I felt that context switching consumed more energy".
  - HN 47904427, stefanhoelzl, 2026-04-25: "Just launching multiple AI instances does not scale because you loose the overview an context of each task."
  - HN 46991930, therealarthur, 2026-02-12: "I run 8-12 Claude Code sessions at a time and was drowning in terminal windows."
  - SECONDARY (Addy Osmani reporting Simon Willison on a podcast): "fire up four agents in parallel, work until 11am, and you’re wiped out for the day."
- Spread and intensity: very high among heavy users; several say their personal ceiling is 2 to 4 sessions. Note the counter-voice: part of HN says the fix is fewer sessions, not better tooling (see D).
- Existing tools: none addresses re-entry cost well. Kuhne's own answer is a script that "hands me a prioritised list of exactly the items waiting on my judgement" — the same idea as an attention queue. Thread titles and auto-summaries exist in T3 Code and Codex app; CC #25045 (+138) and #2112 (+170) show how much people wanted even plain session names.

### 4. Usage limits: parallel sessions drain quota, I cannot see it coming, and work dies at the limit

- Evidence
  - CC #16157 (+697, 1499c, open, 2026-01-03) and #38335 (+476, 878c, open, 2026-03-24): limits hit far faster than expected. codex #28879 (+364, 211c, closed, 2026-06-18), #14593 (+284, 630c).
  - HN 47224276, gck1, 2026-03-02: "with $200 subscription, I usually hit weekly quota by around day 3-4".
  - HN 47222550, 0x457, 2026-03-02: "if you run 2 agents with Opus in parallel you're going hit limits".
  - Auto-resume at reset: CC #13354 (+212, closed, 2025-12-08), CC #35744 (+103, closed, 2026-03-18), codex #21073 (+94, open, 2026-05-04): "the task just dies and waits for me to wake up, find the session, and re-issue the prompt"; codex #28931 (+86, open).
  - Visibility inside third-party tools: t3code #228 (+37), #5539 (+19, 2026-08-06): "I cannot easily see how much usage I have left without leaving T3 Code".
  - orca #20512 (+12, 23c, open, 2026-09-13): "on a fleet of parallel agents that happens several times a day."
  - Cost of wrappers: CC #97074 (+179, 77c, open, 2026-09-25): headless `claude -p` "uses about 1.8× more of the 5-hour window" than the TUI for the same work. t3code #7338 (+21, 81c, 2026-08-17): "Usage is ~3x-5x higher than the native Claude app".
- Spread and intensity: the largest raw numbers in both vendor trackers. Only part is multi-session specific (which session burns it, what happens to the fleet at the limit), but that part is sharp.
- Existing tools: both CLIs show 5h/weekly windows in a status line; T3 Code and Orca added usage panes; Orca users ask for account failover; small tools exist for auto-recover at reset (HN 48924870, 2026-07-15). No tool shows burn per session against the shared window well.

### 5. Permission prompts: too many, and allow-rules do not match what I allowed

- Evidence
  - CC #30519 (+80, 32c, open, 2026-03-03): "I still get prompted constantly for commands that should match." (author states 136 allow rules).
  - CC #28240 (+209, open, 2026-02-24) prompt fires on `cd` in compound commands; CC #16561 (+176, closed) parse compound commands; CC #11380 (+64, 82c) keeps asking after "always allow"; CC #30213 (+60, open) compound `cd && git` in worktrees.
  - codex #2860 (+109, 77c), #3085 (+107), #13476 (+39, open, 2026-03-04) excessive prompts; codex #10760 (+71, 59c, 2026-02-05): approval "got stuck" after "tabbing out to another agent".
  - happy #302 (+13, 2025-12-27): "I can neither approve nor decline it, which makes the entire session get stuck"; happy #727 (+9).
- Spread and intensity: high and long-running; multiplied by the number of sessions. The escape most people take is skip-permissions/auto mode, which leads to pain 13.
- Existing tools: auto mode / "Approve for me" in the CLIs reduce prompts; third-party remote approvers (Happy, Remote Control) are themselves a source of stuck approvals.

### 6. Questions time out and the agent answers for me while I am looking at another session

- Evidence
  - CC #73125 (+388, 144c, closed, 2026-07-02): "Suddenly Claude is told to \"proceed with best judgment\"? What?!" https://github.com/anthropics/claude-code/issues/73125
  - codex #28969 (+222, 99c, open, 2026-06-18): "Codex will automatically accept the recommended answer to a question within 60 seconds." https://github.com/openai/codex/issues/28969
- Spread and intensity: two issues, but both very high for their age, in both vendors, and directly caused by the user being away — which is the normal state when running several sessions. CC's is closed (I could not read how it was resolved); Codex's is open.
- Existing tools: none found that surfaces "this question expires in N seconds" or flags answers that were auto-chosen.

### 7. Away from the desk: remote and phone control is wanted and unreliable

- Evidence
  - codex #10450 (+695, closed) remote development; codex #9224 (+411, closed) remote control; CC #29006 (+123, closed).
  - CC #34255 (+112, 74c, open, 2026-03-14): Remote Control "silently drops the connection to the Claude iOS app (Code tab) during long sessions". CC #32982 (+88, open) sessions die after ~20 min idle.
  - CC #29438 (+59, closed, 2026-02-27): "You have to keep the app open and actively watch the session to notice when it's blocked on a permission prompt." CC #28765 (+44). codex #32908 (+20, open, 2026-07-14) push not delivered on iOS.
  - orca #8129 (+8, closed, 2026-07-10): "Mobile notifications are silently lost whenever the app is backgrounded — which is exactly when you need them most." orca #9871 (+4, open) asks for ntfy/Bark/Telegram/webhook.
  - happy #1866 (+13, 2026-10-05), hosted relay outage: "The mobile app can't reach any session, and the CLI daemon can't reconnect."
  - HN 47151158, alexei_led, 2026-02-25: "Permission prompts pile up. You miss when the agent finishes or gets stuck."
- Spread and intensity: high demand; the live complaints in late 2026 are reliability (drops, lost pushes, relay outages), not absence.
- Existing tools: first-party Remote Control (both vendors), Happy, Orca mobile, Paseo relay, many Telegram bots. All have open reliability issues.

### 8. Worktrees and per-session environments cost setup, ports, and disk

- Evidence
  - claude-squad #260 (+8, open, 2026-03-05): "two sessions both try port 3000, one crashes".
  - HN 48355104, zjy71055, 2026-06-01: "still leaves you reinstalling node_modules per tree and fighting over a dev server port. That's the actual cost".
  - HN 50135380, glenngillen, 2026-10-17: "I just had to limit the number of concurrent features I was working on". HN 49110131, bryanlarsen, 2026-07-30: "each worktree can easily contain 200GiB of build artifacts".
  - Location/base branch: CC #23622 (+89, open), CC #27282 (+74, open), codex #10599 (+78, open), herdr #261 (+24), claude-squad #86 (+10). Cleanup: vibe-kanban #765 (+8, 14c, open).
  - Forced worktrees unwanted: CC #21236 (+110, closed, 2026-01-27), CC #12513 (+79), orca #13846 (+14, open, 2026-08-11): "They want to keep working in a single worktree/folder and open multiple terminals inside it".
- Spread and intensity: medium-high; a recurring reason people cap concurrency or avoid same-repo parallelism altogether.
- Existing tools: launchers create worktrees; emdash and private scripts allocate ports (HN 48248579, 48246985); copy-on-write worktree projects appeared (Rift, Riftri). Dependency install and disk remain open.

### 9. Status and notifications are wrong or noisy, so I stop trusting them

- Evidence
  - orca #4375 (+7, open, 2026-06-01): "Getting notifications on non-terminal turn ends, causing too much noise and having to disable to feature."
  - orca #13600 (+9, 2026-08-10): attention notification fires "even when “Approve for me” automatically approves the request".
  - orca #6100 (+4, open): notified when the main agent stopped "but subagents or workflows are still running".
  - t3code #19926 (+8, 2026-10-15): "the thread looks finished or stale while work is still happening" (background task). t3code #36230 (+10, 2026-11-13): a PR waiting on a teammate is shown as the user's move.
  - codex #28833 (+13, open, 2026-06-18): asks hooks to expose whether a `PermissionRequest` "actually requires user attention".
  - codex #48500 (+28, 22c, open, 2026-09-26): since 0.157 the shared daemon runs hooks with the first client's `TMUX_PANE`, "misattributing hook events to the wrong terminal pane". herdr #4649 (+8, open) is the same breakage seen from a third-party tool.
  - herdr #803 (+15, 20c, open): agents started through a nix wrapper never appear.
  - Mitchell Hashimoto, 2026-02-05: "Very important at this stage: turn off agent desktop notifications." https://mitchellh.com/writing/my-ai-adoption-journey
- Spread and intensity: medium counts, but it attacks the value of pain 2's solutions: one false alarm class and users switch notifications off.
- Existing tools: each fixes cases one by one (Orca's quiet window, T3's "Waiting" status). Mitchell Hashimoto's OSC 7501 proposal (2026-10-06) is an attempt to make status first-class rather than guessed.

### 10. Sessions I started elsewhere do not show up in the tool

- Evidence
  - herdr #1170 (+17, closed, 2026-07-08): "The main reason I installed Herdr was to watch every agent in one screen. Agents I run over ssh don't appear in the sidebar".
  - t3code #330 (+25, 17c), #207 (+22), #2206 (+12), #10961 (+8, 19c, 2026-09-09, "externally started sessions can never be imported").
  - paseo #237 (+10, 2026-04-10): "import existing sessions from the CLI tools so we can resume work on the go".
  - HN 46867942, easeout, 2026-02-03, on the Codex app: forcing everything "into one window that can only display a single session at a time" is "The Wrong Abstraction".
- Spread and intensity: medium; a structural weakness of every tool that owns the agent process. People keep using the terminal and want the board to follow.
- Existing tools: launchers offer one-off import of transcripts; none passively follows live external sessions except terminal multiplexers (herdr, cmux) that see only their own panes.

### 11. Finding, naming, and resuming sessions; history split across directories

- Evidence
  - CC #2112 (+170, closed) session names; CC #25045 (+138, open, 2026-02-11) rename from skills; CC #26904 (+115, open) delete; codex #4163 (+96) named sessions; codex #2080 (+107); codex #12564 (+115) rename threads.
  - CC #5768 (+62, open, 2025-08-14) and #28745 (+80, closed): resume only works from the starting directory. CC #34437 (+50, open, 2026-03-14), worktrees: "This splits conversation history, auto-memory, and project-level settings across multiple isolated directories".
  - CC #26123 (+60) `/resume` broken; CC #63147 (+49, 62c, open) resume fails permanently on thinking-block error; codex #37403 (+54, 68c, open, 2026-08-07) "already has an active writer".
  - HN 46991930, therealarthur, 2026-02-12: "if my terminal crashes I lose track of everything".
- Spread and intensity: medium-high, steady since 2025; worse with worktrees because each one is a separate project directory.
- Existing tools: both CLIs added names and pickers; resume bugs recur with each release.

### 12. Merging parallel work: conflicts and integration overhead

- Evidence
  - Manuel Schipper, 2026-02-26: "fighting a merge conflict in a codebase I barely recognize".
  - HN 47905117, gndp, 2026-04-25: "I ended up having a lot of overhead in merging and testing the features."
  - Addy Osmani, 2026-05-24: resolving merge conflicts is serial work that "has to acquire the lock".
  - HN 47253997, laalshaitaan, 2026-03-04: "parallel agents have no coordination primitives before edits happen."
  - Show HN "Foremerge – Catch intent conflicts between parallel coding agents", 2026-09-21, 45 points (title only).
  - No high-reaction issue in any tracker I searched (title search for "conflict" in CC returned only keybinding conflicts).
- Spread and intensity: medium. Practitioners mostly avoid it by splitting work so sessions do not overlap; it shows up as a reason not to parallelise rather than as a feature request.
- Existing tools: Conductor/T3-style apps help with rebase onto main; a few research-grade tools (Weave, Foremerge). Weakly served.

### 13. Fear of unsupervised destructive actions once prompts are relaxed

- Evidence
  - codex #59060 (+548, 440c, closed, 2026-11-03): title "Told to reboot a server, it destroyed systemd, destroyed containers, ran random scripts, cost me $10,000+".
  - CC #87971 (+103, open, 2026-08-19): "Claude abuses bash tools for reads, writes, and edits when running in Auto Mode" (title only).
  - codex #39973 (+41, open, 2026-08-21): retiring `approval_policy="untrusted"` "weakens the execution-approval boundary" (title).
  - CC #73125 author: `AskUserQuestion` is "an explicit safety check".
- Spread and intensity: spiky but intense; it is the other side of pain 5. Users want fewer prompts and a firm stop on drastic commands.
- Existing tools: auto-mode classifiers, sandboxes (orca #13665 +30 asks for Docker sandboxes). Trust is low after incidents.

### 14. Context lost after compaction; earlier conversation unreachable

- Evidence: CC #27242 (+92, open, 2026-02-20): "The full data is always preserved in `transcript.jsonl`, but the TUI provides zero functional paths to access it." CC #17428 (+92, open); CC #7502 (+39, open); paseo #439 (+5).
- Spread and intensity: medium; per-session rather than multi-session, but it compounds pain 3 (re-entry after hours away).
- Existing tools: none in the CLIs; some transcript viewers.

### 15. Work spanning several repositories

- Evidence: orca #1099 (+67, 30c, open, 2026-04-26); orca #21118 (+35, open); CC #23627 (+90, open); codex #26338 (+49, open), #27943 (+44); claude-squad #56, #89; vibe-kanban #705. HN 50462338, nicknaddaf, 2026-11-12: "I get confused and frustrated when working on several repos at the same time."
- Spread and intensity: medium; top-voted request in Orca.
- Existing tools: T3 Code shipped multi-repo projects (HN 2026-11-21, title only); others partial.

### 16. Background tasks and subagents are opaque

- Evidence: codex #28058 (+141, 45c, open, 2026-06-13): encrypted multi-agent messages "remove readable task audit trail". CC #21167 (+14, open): ESC "kills **all** running background tasks and subagents at once". CC #23983 (+14, open): PermissionRequest hooks not triggered for subagent requests in Agent Teams (title). t3code #19926, orca #6100 (see pain 9).
- Spread and intensity: medium and growing as both CLIs push subagents.
- Existing tools: T3 Code nests subagents as threads (#538, closed); limited elsewhere.

### 17. Several accounts: switching and failover on limit

- Evidence: CC #18435 (+1092, 250c, open, 2026-01-15, desktop app account switching); codex #4432 (+134, open); orca #9496 (+22), #11557 (+27), #20512 (+12).
- Spread and intensity: large numbers, but mostly about one person holding work and personal accounts; the parallel-fleet angle is orca #20512.
- Existing tools: Orca has an account switcher; third-party profile managers.

---

## B. Gap analysis against session-board

Architecture reminder: session-board observes through lifecycle hooks and transcript files; it does not launch or own agent processes.

| # | Pain | Status | Reasoning |
|---|------|--------|-----------|
| 1 | Review bottleneck | PARTLY | We have per-session diff, PR state, accepted step, task grouping. That shows *what* to review; it does not make review faster. Missing: per-file viewed marks, "changed since I last looked", evidence that tests ran, comment-on-line back to the session. Our diff lists files touched by edit tools, so changes made through Bash (formatters, codegen, `git mv`) are probably missed — a reviewer who finds one such gap stops trusting the view. |
| 2 | Blocked session unnoticed | SOLVED for Claude Code, unproven for Codex | The single attention queue with fixed ordering, auto-advance and phone push is exactly what these users describe building for themselves. Risk: "Codex side untested", and Codex 0.157+ hook misattribution (codex #48500) would put items on the wrong session. |
| 3 | Context-switch cost, losing track | PARTLY | The queue removes scanning; the triage one-sentence summary helps. It does not answer "what was this session for, what did it do since I last looked, what did I decide". One sentence per item is probably too thin for re-entry after an hour away. We also add nothing that limits or paces interruptions. |
| 4 | Usage limits | PARTLY | We show usage/cost per session from Claude's files. Missing: the shared 5h/weekly window and reset time, burn rate per session against it, a "stopped at limit" queue state, resume at reset. Our own headless resume and triage agent spend quota; CC #97074 reports headless costing about 1.8x per token, so our features can worsen this pain. |
| 5 | Permission friction and rule mismatch | PARTLY (strong) | Approve from board, batch-approve, standing rules with prefix matching and guards go beyond the vendor tools. But rules live in the board, not in the agent's settings, so they only work while the hub is up, and they do not fix the CLI's own matcher. Users may not want a second rule system to maintain. |
| 6 | Question timeouts | NOT ADDRESSED (may be partly helped) | We can answer multiple-choice questions from the board, but nothing shows a deadline, escalates before expiry, or flags an answer the agent chose by itself. Whether the hook round-trip can hold a question past the CLI's 60s timer is unverified. |
| 7 | Remote / phone | PARTLY | ntfy/webhook push plus a web board reachable from a phone covers "know and approve while away" if the user arranges network access. No mobile layout guarantee, no relay, cannot type into non-tmux sessions. Upside: no hosted server to go down (happy #1866) and no app that drops pushes when backgrounded (orca #8129). |
| 8 | Worktree / environment cost | OUT OF SCOPE (read-only part NOT ADDRESSED) | We do not create worktrees or launch agents. A read-only view of worktrees, their size and staleness is possible and not built. |
| 9 | Wrong or noisy status | PARTLY | Hooks give truer state than screen-scraping, and delivery confirmation is a plus. Unknown: do we mark a session finished while its background shell or subagents still run (t3code #19926, orca #6100)? Do we raise an item for a permission request that auto mode resolves itself (orca #13600, codex #28833)? Push has no per-kind policy or quiet hours that I know of. Lost-process detection is a point in our favour. |
| 10 | Externally started sessions invisible | SOLVED (core strength) | This is the design. Limits: only where hooks are installed and can reach the hub; sessions on other machines or in the cloud are not seen (herdr #1170 is exactly this ask). |
| 11 | Find / name / resume | PARTLY | History import, filter, task grouping by prompt or branch, headless resume of exited sessions. Missing: user-set names/labels, full-text search, regrouping the worktree-split history of one repo (CC #34437). Headless resume inherits the CLI's resume bugs. |
| 12 | Merge conflicts | NOT ADDRESSED | Known gap. Detection is feasible passively (we know which files each session edits); resolution is not ours. |
| 13 | Unsupervised destructive actions | PARTLY | Standing-rule guards against chained/drastic commands help for sessions that still ask. Sessions in skip-permissions or auto mode never ask, so we see nothing until after the fact. A hook-side deny list would be needed, and that changes us from observer to enforcer. |
| 14 | Compaction context loss | NOT ADDRESSED | We already read transcript files; a pre-compaction history view is cheap but not built. |
| 15 | Multi-repo work | PARTLY | Per-project roll-ups and rooms exist; tasks group by prompt or branch, not across repos. No cross-repo diff. |
| 16 | Subagent / background opacity | NOT ADDRESSED (unverified) | Depends on which hook events we record (SubagentStop, background task events). CC #23983 says subagent permission requests may not fire hooks at all — outside our control. |
| 17 | Multi-account | OUT OF SCOPE | Account identity belongs to the launcher. We could at most label which account a session used. |

Where our existing feature probably would not satisfy the complaint, in short: the diff (misses non-edit-tool changes, not side-by-side), the triage summary (too thin for re-entry), usage (per session, not against the shared window), push (no policy, so it risks the same "turned it off" outcome as Orca), Codex (untested while Codex hooks are in flux).

---

## C. Top 8 things to build next

Ranked by pain size x feasibility for a hooks-based passive hub.

1. **Review workbench on top of the existing diff** (answers pain 1; Osmani 2026-05-24, HN 48246797, CC #33932 +227, orca #4540).
   Per-file "viewed" marks that reset when the file changes again; "changes since I last looked" per session; diff taken from git (base commit at session start vs. now) so Bash-made changes are included; a short evidence strip per session (which test/lint commands ran and their exit codes, from tool hooks); line comment that is delivered through the existing reply path; review queue sortable by size/risk. Feasible passively.

2. **Re-entry brief per session** (pain 3, 11, 14; Kuhne 2026-11-08, Schipper 2026-02-26, CC #27242 +92, CC #25045 +138).
   One panel: the original ask, user decisions so far, what happened since the user last opened it, what it is waiting on, files touched; user-editable name and labels; search across sessions; a browser of the pre-compaction transcript. Built from transcript files we already import. Keep the summariser optional and cheap (see D on token burn).

3. **Quota awareness for the fleet** (pain 4; CC #16157 +697, #13354 +212, codex #21073 +94, t3code #5539).
   Show the shared 5-hour and weekly windows with reset time, burn rate per session, a forecast ("at this rate the window ends at 15:40"), a distinct "stopped at limit" queue state, and an opt-in "continue at reset" that sends the reply into tmux sessions. Prefer tmux delivery over headless resume because of CC #97074. Feasible for Claude from its files; Codex needs investigation.

4. **Notification policy that defaults to quiet** (pain 2, 9, 7; orca #4375, #13600, #6100, HN 50490448, Hashimoto 2026-02-05).
   Default: push only for blocked sessions; "finished" waits in the list. Per-kind and per-project switches, quiet hours, digest, hold-off window before pushing a permission request so auto-resolved ones never alert, no "finished" while background tasks or subagents are still running. Add ntfy action buttons so approve/deny works from the notification itself.

5. **Deadline-aware questions and an "answered without you" audit item** (pain 6; CC #73125 +388, codex #28969 +222).
   Show a countdown on question items that will time out, push them first, and raise an attention item when a transcript shows the agent proceeded on a timeout or auto-accepted the recommended answer, with the question and the chosen answer. First step is a test: can our hook round-trip keep the question open? Detection from transcripts is feasible either way.

6. **Codex parity, tested** (pain 2, 9, 10; codex #48500 +28, #28833 +13, herdr #4649).
   Verify every queue item kind against current Codex; identify sessions by session id rather than `TMUX_PANE` because of the shared daemon; distinguish user-facing approvals from auto-reviewed ones; document what Codex hooks cannot give us. Without this the "one board for both" claim is unproven.

7. **Sessions from other machines, and a phone-fit board** (pain 7, 10; herdr #1170 +17, CC #34255 +112, orca #8129).
   A documented, scripted way for a remote host's hooks to reach the hub (SSH reverse tunnel or tailnet address, with a token), a host label on each session, and a responsive layout for the queue and approve/answer actions. No hosted relay: the user's own network path is the selling point after happy #1866.

8. **Overlap warning between live sessions** (pain 12; Schipper 2026-02-26, HN 47905117, HN 47253997).
   From edit hooks we know the files each session touches. Warn when two live sessions in the same repo touch the same file, and run a read-only `git merge-tree` between session branches to show "these two will conflict" before both finish. Detection only.

Also feasible passively, lower priority: read-only worktree hygiene (list worktrees with size, age, merged state; pain 8); a deny-list hook for drastic commands that works even in auto mode (pain 13; changes our role, needs a decision); subagent/background rows under a session (pain 16).

**Feasible only for tools that launch agents (not for us without changing architecture):**
- Creating worktrees, installing dependencies, copying `.env`, allocating ports per session (pain 8; claude-squad #260).
- Account switching and failover on limit (pain 17; orca #20512).
- Typing into or queueing messages for sessions outside tmux; steer/queue modes (CC #50246 +215, t3code #231 +77).
- Sandboxing the agent (orca #13665) and guaranteed blocking of destructive commands.
- Holding a question open beyond the CLI's own timeout, if hooks cannot do it.
- Running the same prompt on several models side by side as a managed feature (we can only group them after the fact).
- Resolving merge conflicts or rebasing on the user's behalf.

---

## D. Things users explicitly say they do NOT want

1. **Notification spam / being interrupted on the agent's schedule.** orca #4375 (2026-06-01): "too much noise and having to disable to feature." Mitchell Hashimoto (2026-02-05): "it was my job as a human to be in control of when I interrupt the agent, not the other way around." HN 50490448 (2026-11-13): "i only let the blocked ones notify me, the finished ones just wait in a list". herdr #1827: a notification that "stays and never goes away".
2. **The tool deciding for them.** CC #73125 (+388) and codex #28969 (+222): auto-answering questions after 60 seconds. Lesson for us: the triage agent may suggest, never act.
3. **Forced accounts, forced cloud, data leaving the machine.** vibe-kanban #2952 (+10, 2026-02-27): "the things I develop need a certain degree of security (cannot be transmitted to the Internet)". vibe-kanban #2812 (+10, 2026-02-18): title "Confusing Cloud Migration"; body describes being forced to migrate local projects (truncated in what I could read). happy #1866: hosted relay outage stopped all use.
4. **Telemetry on by default.** t3code #4123 (+15, 2026-07-18): "telemetry appears to have been added and enabled by default without clearly notifying existing users". CC #107757 (+806, 123c, open, 2026-11-05) "Privacy violation in User-Agent header" (title only). CC #66504 (+116, 2026-06-09): session URL added to commits "should be opt-in" (title).
5. **Background daemons and heavy resource use by default.** codex #48195 (+193, open, 2026-09-25): "a persistent, self-updating background daemon shouldn't be the default". orca #10928 (+6): "resource usage keeps increasing". HN story 2026-09-01, 495 points, "The ChatGPT/Codex app bundles a full copy of LibreOffice" (title only). Relevant to us: a hub is a daemon; make it explicit, small, and easy to stop.
6. **Forced worktrees.** CC #21236 (+110), CC #12513 (+79), orca #13846 (+14): users who want to work in their own folder.
7. **Redesigns that remove the view they came for.** vibe-kanban #2687 (+33, 39c, 2026-02-11): "Previous UI was more UX friendly for me"; also #2509, #2730, #2923, and loss of old tasks on upgrade.
8. **Wrappers that burn extra tokens.** t3code #7338 (+21, 81c): usage "~3x-5x higher than the native Claude app". CC #86879 (+121, 2026-08-15): asks to disable the agent_summary spinner because of its token share (title). Our triage agent and headless resume need visible cost and an off switch.
9. **Being tied to one terminal, one window, or one agent.** HN 46867942 (2026-02-03) on single-window design; CC #31901 (+73) Zellij instead of tmux; the most-voted requests in t3code, happy, paseo are support for other agents (OpenCode, Pi, Copilot, Antigravity). Our tmux-only reply path and two-agent scope will draw the same requests.
10. **Abandonment risk.** claude-squad #214 (+16) "No more updates?" and #250 (+11) "Project Seems Abandoned" (titles).
11. **More parallelism as the answer.** HN 50416761, wallstop, 2026-11-08: "The author's problem is that the are doing too many parallel agent things." HN 50423448, alkonaut, 2026-11-09: "I just try to make 1 thing, at most 2, at a time." A board that nudges users to run more sessions works against what these users say helps.
12. **On gimmicks — mixed evidence, stated honestly.** I found no first-hand complaint that playful UI is unwanted. The opposite signal exists: CC #45596 "Bring Back Buddy" (+1199, 288c, open, 2026-04-09; title only). HN 47905171 (2026-04-25) does object to clutter: tmux tools' "text-clutter and workflow learning curve repelled me". So: charm is tolerated or liked, clutter and learning curve are not.

---

## Sources I could not open or did not reach

- GitHub issue comment threads (all repos): 403. Counts and bodies only.
- Reddit (r/ClaudeAI, r/ClaudeCode, r/codex): 403.
- `superset-sh/superset`: not resolvable through search.
- Steve Yegge, Geoffrey Huntley 2026 posts: not read. Peter Steinberger: index checked, no relevant 2026 post seen.
- The third-party telemetry reports cited by Addy Osmani (2026-06-15): not opened; marked SECONDARY above.
