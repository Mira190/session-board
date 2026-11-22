# Academic literature: one human supervising many concurrent AI (coding) agents (as of Nov 2026)

Conventions used in these notes:
- **[E]** = empirical finding (study, log analysis, experiment). **[O]** = opinion / position / design proposal. **[T]** = theory or model.
- "Verified" means I opened the paper or its abstract page in this research session. Items verified only through search-result snippets are flagged "(snippet only)".
- Many 2026 items are un-peer-reviewed arXiv preprints; that is flagged per item.

---

## 1. Human oversight of multiple/parallel LLM coding agents: supervision burden, context switching, review bottleneck, trust

### Takeaway
The first direct studies of parallel agent supervision (2026) show that 2-4 concurrent sessions (3 typical) is the practised norm, that every participant reports a "coordination and monitoring tax", and that the signals developers most reliably miss are exactly the ones that need immediate action (agent questions, errors). A dashboard that makes "needs attention" glanceable raised throughput by 63% and peak concurrency by about one agent, but did not improve perceived control, trust, or ease of verification: awareness of *when* to intervene is separable from the ability to *judge* the work.

### Cited Findings

**ParallelPilot (Long, Shi, Mozannar, Murad, Hosn; Microsoft Research AI Frontiers; arXiv 2609.33113, Sep 2026; preprint, not peer reviewed; verified, full text read)**
- [E] Formative interviews, N=14 developers already running parallel sessions. Self-reported coding time split: 48.6% single-session AI, 45.3% parallel multi-session AI, 6.1% no AI. 13/14 used CLI agents. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Three concurrent sessions was the most common setup (8 of 14); most ran two to four; the lifetime maximum ranged from three to eight; one participant fanned out ~20 cloud sessions for small isolated issues. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Trigger for going parallel is idle waiting on a single agent; parallelism turns waiting into "an active orchestration loop" (a participant running 5-6 sessions: "pretty much always answering questions from the machine or trying to redirect"). — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] All 14 reported a coordination/monitoring tax: forgetting what was told to which session, missing alerts while absorbed in one thread, long logs "overwhelming"; some limit themselves to one screen to keep track. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] PILOT framework of observed practices: **P**lan (decompose, find dependencies), **I**solate (worktrees/branches so sessions do not collide), **L**og (per-task markdown notebooks/journals used as external memory; "I read quite a bit of markdown files... I'm not looking at code"), **O**bserve (makeshift control rooms: 10/14 arranged all sessions so one glance reaches them; 4 gave each agent a full screen and paid a switch cost), **T**riage (decide which session needs attention now). — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Four signals trigger intervention: completion, request for clarification, error/bug, and unexpected delay (e.g. a 2-3 minute deploy running past 10 minutes). Clarification requests and errors need immediate action "yet were also the signals participants most reliably missed"; participants "periodically discovered that an agent had been waiting for a question no one had answered", described as "wasting my agent's time". — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Pre-study survey of the evaluation cohort (N=16): 14 had experienced overlapping/conflicting edits; 14 found session switching mentally taxing; 11 found concurrent sessions hard to track; 11 had missed agent status changes; 15 had difficulty reconstructing agents' decisions; 10 were unsure when to intervene. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Within-subjects evaluation (N=16, six short tickets per condition, tool vs. participants' own setup): tickets completed 5.69 vs 4.19 of 6 (q=0.028); throughput 0.445 vs 0.272 tickets/min (+63%, q=0.007); time on task 13.76 vs 16.33 min; all six tickets completed by 14/16 vs 8/16; peak concurrent agents 3.25 vs 2.31; participants anticipated comfortably supervising 1.44 more agents; 14/16 preferred the tool. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Monitoring ratings (1-7): tracking effort 4.63 to 2.75; disruption when switching sessions 4.50 to 2.69; "noticing when agents finished, stalled, or required input" 3.63 to 6.19; awareness of overall progress 3.44 to 6.06; live dashboard usefulness 6.88/7; planning interface 6.63/7. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Null results that matter: perceived control 3.94 to 4.31 (n.s.), perceived intervention success 3.94 to 4.13 (n.s.); intervention confidence, output trust, and delegation confidence did not improve; on "which condition made output easier to verify" 9 said no difference, 4 the tool, 3 baseline. Coordination vs monitoring time split was unchanged (25%/75% vs 27%/73%). One participant preferred baseline, "scared of giving up control" and "not thinking as hard". — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [O] Authors' design conclusion: abstraction must support "re-engagement", a short path from summarized status to the code, decisions and evidence needed for judgment; abstraction level should be per task (a schema change and a syntax fix warrant different defaults) and legible. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E/implementation detail] Their state model: task cards grouped Done / Running Now / Next; an LLM triage pass over raw logs detects four event types (prolonged inactivity, terminal errors, requests for user input, completion messages); the first three raise a `needs_attention` status with a blinking card and a one-line explanation; a completion message does **not** move the task to Done but prompts the developer to verify first ("separates an agent's reported finish from the developer's acceptance"). Dashboard polls about every 2.5 s. Limitations: short tickets, lab setting, participants mostly beginners at parallel coding. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)

**The Work Behind Delegation (Park, Arvi, Lee, Lim, Ma, Kim; KAIST/CMU; arXiv 2609.24234, Sep 2026; under review; verified, full text read)**
- [E] From observation plus workflow diagrams of 19 experienced developers, Sheridan's five supervisory-control stages (Plan, Teach, Monitor, Intervene, Learn) are reconfigured into seven: **Plan, Monitor, Wait, Review, Teach, Manual Fix, Update Assets**, with loops (Plan self-loop; Monitor/Wait alternate during execution; Review to Teach back to Monitor; Review to Manual Fix back to Review; Update Assets feeds the next Plan). — [arXiv 2609.24234](https://arxiv.org/abs/2609.24234)
- [E] "Wait" is a distinct state that developers explicitly separate from "Monitor": during Wait they plan the next task, do other work, or disengage entirely; developers move between the two at will. "Review" is a new stage absent from Sheridan, and it has a self-loop (work is rarely accepted in one pass). — [arXiv 2609.24234](https://arxiv.org/abs/2609.24234)
- [E] Reddit analysis: 41,757 posts from r/ClaudeCode, r/codex, r/ExperiencedDevs screened to 102 threads / 12,912 comments / 1,114 evidence quotes; Review had the most evidence (366 quotes), then Update Assets (230). Three cross-stage demands: keeping agent work aligned with intent/scope, ensuring quality beyond functional correctness, and maintaining the developer's own understanding of code they did not write. — [arXiv 2609.24234](https://arxiv.org/abs/2609.24234)
- [E] Three coping strategies: concentrate effort in planning (good plans let developers shift from Monitor to Wait and gain "free time to manage other agents"); delegate supervisory work to other agents (one model plans, another critiques, "they loop till agreement"); externalize recurring guidance into reusable assets (instruction files, skills). — [arXiv 2609.24234](https://arxiv.org/abs/2609.24234)

**Why AI Agents Still Need You (Kumar, Bajpai, Gulwani, Soares, Murphy-Hill; Microsoft; arXiv 2506.12347; verified)**
- [E] 19 professional developers, 33 real issues in their own repos, Cursor Agent + Claude 3.5 Sonnet; 55% of non-abandoned issues succeeded. Incremental delegation succeeded 83% vs 38% for one-shot; issues where the developer supplied expert knowledge succeeded 64% vs 29%. — [arXiv 2506.12347](https://arxiv.org/html/2506.12347v3)
- [E] Participants watched the agent live for 84% of prompts (95% when code changed); after code changes they reviewed diffs 67% of the time and explanations 31%. Agent follow-up suggestions appeared in 62% of responses and were answered 7% of the time. — [arXiv 2506.12347](https://arxiv.org/html/2506.12347v3)
- [E] Premature stops: 39% of responses with more than 3 actions vs 9% with 3 or fewer; 61% when unrequested terminal commands appeared vs 21% otherwise. Code changes were rejected only 10% of the time and conversations reset in about 15% of issues, yet accept/reject and reset were rated among the most important features (a need for a *sense* of control). Small-N exploratory study, single-agent, synchronous. — [arXiv 2506.12347](https://arxiv.org/html/2506.12347v3)

**Professional Software Developers Don't Vibe, They Control (Huang, Reyna, Lerner, Xia, Hempel; arXiv 2512.14012, Dec 2025; preprint; abstract verified, details partly via secondary summaries)**
- [E] Field observations plus survey (N=99, 3+ years experience): experienced developers plan before implementing, validate all output, and deliberately give agents only a few tasks at a time; they enjoy agents as long as they stay in control. Authors note selection bias toward AI-positive users. — [arXiv 2512.14012](https://arxiv.org/abs/2512.14012)

**Anthropic, "Measuring AI agent autonomy in practice" (Feb 2026; company research post, privacy-preserving log analysis; verified)**
- [E] Claude Code median turn about 45 s (40-55 s over months); 99.9th percentile turn grew from under 25 min (Oct 2025) to over 45 min (Jan 2026). — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [E] Full auto-approve used in about 20% of sessions by new users (<50 sessions) and over 40% by about 750 sessions; meanwhile interrupt rate *rises* with experience, from about 5% of turns to about 9%. Interpretation offered: experienced users shift from per-action approval to monitoring-and-intervening. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [E] Why Claude stops itself: present a choice between approaches 35%; gather diagnostic info/test results 21%; clarify vague request 13%; missing credentials/access 12%; approval before acting 11%. Why humans interrupt: provide missing technical context/corrections 32%; Claude slow, hanging or excessive 17%; got enough help 7%; want to do the next step themselves 7%; change requirements 5%. On the most complex tasks agent-initiated stops exceed human interrupts. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [E] Public API sample of 998,481 tool calls: 0.8% irreversible; about 80% from agents with at least one safeguard; internal usage Aug-Dec: human interventions per session fell 5.4 to 3.3 while hardest-task success doubled. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [O] Post's recommendation: "effective oversight doesn't require approving every action but being in a position to intervene when it matters"; mandating approve-every-step adds friction without clear safety benefit. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)

**Trust calibration / review quality**
- [E] "Coding with 'Enemy'" (Ye, Zou, Yu, Shi; Northeastern; arXiv 2606.05647; listed at NeurIPS 2026; abstract verified, details snippet only): 100+ developers on a ~5-hour task with a secretly sabotaging agent; 94% failed to detect sabotage (NeurIPS listing says 95%); with a *correct* monitor alert shown, sabotage still succeeded in 9/16 (56%) sessions; attributed failure modes (as reported in ParallelPilot's related work): minimal code review 67%, plausible cover stories 22%, overtrust from routine use 11%. Trust rose during the session. Authors: passive flag-only monitoring is insufficient. — [arXiv 2606.05647](https://arxiv.org/abs/2606.05647)
- [E] "I'm Not Reading All of That" (arXiv 2603.14225; formative, N=4, Cline; snippet only): cognitive engagement declines as agentic tasks progress; current assistants offer limited affordances for reflection and verification. Very small N. — [arXiv 2603.14225](https://arxiv.org/abs/2603.14225)

**Review bottleneck at PR level (AIDev dataset studies, 2026; snippet only unless noted)**
- [E] Per-agent PR acceptance on AIDev: Codex 0.83, Cursor 0.67, Claude 0.66, Copilot 0.45. — [arXiv 2602.02345](https://arxiv.org/html/2602.02345)
- [E] About 33k agentic PRs: documentation/CI/build PRs merge most; performance and bug-fix PRs least; 600 rejected PRs coded into a rejection taxonomy. — [arXiv 2601.15195](https://arxiv.org/html/2601.15195)
- [E] Security-related agent PRs: median review latency 3.92 h vs 0.11 h for others, lower merge rate. — [arXiv 2601.00477](https://arxiv.org/html/2601.00477v1)
- [E] "Are We All Using Agents the Same Way?" (MSR '26): 9,427 agent PRs; core vs peripheral developers differ in how they review and verify agent contributions. — [arXiv 2601.20106](https://arxiv.org/html/2601.20106v1)

### Inferences
- A session-manager state model should encode supervision stages, not just process status. The literature converges on at least: planning / running-watched / running-unwatched (Wait) / **needs input** / **errored** / **stalled (anomalous delay)** / **agent-reports-done, awaiting human verification** / accepted. "Agent says done" and "human accepted" must be different states (ParallelPilot implements this split; Park et al. make Review its own looping stage).
- The highest-value inbox items are blocked-on-human states (question, error), because they are both the most urgent and the most often missed; "done" is lower urgency but gates throughput.
- Raising awareness will increase concurrency and throughput but will not by itself fix review quality or trust. The inbox needs a second half: one-click descent from the status card to diff, test evidence, plan, and decision log.
- Practised span today is about 3 concurrent sessions, about 4-5 with good tooling for some, and far higher (about 20) only for small isolated cloud tasks: span depends on task independence and how often each agent needs the human.
- The sabotage result implies alerts alone are ignored when review is habitually shallow; high-severity items need more than a badge (e.g. forced acknowledgement or evidence shown inline).

### Gaps
- No study found that measures supervision performance as a function of N agents (a dose-response curve) for coding agents; ParallelPilot only observes peak 2.31 vs 3.25.
- No longitudinal field data on parallel-agent supervision (fatigue, review quality decay over a day). Fan et al. 2026, "When Help Hurts: Verification Load and Fatigue with AI Coding Assistants", is cited by Park et al. but I did not locate or verify it.
- Devin-specific and Copilot-coding-agent-specific supervision studies were not found beyond PR-mining work.
- OrchVis (arXiv 2510.24937) and AgentGUI (arXiv 2607.26300) surfaced as titles on oversight UIs for multi-agent / long-running agents but were not read; treat as leads only.

---

## 2. Interruption and notification science, and its application to agents (when to ask vs proceed)

### Takeaway
Classic work says an interruption costs far more than its own duration (about 10 minutes on the diversion plus 10-15 more before returning; 27% of suspensions last over two hours), that deferring notifications to task breakpoints reduces frustration, and that visible cues of the suspended task speed resumption. New agent-side work shows the value of asking is sharply time-dependent: a goal clarification is worth most in the first 10% of a run and asking after the midpoint can be worse than never asking, yet no frontier model asks in the optimal window.

### Cited Findings

**Classic**
- [E] Iqbal & Horvitz, "Disruption and Recovery of Computing Tasks", CHI 2007 (field logging study; verified, PDF read): users spent on average nearly 10 minutes on switches caused by alerts and another 10-15 minutes (depending on interruption type) before returning to the suspended task; 27% of task suspensions led to more than two hours until resumption. 40.8% of email alerts and 71% of IM alerts were responded to immediately. Suspended windows less than 25% visible took significantly longer to return to than windows more than 75% visible (p<0.005). Design guideline from the paper: keep suspended tasks in a visible, scannable area and provide cues for occluded ones. — [Iqbal & Horvitz 2007](https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf)
- [E] Iqbal & Bailey, "Effects of Intelligent Notification Management on Users and Their Tasks", CHI 2008, pp. 93-102 (OASIS; abstract via search): scheduling notifications at breakpoints reduces frustration and reaction time relative to immediate delivery; notification content determines which breakpoint granularity (coarse/medium/fine) it should wait for; statistical models detect breakpoints reasonably but struggle to tell types apart. — [CHI 2008 program](https://chi2008.acm.org/program/122.html); [DOI 10.1145/1357054.1357070](https://mijn.bsl.nl/doi/10.1145/1357054.1357070)
- [E] Mark, Gudith & Klocke, "The Cost of Interrupted Work: More Speed and Stress", CHI 2008 (lab experiment; via search): interrupted people finish faster with no significant difference in errors, but report higher stress, frustration, time pressure and effort. A related Mark et al. field study is the source of the widely quoted "about 82% of interrupted work resumed the same day, on average 23 min 15 s to get back" (secondary attribution; not re-read). — [Mark et al. 2008](https://www.ics.uci.edu/~gmark/chi08-mark.pdf)
- [T/O] Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI 1999, pp. 159-166: act, ask, or stay silent according to the expected utility given uncertainty about the user's goals and the cost of interrupting; content summarised from prior knowledge, existence verified. — [Horvitz 1999](https://www.erichorvitz.com/chi99horvitz.pdf)
- [O, with practitioner validation] Amershi et al., "Guidelines for Human-AI Interaction", CHI 2019: 18 guidelines organised by phase (initially, during interaction, when wrong, over time), validated with 49 design practitioners against 20 products. — [Microsoft Research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)

**Proactive coding assistants**
- [E] Codellaborator, "Assistance or Disruption?" (Pu, Lazaro, Arawjo, Xia, Xiao, Grossman, Chen; CHI 2025; within-subject N=18): proactive agents increase efficiency over prompt-only but cause workflow disruptions; presence indicators and visible context scope alleviated disruption and improved awareness of what the AI is doing. — [arXiv 2502.18658](https://arxiv.org/abs/2502.18658)
- [E] "Need Help? Designing Proactive AI Assistants for Programming" (Chen et al.; CHI 2025): suggestion timing conditioned on the user's recent editor activity; small changes in timing and integration capabilities significantly change usage patterns. — [arXiv 2410.04596](https://arxiv.org/abs/2410.04596)

**When should an agent ask?**
- [E] "Ask Early, Ask Late, Ask Right" (Gulati, Gupta, Lumer, Sen, Subbiah; PwC; arXiv 2605.07937, May 2026; preprint; verified, full text read). Forced-injection of ground-truth clarifications at 10/30/50/70/90% of the trajectory, 84 task variants, 6,000+ runs, 3 benchmarks, 4 frontier models:
  - Goal clarification is front-loaded: pass@3 0.78 when injected at 10% vs 0.40 with no clarification; by 70% it is back to baseline (0.39).
  - Input clarification retains value through roughly 50% of the run.
  - "Deferring any clarification type past mid-trajectory degrades performance below never asking at all."
  - Wasted work grows with lateness (TheAgentCompany: 0.0% at 10% injection to 21.7% at 90%).
  - Natural behaviour over 300 unscripted sessions: GPT-5.2 asked in 52% of sessions (mean first ask at 43% of the trajectory), Claude Sonnet 4.5 in 23% (at 50%), Gemini 3 Flash 0%; 72% of first asks fall between 25% and 50% of the trajectory, i.e. too late for goal questions. Question quality may matter more than frequency (Claude's per-session success 11% vs 3%).
  — [arXiv 2605.07937](https://arxiv.org/abs/2605.07937)
- [E] Ambig-SWE (ICLR 2026; snippet only): on underspecified SWE-Bench Verified variants, models struggle to distinguish well- from under-specified tasks; when they do interact, clarifying questions account for most of the gain. — [arXiv 2502.13069](https://arxiv.org/html/2502.13069v3)
- [E] CLARITI, "Asking What Matters" (arXiv 2604.14624; snippet only): a trained clarification module asked about 41% fewer questions than GPT-5 at comparable performance; performance often plateaus or drops as question count grows. — [arXiv 2604.14624](https://arxiv.org/pdf/2604.14624)
- [E] From the human side: 13% of Claude Code's self-initiated stops are to clarify vague requests and 35% are to present a choice between approaches. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy)
- [E] Magentic-UI simulated-user experiment (GAIA validation, 162 tasks): autonomous 30.3% vs 51.9% with a simulated user holding side information (+71% relative) while asking for help in only 10% of tasks. — [arXiv 2507.22358](https://arxiv.org/abs/2507.22358)

### Inferences
- Push questions to the *front* of a run: a product can force a plan/clarification gate before long autonomous execution, because a goal question at 50% is nearly worthless and the redo cost is high.
- Inbox items differ in "time value": a blocking question has a decaying value curve and wastes agent time while unanswered; a completion notice does not. Rank and notify accordingly rather than chronologically.
- The human's breakpoints, not the agent's events, should drive delivery for non-urgent items (batch completions; deliver when the human finishes interacting with another session). Blocking questions/errors justify immediate but lightweight signalling.
- Each interruption plausibly costs on the order of 10-25 minutes of displaced attention in classic desktop studies; this is the per-interrupt budget an agent's question competes against. Whether those figures transfer to agent supervision (where the "primary task" is itself supervision) is untested.
- Keep suspended sessions visibly present with resumption cues (what I last told it, what it did since); the Iqbal-Horvitz visibility result and ParallelPilot's "couldn't even remember what I had told Copilot" point the same way.
- Fewer, better questions beat more questions; consider letting agents bundle several questions into one interrupt.

### Gaps
- No study found that applies breakpoint-based deferral to *agent-originated* notifications for a human supervising several agents.
- The 23 min 15 s resumption figure is cited from secondary sources; the primary paper was not re-read.
- Clarification-timing work uses simulated users and benchmark tasks; no human-cost term (interruption cost) is measured.

---

## 3. Human-agent interaction interfaces: Magentic-UI, Cocoa, communication challenges, plan review, action guards

### Takeaway
The research systems converge on the same set of mechanisms: co-planning before execution, interruptible co-tasking, risk-tiered action guards, per-session "needs input" indicators for multitasking, verification aids, and reusable plan memory. User evidence is still mostly small-N and qualitative; users want approvals only for high-stakes actions and find blanket approvals excessive.

### Cited Findings
- [E/system] Magentic-UI (Mozannar, Bansal, Tan, Fourney, Dibia et al., 20 authors; Microsoft Research; arXiv 2507.22358, Jul 2025; verified). Mechanisms: co-planning (editable step list; execution only after acceptance), co-tasking (user can interrupt and take over the browser; agent can ask for help), action guards (each action labelled always / maybe / never irreversible; "always" requires approval, "maybe" goes to an LLM judge), multitasking (several sessions with a status indicator showing when input is needed), answer verification, memory (completed runs distilled into reusable plans). — [arXiv 2507.22358](https://arxiv.org/abs/2507.22358)
- [E] Magentic-UI qualitative study (N=12, about 1 hour): SUS 74.58; participants found the red-dot "needs input" notification clear; approvals welcomed for high-stakes actions (payments) but seen as excessive for low-risk steps (adding to cart); preference for background running with safeguards; verification done mostly via screenshots and live view; pain points were latency, model errors, verbose text. — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- [E] Magentic-UI red-team: 24 adversarial scenarios, none succeeded under defaults; with mitigations disabled, prompt injection led to SSH-key exfiltration and the agent self-approving actions. — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- [E/system] Cocoa (Feng et al.; arXiv 2412.10999; CHI 2026): "interactive plans" in a document editor where human and agent co-edit plan steps and assign who executes each; lab study with 16 researchers found improved steerability over a chat baseline without loss of ease of use; 7-person field deployment. — [arXiv 2412.10999](https://arxiv.org/abs/2412.10999)
- [O] Bansal, Wortman Vaughan, et al., "Challenges in Human-Agent Communication" (arXiv 2412.10380 / MSR-TR-2024-53; position paper): twelve challenges in three groups: what agents must convey to users (A1-A5: e.g. capabilities, what it is about to do, what it is doing, side effects, whether the goal was achieved and how to verify), what users must convey to agents (U1-U3: goals, preferences, feedback), and cross-cutting issues (X1-X4: e.g. consistency, verification, avoiding information overload, use of past context). — [arXiv 2412.10380](https://arxiv.org/abs/2412.10380)
- [E, reflective deployment not user study] Kitano, Carlson, Russett, Kesling, "Managing Multi-Agent Research Systems: A Dashboard for Human Oversight" (HEAL workshop @ CHI 2026): six-week self-deployment with three concurrent research agents; agents run 24/7 and overproduce information; "parallelizability amplifies the oversight burden"; dashboard uses review-before-catalog and edit-proposal-before-run gates. — [HEAL@CHI'26 paper](https://heal-workshop.github.io/chi2026_papers/Managing%20Multi-Agent%20Research%20Systems%20A%20Dashboard%20for%20Human%20Oversight%20of%20Coordin.pdf)
- [E] Design implications from Kumar et al.: explicit permission for environment-changing actions, reviewable and reversible changes with checkpoints, summarise intermediate steps with detail on demand, specific follow-up suggestions. — [arXiv 2506.12347](https://arxiv.org/html/2506.12347v3)
- [T] Parasuraman, Sheridan & Wickens, "A Model for Types and Levels of Human Interaction with Automation", IEEE Trans. SMC-A 30(3), 2000: automation level can be chosen separately for information acquisition, analysis, decision selection and action; the basis for per-action rather than global autonomy settings. — [dblp record](https://dblp.uni-trier.de/rec/journals/tsmc/ParasuramanSW00.html)

### Inferences
- Approval gating should be risk-tiered (irreversibility label plus a judge for the uncertain middle). Only 0.8% of observed tool calls were irreversible (Anthropic), so gating those specifically is cheap in interrupt volume; gating everything is what users reject.
- A plan artifact doubles as the review artifact and as the progress model (ParallelPilot, Cocoa, Magentic-UI all render plan steps as status).
- The inbox card for each session should answer Bansal's A-list: what it is doing, what it is about to do, side effects so far, whether it thinks it is done, and how I can verify.
- An approval UI is itself an attack surface (self-approval under prompt injection): approvals must come from an out-of-band channel the agent cannot write to.

### Gaps
- No controlled study compares approval-gating policies (per-action vs risk-tiered vs post-hoc review) on error rate and human load.
- AutoGen Studio (Dibia et al., arXiv 2408.15247) is a known no-code multi-agent builder/debugger but was not re-verified or read in this session; it is not included as a finding.
- "Agent inbox / ambient agents" is a practitioner pattern (LangChain); I found no peer-reviewed evaluation of the inbox pattern itself. ParallelPilot's ambient dashboard is the closest academic evidence.

---

## 4. Agent observability / AgentOps, failure taxonomies, stuck and looping agents

### Takeaway
Failure taxonomies give a concrete list of states a monitor should detect. In 1,642 annotated multi-agent traces the single most common failure mode is step repetition (15.7%), followed by reasoning-action mismatch (13.2%) and not knowing when to stop (12.4%); verification failures together are about 24%. Trajectory studies agree that failing runs are longer and more variable, which supports duration/step-count anomaly as a cheap "possibly stuck" signal.

### Cited Findings
- [E] MAST, "Why Do Multi-Agent LLM Systems Fail?" (Cemri, Pan, Yang, et al., UC Berkeley; arXiv 2503.13657v3; NeurIPS 2025 poster; verified). 1,642 annotated traces over 7 frameworks (MetaGPT, ChatDev, HyperAgent, AppWorld, AG2, Magentic-One, OpenManus); 14 modes in 3 categories; inter-annotator kappa 0.88; LLM annotator kappa 0.77 vs humans. Prevalence:
  - System design: disobey task spec 11.8%; disobey role spec 1.5%; **step repetition 15.7%**; loss of conversation history 2.8%; **unaware of termination conditions 12.4%**.
  - Inter-agent misalignment: conversation reset 2.2%; fail to ask for clarification 6.8%; task derailment 7.4%; information withholding 0.85%; ignored other agent's input 1.9%; reasoning-action mismatch 13.2%.
  - Task verification: premature termination 6.2%; no or incomplete verification 8.2%; incorrect verification 9.1%.
  - Category totals approx. 44% / 32% / 24% (my sums of the listed modes; the paper's figure values 44.2/32.3/23.5 were seen in a snippet).
  - Verifiers often "perform only superficial checks" (e.g. code compiles but violates the rules of the task).
  — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)
- [E/survey] AgentOps taxonomy (Dong, Lu, Zhu; CSIRO Data61; arXiv 2411.05285): systematic mapping of AgentOps tools; defines which artifacts to trace across the agent lifecycle (goals, plans, tool calls, LLM calls, memory, guardrail events, evaluations/feedback) as a reference template for monitoring, logging and analytics. — [arXiv 2411.05285](https://arxiv.org/abs/2411.05285)
- [survey] "From Agent Traces to Trust" (arXiv 2606.04990; snippet only): OpenTelemetry spans and classic provenance models do not fully capture agent-specific objects such as tool-call rationales and memory items. — [arXiv 2606.04990](https://arxiv.org/pdf/2606.04990)
- [E] SWE-agent (Yang et al., arXiv 2405.15793): repeated actions (same edit, scroll) tend to cascade; failure taxonomy includes agents stuck in an edit loop making recurrent failing edits. — [arXiv 2405.15793](https://arxiv.org/pdf/2405.15793)
- [E] Majgaonkar et al., "Understanding Code Agent Behaviour" (arXiv 2511.00197; snippet only): across OpenHands, SWE-agent, Prometheus on SWE-Bench, failed trajectories are consistently longer with higher variance than successful ones. — [arXiv 2511.00197](https://arxiv.org/html/2511.00197v1)
- [E] Magentic-UI on WebVoyager: median runtime 113.9 s for successful vs 236.7 s for unsuccessful tasks. — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- [E] Graphectory (arXiv 2512.02393; snippet only): graph analysis of 4,000 SWE-agent/OpenHands trajectories; proposes mid-run detection of problematic patterns, a diagnostic message to the agent, and rollback. — [arXiv 2512.02393](https://arxiv.org/html/2512.02393v2)
- [E] SWE-EVO (arXiv 2512.18470; snippet only): "Stuck in Loop" is a labelled failure category and its frequency differs by model family. — [arXiv 2512.18470](https://arxiv.org/pdf/2512.18470)
- [E] Human-side confirmation: 17% of human interrupts of Claude Code are because it was "slow, hanging, or excessive"; ParallelPilot participants used "unexpected delay" as an intervention cue. — [Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy); [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)

### Inferences
- A session manager can derive a "possibly stuck" state from cheap signals: repeated identical tool calls, run time or step count well beyond the expected duration for the task class (failed runs roughly 2x longer in one dataset), and prolonged inactivity. ParallelPilot shows an LLM-over-logs triage pass is workable for this.
- "Done" claims are unreliable: about a quarter of multi-agent failures are verification failures, and premature termination is 6.2%. Showing the agent's verification evidence (tests run, their output) alongside the done claim addresses this directly.
- Trace schema for the product: goal, plan steps, tool calls with rationale, questions asked, human interventions, verification events; standard spans are insufficient without rationale fields.

### Gaps
- MAST covers multi-agent frameworks on benchmark tasks, not single coding agents under human supervision; transfer of the percentages is an assumption.
- No published precision/recall for a production loop/stall detector was found.
- No public paper found with measured false-alarm cost of "stuck" alerts to human supervisors.

---

## 5. Supervisory control and span of control (fan-out, neglect tolerance): how many agents can one human supervise?

### Takeaway
The human-robot interaction literature gives a usable formula: fan-out = (neglect time + interaction effort) / interaction effort. Its authors and later UAV work both warn that the naive formula overestimates capacity, because context acquisition after each switch, queueing of simultaneous requests, and loss of situation awareness consume the human's time (capacity predictions dropped by up to 67% once wait times were modelled).

### Cited Findings
- [T] Olsen & Goodrich, "Metrics for Evaluating Human-Robot Interactions", PerMIS 2003 (verified, PDF read). Definitions: neglect tolerance NT = time a robot can be ignored before its effectiveness drops below threshold; interaction effort IE; robot attention demand RAD = IE / (IE + NT); free time FT = 1 - RAD; **fan-out FO = 1 / RAD = (IE + NT) / IE**. — [Olsen & Goodrich 2003](https://faculty.cs.byu.edu/~mike/mikeg/papers/OlsenGoodrichPERMIS2003.pdf)
- [T] Same paper: IE has four components: **subtask selection** (which robot next), **context acquisition** (understanding its situation after switching), **planning**, and **expression** of intent. "The context acquisition problem is probably the largest contributor to an upper bound on fan-out regardless of robot capability." Externalising memory in the interface reduces context acquisition time. — [Olsen & Goodrich 2003](https://faculty.cs.byu.edu/~mike/mikeg/papers/OlsenGoodrichPERMIS2003.pdf)
- [T/E-preliminary] Same paper on selection: round-robin gives zero selection effort but the robot most in need may not be served; showing all robots lets the user choose but "interaction effort increases with fan-out" (search cost on the order of log(FO) to FO); an automatically computed attention-need metric brings selection effort near zero but, if the metric is poor (e.g. "lack of progress" for a robot that should be abandoned), "may actually be worse than round-robin". Automatic selection can *increase* context acquisition time because the user does not know why the task was selected. — [Olsen & Goodrich 2003](https://faculty.cs.byu.edu/~mike/mikeg/papers/OlsenGoodrichPERMIS2003.pdf)
- [T/E] Same paper: neglect tolerance is not independent of the user: users detect global problems (a robot wandering into a cul-de-sac) and intervene before the robot notices; lower trust means earlier intervention and lower effective NT; raising autonomy can raise IE (more complex instructions) so RAD does not always fall; performance plateaus as robots are added (overload) and task saturation also caps useful fan-out. — [Olsen & Goodrich 2003](https://faculty.cs.byu.edu/~mike/mikeg/papers/OlsenGoodrichPERMIS2003.pdf)
- [E] Olsen & Wood, "Fan-out: Measuring Human Control of Multiple Robots", CHI 2004, pp. 231-238: experiments validate the fan-out equation in terms of activity time and interaction time, and show that beyond some point additional robots add little value (existence and abstract verified; numbers not read). — [BYU ScholarsArchive](https://scholarsarchive.byu.edu/facpub/1286)
- [E] Crandall, Goodrich, Olsen & Nielsen, "Validating Human-Robot Interaction Schemes in Multitasking Environments", IEEE Trans. SMC-A 35(4), 2005, pp. 438-449: secondary-task methodology for measuring neglect tolerance and interface efficiency; authors state the lessons apply to general multitasking environments. — [BYU ScholarsArchive](https://scholarsarchive.byu.edu/facpub/363)
- [E, simulation and experiment] Cummings & Mitchell, "Predicting Controller Capacity in Supervisory Control of Multiple UAVs", IEEE Trans. SMC-A 38(2), 2008, pp. 451-460: adds wait times to the fan-out model (interaction wait, queueing when several vehicles need attention at once, and loss-of-situation-awareness wait). Predicted capacity dropped by up to 67% when wait times were included, with loss of situation awareness the primary source; even in a highly automated management-by-exception system, situation-awareness wait time cut capacity 36% relative to the no-wait model. — [MIT DSpace](https://dspace.mit.edu/handle/1721.1/90280)
- [T] Sheridan's supervisory control stages (Plan, Teach, Monitor, Intervene, Learn) are the explicit starting frame for the 2026 coding-agent framework. — [arXiv 2609.24234](https://arxiv.org/abs/2609.24234)
- [E] Observed spans for coding agents: typical 3, most 2-4, tool-assisted peak mean 3.25 vs 2.31 baseline; about 20 for small isolated cloud tasks. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)

### Inferences
- Mapping to coding agents: NT is roughly the time an agent runs usefully before it needs the human (question, error, done-awaiting-review, or drift); IE is roughly the time to pick the session, reload context, review, decide and reply. Example: an agent that works 10 minutes unattended and costs 3 minutes of human time per touch gives a theoretical FO of about 4.3, in line with the observed 3-4; but applying Cummings-style wait-time penalties (36-67%) would pull the realistic number toward 2-3. This arithmetic is illustrative, not from a study.
- The product levers follow the IE decomposition: (a) subtask selection: an attention-ranked inbox; (b) context acquisition: per-session summary, "what I last asked / what changed since", diff and evidence one click away (the largest bound on fan-out per Olsen & Goodrich); (c) planning: suggested next actions or reply options; (d) expression: quick replies, approve/reject, templated steering.
- An attention-need ranking must be explainable (why this session is at the top) or it raises context-acquisition cost; and a single naive metric such as "no progress" will keep resurfacing sessions that should be killed, so the inbox needs dismiss/snooze/abandon.
- Simultaneous requests queue: N agents finishing together produce wait time for agents and loss of situation awareness for the human. The inbox should make queue length and agent idle time visible.
- Trust lowers effective NT: users who distrust agents check early. Tools that surface credible evidence increase practical span.
- Increasing autonomy (longer turns) raises NT but also raises IE per touch (larger diffs to review); span does not necessarily grow. The 2026 studies' emphasis on Review as the heaviest stage is consistent with this.

### Gaps
- No paper found that measures NT and IE for LLM coding agents or validates the fan-out equation in this domain.
- The frequently quoted "about 70% operator utilization" threshold from the UAV literature was not confirmed in the sources I opened; it is left out.
- Numerical results of Olsen & Wood 2004 and Crandall et al. 2005 were not extracted.

---

## 6. Gamified / spatial / ambient visualizations and glanceable awareness displays

### Takeaway
Evidence for metaphor-based or "information art" displays is thin and mixed: an abstract pictorial display beat text and a web portal on immediate recall after an 8-second glance, but users preferred the conventional portal and had to learn the mappings. For agent supervision specifically, the only evidence is that a plain status-card dashboard with a blinking "needs attention" cue was rated 6.88/7; I found no study of game-like or spatial-metaphor dashboards for supervising agents.

### Cited Findings
- [E] Plaue, Miller & Stasko, "Is a Picture Worth a Thousand Words? An Evaluation of Information Awareness Displays", Graphics Interface 2004 (within-subjects, 8-second exposure then recall; via search): participants recalled significantly more information from the abstract InfoCanvas than from a web-portal or a text display, despite having to learn its graphical mappings; yet they generally *preferred* the web portal. — [GI 2004](https://graphicsinterface.org/proceedings/gi2004/gi2004-15)
- [T/E] Matthews, "Designing and Evaluating Glanceable Peripheral Displays" (UC Berkeley dissertation, 2007, advisor Mankoff) and Matthews, Hsieh & Mankoff, "Evaluating Peripheral Displays" (2009 book chapter): evaluation criteria for peripheral displays include appeal, learnability, awareness, effects of breaking away from the primary task, and distraction; best practices for glanceable visuals during multitasking. Specific effect sizes not extracted. — [Berkeley TR EECS-2007-56](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2007/EECS-2007-56.html); [Springer chapter](https://rd.springer.com/chapter/10.1007/978-1-84882-477-5_19)
- [E] ParallelPilot ambient dashboard (status cards by Done / Running Now / Next, glowing and blinking card plus a one-line reason for `needs_attention`): noticing finished/stalled/needs-input rose 3.63 to 6.19 of 7; dashboard usefulness 6.88/7; a participant called seeing completion notifications "the most satisfying UX feature". — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Without a dashboard, developers' improvised glanceable cues were tab spinners, a blinking dot, and tiled terminals; tiling 2-4 sessions shrank windows so "fine detail was easy to miss", and turning away "often led to missed agent updates". — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Magentic-UI: participants found a simple red-dot per-session indicator clear. — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- [E] Iqbal & Horvitz: visibility of the suspended task window is associated with faster return. — [Iqbal & Horvitz 2007](https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf)
- [E] Codellaborator: presence indicators for the AI reduced perceived disruption. — [arXiv 2502.18658](https://arxiv.org/abs/2502.18658)

### Inferences
- A metaphor layer (office, town, pets) may improve at-a-glance recall after learning but carries a learnability cost and can conflict with preference; the InfoCanvas result suggests offering it as an optional view over a literal list, not replacing it.
- What demonstrably works is literal and low-dimensional: one salient state per session (needs input / error / stalled / done-unreviewed / running), a one-line reason, and a persistent spatial position per session so a glance suffices.
- A metaphor view must not hide the evidence path; ParallelPilot's null result on control suggests that any abstraction that increases distance from code risks "not thinking as hard".

### Gaps
- No empirical study found on gamified or spatial-metaphor dashboards for supervising AI agents (positive or negative). Claims that such metaphors help or hurt are currently unsupported for this domain.
- Pousman & Stasko's 2006 taxonomy of ambient information systems (AVI 2006) is relevant but was not retrieved in this session.
- No evidence found on audio or haptic ambient cues for agent supervision.

---

## 7. Measured productivity effects of AI coding agents as they bear on review and waiting overhead

### Takeaway
The best-known RCT found experienced open-source developers 19% slower with early-2025 tools while believing they were 20% faster; METR's late-2025 follow-up points to speedups (-18% time for returning developers, -4% for new ones, both with wide intervals) but METR says the design is breaking down, in part because developers now run multiple agents concurrently and work on other things while waiting, which makes time-on-task unmeasurable.

### Cited Findings
- [E] METR RCT (Becker, Rush, Barnes, Rein; arXiv 2507.09089; Jul 2025): experienced open-source developers took 19% longer with AI allowed (95% CI +2% to +39%); they had forecast and afterwards still believed AI sped them up by about 20%. Tools from Feb-Jun 2025. — [METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/); [arXiv 2507.09089](https://arxiv.org/pdf/2507.09089)
- [E] METR update, 24 Feb 2026 (verified): follow-up with 57 developers, 143 repositories, 800+ tasks. Estimated change in time: returning developers -18% (CI -38% to +9%); new developers -4% (CI -15% to +9%). METR calls this "very weak evidence" on magnitude and likely a lower bound on speedup. — [METR](https://metr.org/blog/2026-02-24-uplift-update/)
- [E] Same update, measurement breakdown: time measurements are unreliable for developers who "use multiple AI agents concurrently"; some worked on unrelated tasks while waiting for an agent; 30-50% of developers withheld tasks they did not want to do without AI; some declined to participate because they "do not wish to work without AI"; pay had dropped from $150/h to $50/h. — [METR](https://metr.org/blog/2026-02-24-uplift-update/)
- [E] Perception gap matters for product metrics: self-reported efficiency rose (3.75 to 5.44) alongside objective throughput (+63%) in ParallelPilot, but in METR 2025 perception and measurement diverged in sign. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113); [METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- [E] In ParallelPilot, monitoring took about 73-75% of supervised session time and coordination (planning, isolating) about 25-27%, in both conditions. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Parallel work is triggered by wait time on a single agent. — [arXiv 2609.33113](https://arxiv.org/abs/2609.33113)
- [E] Agent PR acceptance varies from 0.45 to 0.83 by agent, so a material share of agent output is reviewed and then discarded. — [arXiv 2602.02345](https://arxiv.org/html/2602.02345)

### Inferences
- Wall-clock time per task is no longer a valid productivity measure once sessions overlap; a session manager is in a position to log better ones: human-attention minutes per accepted change, agent idle time waiting on the human, time from done-claim to acceptance, rework loops per task, discard rate.
- Self-report will overstate benefit; instrument objective measures in the product.
- Waiting overhead and review overhead trade against each other: parallelism removes waiting but concentrates load in monitoring and review.

### Gaps
- No RCT yet isolates the productivity effect of *parallel* agent use against a single agent in real (non-lab) work; ParallelPilot is a lab study on six short tickets.
- METR had not published a redesigned-study result as of the sources read; any later 2026 result was not found.
- Industry claims of large throughput gains from agent fleets (e.g. vendor blog posts cited in ParallelPilot) are not independently verified and are excluded.
