# T3 Code teardown (`pingdotgg/t3code`), November 2026

Scope: why T3 Code feels good, at the level of mechanisms, and what session-board can port.
This goes deeper than section 4 of `named_tools_followup.md` and does not repeat it.

**How this was researched.** Shallow clone of `main` at commit `192ef9b` (committed 2026-11-22), read locally.
Repo paths below are relative to the repo root; prefix them with `https://github.com/pingdotgg/t3code/blob/main/` to open them.
User commentary comes from Hacker News comments (Algolia API), one long blog review, one podcast, and the GitHub issue list sorted by reactions.

**Gaps.** Reddit is blocked for this session's fetcher, so no Reddit threads were read. `www.pulse.bot` (a video review summary) did not resolve. X posts were seen only through Digg summaries. GitHub repo metadata and releases were not readable through the API (issue search worked). Anything marked UNVERIFIED was not confirmed in a primary source.

**One caveat about `docs/orchestration-v2/`.** That folder calls itself the "target architecture" and "not a patch plan". Where it and the code disagree, the code and `docs/internals/` win. Enum names below are taken from `packages/contracts/src/orchestrationV2.ts`, which is the shipped wire contract.

---

## 1. Architecture

### Findings

**Process layout** (`AGENTS.md`, `docs/internals/overview.md`)

| Piece | What it is | Path |
| --- | --- | --- |
| Server (`t3`) | Node WebSocket server. Owns provider subprocesses, terminals (`node-pty`), Git, project files, SQLite | `apps/server` |
| Web | React + Vite, TanStack Router, React Compiler on every file | `apps/web` |
| Desktop | Electron shell around the web app; bundles the server; can host for remote clients | `apps/desktop` |
| Mobile | React Native / Expo, separate navigation | `apps/mobile` |
| Shared client logic | Connection supervisor, RPC session, state services, shared by web and mobile | `packages/client-runtime` |
| Wire contract | Effect Schema; "anything crossing the wire is typed" here | `packages/contracts` |
| Providers | One package per driver, plus a shared ACP adapter | `packages/provider-*`, `apps/server/src/orchestration-v2/Adapters` |

The rule that shapes everything: "A remote client must never substitute its own filesystem, provider credentials, or machine state for the environment's." The desktop renderer obeys the same boundary as a phone.

**Wire protocol** (`packages/contracts/src/rpc.ts`, `docs/internals/connection-runtime.md`)

- Typed RPC over one WebSocket (Effect `Rpc.make`), with streaming RPCs for subscriptions. A handful of things go over HTTP instead: the shell snapshot (gzip), older history pages, uploads.
- Two orchestration streams, deliberately independent:
  - `subscribeShell({afterSequence?, httpSnapshotFallback?, omitIdleSubagents?, omitOlderSettled?})` is the sidebar. Items: `snapshot`, `snapshot-required`, `project.updated`, `project.removed`, `thread.updated` (each with `sequence`), `synchronized`.
  - `subscribeThread({threadId, afterSequence?, acceptBoundedSnapshot?, acceptDeferredWork?, acceptCompactTurnItems?, acceptDedupedBodies?, acceptCompactIds?})` is one open thread. Items: `snapshot` (with `snapshotSequence`, `historyCursor`, `hasMoreHistory`), `event` (with `sequence`), `synchronized`.
  - Separately: `subscribeCommandOutput` (live stdout of one expanded command row) and `subscribePromptSuggestion`.
- Client opt-in flags (`accept*`, `omit*`) are how a new client asks an old or new server for smaller payloads without breaking older pairs. Clients and servers are versioned independently.
- Resume rule: a cursor at the head always resumes with deltas. A cursor below both the thread's newest event and the pruned-through sequence gets a snapshot. Resume catch-up replays at most 128 thread events and 1 MiB of projected JSON before falling back to a snapshot (`docs/internals/performance-regressions.md`).
- "Reconnection does not automatically replay mutations, whose retry and idempotency rules belong to the operation."

**Orchestration engine** (`apps/server/src/orchestration-v2/`)

1. A handler (`ws.ts` RPC, HTTP route or MCP tool) decodes input and calls one service method. Transports stay thin.
2. `Orchestrator.ts` serializes commands and decides events "without doing any I/O".
3. `EventSink.ts` commits, in one SQLite transaction: the events, the projection rows, the command receipt, and outbox effects. Subscribers are notified after commit.
4. `EffectWorker.ts` claims outbox rows, does the side effect, and feeds the result back as a new command.

Concretely:

- **Command receipt** = row in `orchestration_v2_command_receipts(command_id PK, thread_id, command_type, accepted_at, result_sequence, status, error)`. The client generates `commandId`; "the server replays an accepted commandId from its receipt" (`packages/client-runtime/src/operations/commands.ts`). A repeated `runtime-request.respond` "returns its receipt without posting the answer twice". Receipts outlive the pruned log.
- **Outbox** = `orchestration_v2_effect_outbox(effect_id PK, command_id, thread_id, effect_type, payload_json, status in pending|running|succeeded|failed, attempt_count, available_at, lease_owner, lease_expires_at, last_error, ...)` (`apps/server/src/persistence/Migrations/OrchestrationV2/Foundation.ts`). It is a leased work queue. Effect types (`EffectOutbox.ts`): `provider-turn.start`, `provider-turn.interrupt`, `provider-turn.steer`, `provider-turn.restart`, `provider-runtime.continue`, `provider-session.detach`, `provider-session.apply-model-selection`, `provider-session.apply-thread-title`, `provider-thread.rollback`, `runtime-request.respond`, `checkpoint.capture`, `thread-title.generate`, `delegated-tasks.stop`, and cleanups for terminals, previews, attachments and scheduled tasks.
- A comment in `EffectOutbox.ts` states an ordering rule: "Retry backoff must block later effects so turns cannot race a pending rollback."
- A command acknowledgement "means the intent committed, not that the provider, checkpoint, or other follow-up work finished."

**Persistence**

- SQLite through Node's built-in `node:sqlite` (`apps/server/src/persistence/Sqlite.ts`), file `statev2.sqlite` under `~/.t3/userdata`.
- Event log: `orchestration_v2_events(sequence INTEGER PK AUTOINCREMENT, event_id UNIQUE, command_id, thread_id, run_id, node_id, provider, raw_event_id, event_type, occurred_at, payload_json)`, indexed by command, thread+sequence, thread+type+sequence, run, node, raw event id (`Migrations/055_OrchestrationV2.ts`).
- Projection tables, one per entity: `orchestration_v2_projection_{threads, runs, run_attempts, nodes, provider_sessions, provider_threads, provider_turns, runtime_requests, messages, turn_items, plans, checkpoints, checkpoint_scopes, context_handoffs, context_transfers, thread_item_counts, turn_item_counts}` plus `orchestration_v2_turn_item_positions`. Most keep a `payload_json` with promoted columns for what queries filter on.
- Item counts are kept exact by triggers so the sidebar never counts rows.
- 90+ migrations; "retained events must remain decodable on replay".

**Provider adapter interface** (`packages/provider-core/src/server/ProviderAdapter.ts`)

- Adapter level: `getCapabilities()`, `planSelectionTransition()`, `openSession()`.
- Session runtime, required: `events` stream, `ensureThread`, `resumeThread`, `startTurn`, `steerTurn`, `interruptTurn`, `respondToRuntimeRequest`, `readThreadSnapshot`, `rollbackThread`, `forkThread`.
- Session runtime, optional: `resumeTurn`, `compactThread`, `injectHistory`, `applyModelSelection`, `applyThreadTitle`, `stopTask`, `awaitBackgroundTasks`, `stopSubagent`, `unloadThread`, `hasPendingBackgroundWork`, `getModelContextWindow`, `mcpApps`, `mcpSignIn`, `uploadFeedback`.
- Normalized adapter events (`ProviderAdapterV2Event`): `app_thread.created`, `provider_session.updated`, `provider_thread.updated`, `thread_model_selection.updated`, `provider_turn.updated`, `node.updated`, `subagent.updated`, `message.updated`, `turn_item.updated`, `steer.updated`, `background_work.updated`, `background_work.lost`, `command_output.delta`, `prompt_suggestion.updated`, `runtime_request.updated`, `plan.updated`, `turn.terminal` (completed / interrupted / cancelled / failed, each saying whether the session is `reusable` or `broken`).
- Capabilities are about 60 booleans in `OrchestrationV2ProviderCapabilities` (for example `supportsActiveSteering`, `supportsSteeringByInterruptRestart`, `supportsQueuedMessages`, `pendingRequestsSurviveRestart`, `approvalCallbacksAreLiveOnly`, `providerCanRollbackConversation`, `terminalStatusQuality: strong|weak|none`). "Orchestration and clients read capabilities, never the driver kind." A capability "left on that fails at runtime is a bug" (`docs/internals/adding-a-provider.md`).
- Timeline item types (`OrchestrationV2TurnItem`): `user_message`, `assistant_message`, `reasoning`, `proposed_plan`, `todo_list`, `user_input_request`, `approval_request`, `file_change`, `command_execution`, `file_search`, `web_search`, `checkpoint`, `run_interrupt_request`, `run_interrupt_result`, `system_notice`, `error`, `compaction`, `handoff`, `fork`, `thread_created`, `subagent`, `dynamic_tool`, `notification`, `secret_request`, `link_request`, `feedback_request`. Unknown tools fall into `dynamic_tool` and render as expandable JSON.

**Approvals and questions**

- Both are a `RuntimeRequest`: `kind` is a provider request kind or `dynamic_tool_call | user_input | auth_refresh`; `status` is `pending | resolved | expired | cancelled`.
- The key field is `responseCapability`: `{type:"live", providerSessionId}` (a callback is waiting in a live process), `{type:"message"}` (answer by sending a user message), or `{type:"not_resumable", reason}`.
- Codex async questions "arrive as notifications and are answered with a new user message", so they persist as `user_input_request` items with `responseCapability: message`, do not block the run, and "remain pending after a turn finishes, a provider exits, or the server restarts" (`docs/internals/providers.md`).
- `runtime-request.respond` "commits the resolution and a user message in one transaction".
- Native option IDs pass through unchanged: "a display label is not necessarily a valid reply." Every request needs a decline the provider honors.
- Subagent approvals surface in the parent thread with the subagent's name (`docs/user/permission-modes.md`).
- The shell row carries a small `pendingRuntimeRequest {id, kind, createdAt, blocking?, userOnly?}` so the sidebar needs no thread detail to show "needs you".

### Inferences

- The event log here is a replication and idempotency log, not the system of record. The projection is the record. That is a deliberate trade for bounded disk and fast startup, and it is the opposite of session-board's replayable log.
- `responseCapability` is the most transferable idea in this section. It turns "can I still answer this?" into persisted data, which is exactly the question session-board has for a permission hook that may have timed out.
- The outbox exists because T3 owns side effects. session-board has few side effects, so it needs the pattern only for its outbound actions (tmux reply, headless resume, hook response).

---

## 2. Thread / turn model and state names

### Findings

**Entities.** Thread (durable conversation) -> Run (the "turn": one user-to-agent cycle) -> RunAttempt -> Node (execution graph) -> TurnItem (what the timeline shows). Beside them: ProviderSession (the live process), ProviderThread (the provider's native conversation), ProviderTurn (the provider's native turn). One run can own several provider turns (steer-by-restart, Codex `/goal`).

**Exact enums** (`packages/contracts/src/orchestrationV2.ts`)

| Thing | Values |
| --- | --- |
| Run status | `preparing`, `queued`, `starting`, `running`, `waiting`, `completed`, `interrupted`, `failed`, `cancelled`, `rolled_back` |
| Shell thread status | `idle` plus every run status |
| Run attempt | status `pending`, `running`, `completed`, `interrupted`, `failed`, `cancelled`, `superseded`; reason `initial`, `steering_restart`, `retry`, `provider_recovery` |
| Provider session | `starting`, `ready`, `running`, `waiting`, `stopped`, `error` |
| Provider thread | `not_loaded`, `idle`, `active`, `archived`, `closed`, `error` |
| Provider turn | `pending`, `running`, `completed`, `interrupted`, `failed`, `cancelled` |
| Turn item | `idle`, `pending`, `running`, `waiting`, `completed`, `failed`, `cancelled`, `interrupted` |
| Node kind | `root_turn`, `assistant_message`, `reasoning`, `plan`, `todo_list`, `tool_call`, `approval_request`, `user_input_request`, `subagent`, `hook`, `system` |
| Runtime request | `pending`, `resolved`, `expired`, `cancelled` |
| Failure class | `usage_limit`, `provider_error`, `transport_error`, `permission_error`, `validation_error`, `unknown` |
| User message intent | `turn_start`, `queued_turn`, `steer`, `promoted_queued_to_steer` |
| Plan | `draft`, `active`, `completed`, `superseded`; kinds `proposed_plan`, `todo_list` |
| Checkpoint | `ready`, `missing`, `error`, `stale` |
| Assistant message phase | `commentary`, `partial_answer`, `final_answer` |
| Goal | `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, `complete` |
| Thread lifecycle events | `thread.archived/unarchived/deleted/settled/unsettled/snoozed/unsnoozed/pinned/unpinned/visited/marked-unread/...` |

Settlement is not a status. It is separate fields on the thread shell: `settledOverride: "settled" | "active" | null`, `settledAt`, `unsettledAt`, `snoozedUntil`, `pinnedAt`, `autoSettleDisabledAt`, `archivedAt`, `lastVisitedAt`.

**How the user-facing label is derived** (`apps/web/src/components/Sidebar.logic.ts`, `resolveThreadStatusPill` and `resolveSidebarThreadStatus`). It is a strict priority ladder, first match wins:

1. `Pending Approval` (amber): thread has a pending approval, or a subagent does.
2. `Awaiting Input` (indigo): pending user-input request, own or subagent's.
3. `Guest Request`: a guest's message waits for the owner.
4. `Working` (sky, pulsing): runtime `running` and not blocked on a child thread, or `waiting`.
5. `Connecting` (sky, pulsing): `preparing`, `starting`, `queued`.
6. `Waiting` (muted): running but `blockedOnThreadWait`.
7. `Failed` (red): only if the failure is unseen. `Limited` instead when `lastErrorClass === "usage_limit"`.
8. `Waiting` (muted): background work the agent said it is waiting on still holds completion.
9. `Plan Ready` (violet): plan mode, latest run settled, `hasActionableProposedPlan`.
10. `Completed` (green): `latestRun.completedAt > lastVisitedAt`, and the run was not `interrupted` or `cancelled`.
11. Nothing.

Supporting rules in the same file:

- `hasUnseenCompletion`: no `lastVisitedAt` means not unread; interrupted and cancelled runs never count as unread.
- `resolveSidebarRowStatus`: "a failure the user has already opened settles to ready, like Done."
- `shouldRecedeSidebarThread`: working / preparing / waiting rows are visually dimmed; rows needing input or approval never are; ready rows recede once read.
- `resolveSidebarFolderDot` for a collapsed project folder: `attention` (input, approval, guest request, limited) > `failed` > `unread` > `working` > none.
- `resolveThreadLastVisitedAt`: the server's `lastVisitedAt` beats the local one, so read state follows you across devices; "mark unread" rewinds it.
- `packages/client-runtime/src/delayedStatus.ts`: a status shows only after it has been set for 400 ms and then stays for at least 400 ms, "so a quick flicker never flashes on screen".

**Queue, steer, interrupt** (`docs/user/composer.md`, `docs/orchestration-v2/feature-lifecycles.md`)

- Per-client setting "Follow-up behavior": Queue or Steer. A modifier key sends the opposite.
- Commands: `message.dispatch`, `queued-run.start|reorder|cancel|edit`, `queued-message.promote-to-steer`, `queue.resume`, `run.interrupt`, `thread.stop`.
- Steering is an app-level intent with two implementations: native (`steerTurn`), or interrupt-and-restart, which creates a new attempt with reason `steering_restart` on the same run.
- "Auto, steer, and restart sends resolve delivery from authoritative state inside the server's per-thread dispatch lock." The client does not decide whether a send becomes a turn, a queue entry or a steer.
- Queued messages render as dashed messages at the end of the thread, are editable in place, and "if you stop the agent or the server restarts, queued messages keep their order and are held" until resumed.
- A slash command is queued rather than steered, "because a command steered into a turn would replace the agent's task."

**Plan mode.** `interactionMode` (how the agent approaches the task) is separate from `runtimeMode` (permission policy: Supervised, Auto-accept edits, Auto, Full access). A proposed plan is a turn item and a `Plan` entity; the shell exposes `hasActionableProposedPlan`. The plan toggle is hidden unless "the provider's plan output becomes T3's proposed-plan card".

**Context and usage** (`docs/user/usage.md`, `docs/user/composer.md`). Provider turns carry `tokenUsage`. The thread details card can show context use against the model's limit, with "a tick on the bar" where the provider auto-compacts, and per-window subscription limits with reset time and pace. A `usage_limit` failure carries `usageLimitResetAt`, which drives "Resume at reset" and "Snooze until reset".

### Inferences

- The feel of the sidebar comes from the ladder being short, total, and ordered by "who is blocked on whom", plus two dampers (unseen-only for Failed and Completed, and the 400 ms delay). Nothing in it is a raw provider state.
- Splitting attention state (ladder) from filing state (pinned / active / working / snoozed / settled / archived) is what lets a thread be "settled but came back because it needs approval".

---

## 3. Git workflow

### Findings

**Worktrees.** A thread's workspace is `root`, `existing_worktree` or `worktree`. Threads sharing a checkout share its branch, "so T3 Code refuses a branch switch there while one of them is working" (`docs/user/thread-sidebar.md`). Multi-repo projects use a "task folder" holding one worktree per chosen repository, keyed by directory rather than thread "because subagents, forks and reused worktrees share a path" (`docs/internals/overview.md`). `runOnSettle` / `stopOnSettle` project actions run cleanup (for example `cargo clean`) when a thread settles. Worktree disk growth is a known cost: the FAQ says "One user cleared 500 GB."

**Checkpoints** (`apps/server/src/orchestration-v2/CheckpointService.ts`, `apps/server/src/vcs/GitVcsDriver.ts`)

- Ref name: `refs/t3/orchestration-v2/checkpoints/<base64url(scopeKey)>/<name>`.
- Capture uses a temporary index (`GIT_INDEX_FILE`), `read-tree`, `write-tree`, `commit-tree`, then `update-ref`. The user's index, branch and stash are untouched.
- When: `checkpoint.capture` is an outbox effect after the run ends; `RunFinalizationService.ts` owns it. It is explicitly not part of provider duration: "A late checkpoint or diff must not extend the recorded provider duration or keep the client showing provider work as active."
- Scopes are sparse: one `git status` per tracked repository per turn; only a repository the turn changed gets a ref and a `checkpoint.captured` event. "A missing record means the turn left the repository alone."
- Turn diff = baseline checkpoint vs the turn's checkpoint, minus what Git brought in: "When a turn pulls, merges, or rebases, the files Git brought in are left out. A file stays in the list when the turn edited it, committed it, or fixed a conflict in it." (`docs/user/source-control.md`)
- Codex's own `turn/diff/updated` is switched off: "T3 derives diffs from checkpoints."
- Restore: `git restore --source <commit> --worktree --staged` plus `git clean -fd` on the scope. Across repositories it is all-or-nothing: "each folder is snapshotted first and put back if a later restore fails." Run ordinals are never reused, so discarded runs' refs are deleted.
- Revert must also roll back the conversation: "A provider that cannot roll back its conversation must reject that operation before changing the filesystem."

**Diff viewer.** Sources: one turn, the branch comparison against base, uncommitted changes, or one commit (newest 100). Rendered with `@pierre/diffs`. Line comments can be sent to the agent.

**Commit / push / PR.** Per-thread Git actions commit, push and open a PR; an app-owned "text generation" model writes commit messages and PR titles and descriptions, drawing on "the work in the thread, including the checks it ran". Eight forges through `packages/source-control-*`. "Stacked" here means native PR stacks (stack UI, stack merges, restack on update), not a single commit+push+PR button. A one-click combined action in the current UI is UNVERIFIED.

**PR tracking and settlement.** `ThreadPullRequestLink` is keyed by host, repository and number; a thread can hold several. `PullRequestSyncReactor.ts` refreshes each distinct linked PR once per cadence; "the server finds the PR for each unsettled thread's saved branch, even when your apps are closed". Defaults: settle after seven days inactive, and when the PR merges. Blockers: active runs, pending requests, awaited background work. "Only your own messages count as resuming." The guarded `thread.auto-settle` command "rejects newer activity, explicit settlement overrides, and live or blocked work". `watch_pull_request` lets an agent end its turn and be woken on checks, comments or conflicts.

### Inferences

- The turn-diff rule (subtract what Git brought in) solves the same problem session-board's attribution-by-edited-files solves, from the other side. T3 can do it exactly because it snapshots the tree at turn boundaries.
- Checkpoints work only because T3 knows when a turn starts and ends and is allowed to write refs into the user's repository.

---

## 4. UX details users single out

### Findings: what the project builds and claims

**Performance as a stated non-negotiable.** `AGENTS.md`: "Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays." Regressions are "often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render".

**Payload budgets enforced in CI** (`docs/internals/performance-regressions.md`, `apps/server/integration/transferBudgetV2.integration.test.ts`)

- Cold open of a thread stops at about 1 MiB of encoded rows, 10 user turns or 500 rows; older history pages over HTTP.
- Command output, tool result bodies and inline file-change bodies are "omitted at the wire boundary, including small outputs". They load when a row is expanded.
- Live command output never enters the event log: "a busy command would flood the event store and block ingestion for every other thread."
- The sidebar snapshot contains active rows only; idle subagents and all but the 25 newest settled threads load on demand.
- First server config for a provider with 250 slash commands and 200 skills must be under 1 KiB.
- CI prints the budget table and the PR comment names every ceiling a PR raises.

**Perceived latency**

- Desktop keep-alive: every thread whose session is starting or running stays subscribed, so "opening a running thread then needs no replay" (`apps/web/src/state/threads.ts`).
- Thread detail cache keeps state and cursor for five idle minutes so Back resumes without a snapshot.
- Cached projections stay readable offline, and the UI separates "transport is down" from "data is stale": "labeling that state 'reconnecting' promises a transport retry that will never happen."
- Mobile "steady shells": rows do not reshuffle as each environment syncs; environments arriving within two seconds show together.
- Optimistic paths exist in the composer send, queued runs and the pending-input panel (`apps/web/src/components/chat/useComposerSend.ts`, `QueuedRunsControl.tsx`, `ComposerPendingUserInputPanel.tsx`). Their exact rollback rules were not read (UNVERIFIED in detail).
- Lists use `@legendapp/list`; React Compiler is mandatory, and a test fails on any file it skips (`docs/internals/web-ui.md`).

**Sidebar** (`docs/user/thread-sidebar.md`)

- Sections: Pinned, Active, Working (collapsed, beta, on by default), Snoozed, Settled.
- Working fold: threads that are working or awaiting resumable work leave the active list; one "returns to the top of the active list when it finishes, fails, or needs an approval or answer". A dev server left running does not hold a thread there.
- With the fold on, the active list is ordered by "when each thread last came back to you".
- Snooze wakes early for "an approval, a new question, a failed run, or a message or answer you send".
- Every parking action has a five-second Undo toast, and `mod+z` triggers it. `AGENTS.md`: "A one-way door is a bug."
- Order, pins and read state are stored on the server, so they follow you across devices.
- Drag between sections to pin, settle, un-settle or wake; press Settle and drag to sweep a range.

**Composer** (`docs/user/composer.md`)

- `/` commands, `$` skills, `@` mentions (files, threads, side chats, PRs) as typed chips: `[label](t3-context://v1/<kind>/<contextId>)`.
- Paste or drag images; HEIC converts to JPEG. Pastes of 32 KiB or more become a file attachment.
- Select text in a reply to quote it as a chip.
- Queue or steer while working; edit a queued message in place; prompt stash; recall a sent prompt; suggested next prompt.
- `Cmd/Ctrl+Enter` on a new thread starts it in the background and opens another empty draft. Shift-click several models to fan one prompt out to a thread and worktree each.
- `/side` or `/btw` opens a side chat that inherits context without adding to the thread.
- Drafts persist per thread and are cleared only on explicit environment removal; mobile queues messages offline.

**Other.** Command palette on `Cmd/Ctrl+K` searches threads across environments by title, branch, PR or project, with frecency ranking and message search. Keybindings are user-editable with `when` conditions. Terminals per thread; local servers the agent started are listed with ports and a Stop button. Notifications: browser/desktop notifications keyed by request id so a request "announces once" (`ThreadNotificationCoordinator.tsx`); mobile push for "finishes, fails, needs approval, or asks for input", only through T3 Connect. The window title carries the open thread's status. "Open in editor" exists as a thread-details row with a shortcut; its mechanics were not read (UNVERIFIED).

### Findings: what users say

Praise (Hacker News comments, November 2026 unless noted):

- kristofferR: "The sidebar is the best in the business, it's so nice to be able to settle/snooze threads."
- Vaudtje: "Works like inbox zero, hiding running threads until Claude needs input or is done. Integration with repo/PR is nice."
- peepee1982: "It's the only tool where I don't get overwhelmed when working on multiple Threads/Projects at the same time"; also singles out quoting selections ("makes responding to long responses incredibly joyful instead of disorienting"), the usage overview with pacing, per-turn diffs, and switching provider mid-conversation with handoff.
- Dibes: strongest at "a really good workflow", cross-harness orchestration and "truly phenomenal remote sessions"; "really been enjoying the inbox style workflow".
- isege: "especially for remote machine workflows is unmatched." hridyaagrawal: "really great for multi-machine orchestration + multi-harness work".
- 2001zhaozhao (building a competitor): "by far the best one I have tried that isn't glued to a specific model provider."
- slop: "they'll fix stuff quickly that anthropic or open ai mess up in their harnesses."
- djeastm: likes that it is fully open and that the author "clearly uses it himself"; built a scheduler on its API.
- Flavio Copes, blog, 2026-08-28: the background-send shortcut "changes the rhythm of the application"; diff scopes keep "the review loop attached to exact evidence"; "the approval follows the thread" across devices.
- Julius Marminge (maintainer, podcast 2026-05-06, auto-transcript): motivation was that in the Codex app "opening a thread took like up to a second"; goal is "you don't have to look at loading states all day" and an app that "shouldn't like make your fans explode".

Complaints:

- thefourthchime (HN): "too buggy and missing features I missed from Claude Code Desktop."
- b6n (HN): "a few weaknesses compared to Claude desktop but on the whole it is excellent."
- Dibes (HN): "weakest at customizability and making sure you have parity in all your agent harnesses with skills/etc".
- madeofpalk (HN): "There's 30 million of these and they all look basically identical."
- Digg summaries of X replies (small samples, directional): UI "cluttered and sloppy"; "disruptive restarts"; "most of the / commands don't work for codex".
- Flavio Copes: Full access is the default permission mode; server updates interrupt running turns; revert is blocked while a turn runs; worktrees "isolate files, not every external dependency".
- Top-reacted open issues: OpenCode Auto mode ignoring the user's permission patterns (#11458, +24); checkpoint capture hitting the 30 s git timeout in large workspaces and never converging (#26227); completion alert firing when a delegated task finishes though the parent will continue (#31087); sidebar label keeping the branch stamped at creation (#11078); Claude Auto mode running ask-rule commands without prompting (#15353); every provider CLI "not found on PATH" after an update until relaunch (#28714); new threads not preserving last-used model (#6508).

### Inferences

- Praise clusters on three things: the inbox sidebar (settle / snooze / working fold), remote and multi-machine, and one UI across harnesses. Speed is rarely named by users directly; it shows up as absence of complaint and as the maintainers' own motive.
- Complaints cluster on bugs from pace of change, parity gaps per provider, and restarts. Those are costs of owning the agent process, which session-board does not pay.

---

## 5. Reliability engineering

### Findings

**Server restart mid-turn** (`ProviderRuntimeRecoveryService.ts`, `RestartContinuation.ts`, `RestartBackgroundNote.ts`)

- Startup picks recovery candidates from projection state (queued runs, pending requests, live sessions, background work, unfinished delegated deliveries) without loading thread histories.
- "A run is marked running before its provider accepts the prompt, so only a provider turn of one of its attempts proves the prompt arrived. Recovery treats the others as never started."
- A user message the provider never accepted "stays available through the held queue". A delegated, agent-sent or scheduled prompt is re-sent instead, because "nobody reviews" it.
- "The lost provider callback cannot resume; persisted questions can be answered by a new user message."
- "No provider process survives the server; open native subagents can never report completion", so they are settled and recorded for the continuation.
- The continuation run gets a bounded note listing what background work was lost and why (server restart vs provider exit).
- Crash-loop guards: "A prompt whose start keeps crashing the server would otherwise be sent forever", and "normal upgrades must not exhaust an unfinished turn's crash allowance".
- "Effects tied to a lost provider process cannot simply replay; recovery retires them before admitting new work."

**Provider process crash.** `turn.terminal` says whether the session is `reusable` or `broken`. `background_work.lost` is a first-class event. Adapter rule: "A failed or stopped turn leaves nothing open. Settle the turn's tool calls, subagents, and pending approvals and questions. Each terminal path needs its own replay: completion, Stop, provider failure, and process exit."

**Reconnect after sleep** (`docs/internals/connection-runtime.md`, `packages/client-runtime/src/connection/supervisor.ts`)

- One retry owner per environment; jittered exponential backoff capped at five minutes that "resets only after a connection stays up".
- Foregrounding, a network change or an offline report only probes; "only a failed probe reconnects", because "offline reports are often wrong".
- Dead-socket detection: a probe unanswered after 500 ms triggers a fresh HTTP request to the host; if the host answers while the socket is silent, the socket is replaced. Probe deadlines are 3 s on loopback/LAN and 15 s elsewhere.
- Cache discipline: "Retain state and cursor together only after an update finishes. Cancellation must not advance the cached cursor beyond the applied data."
- "A missing shell row therefore does not prove a thread is gone: code that deletes data or a worktree on absence must check the family or the server first."

**Duplicates.** Client-generated `commandId` plus receipts; `event_id UNIQUE`; `raw_event_id` indexed for provider-side dedup; notifications keyed by request id. `ThreadLiveEventCoalescer.ts` merges whole-entity updates but keeps "each survivor at its original position/sequence so a resume cursor cannot skip an unrelated earlier update".

**Test rules** (`AGENTS.md`, `docs/orchestration-v2/testing-strategy.md`)

- Default test shape: real orchestrator, real adapter, real event sink and projections, with only the provider transport replaced by a recorded transcript (`expect_outbound`, `emit_inbound`, `runtime_exit`).
- Shared scenarios every provider must pass: `simple`, `multi_turn`, `queued_turn`, `turn_interrupt`, `message_steering`, `provider_thread_resume`, `tool_call_*`.
- "A test that drives the adapter with hand-written frames is a guess about the protocol."
- No sleeps or polling: drain the effect worker or await the persisted event. "A test that needs a timeout to pass is wrong." Enforced by custom lint rules (`t3code/no-wall-clock-in-tests`, `no-polling-loop-in-tests`, and others).
- "An empty queue alone does not prove the worker is idle" (drainable workers).
- A free `Replay (dev)` provider streams a recorded turn through the real pipeline and UI.
- `evals/` checks model-facing text (MCP tool descriptions, titles).

### Inferences

- The single most reusable reliability idea is "running does not prove delivery". T3 separates intent recorded, prompt accepted by the provider, and turn completed, and recovers differently from each.
- Replay transcripts as the main test input are cheap for session-board to copy: recorded hook payload sequences are its equivalent of provider frames.

---

## 6. What it does not do, and known weaknesses

### Findings

- **Outside sessions are imported, not observed.** The Welcome page scans disk for Claude, Codex and Pi conversations active in the last 30 days and imports them "best effort": first prompt plus newest messages, 200 total, no tool activity, no attachments (`docs/user/welcome-page.md`, `packages/contracts/src/agentSessions.ts`). The import is a one-time copy that you then continue inside T3. A session running in your own terminal is still invisible while it runs. The reverse door is MCP: outside agents can read and start threads (`docs/user/outside-agents.md`). This corrects the earlier note's "not adopted": there is adoption by copy, but no live view.
- **Log cannot rebuild projections.** About a day of events is kept (`ProjectionMaintenance.ts`).
- **Rate-limit drain.** Agent SDK use drained Claude's 5-hour meter about 1.7x faster until v0.1.7 (FAQ). A Cloudflare 403 on repeated Claude helper resumes is open (#36121).
- **T3 Connect.** Four-hop path (device, relay, `cloudflared` tunnel, host) with its own troubleshooting page; the author keeps Tailscale as fallback. Mobile push requires T3 Connect. LAN pairing produces `http://` links the link dialog rejects (#26840).
- **Restarts hurt.** Server updates interrupt running turns; no provider process survives the server.
- **Checkpoint cost.** 30 s git timeout in large workspaces, leaving `tmp_objdir-bulk-fsync-*` directories (#26227).
- **Per-provider honesty gaps.** Permission modes differ by provider and silently fall back to Supervised; Auto mode bugs on OpenCode and Claude (#11458, #15353); Antigravity cannot roll back its conversation, so revert is refused there.
- **Defaults.** Full access is the initial default permission mode.
- **Scale of surface.** About 1.3k open issues (from the earlier note; not re-verified) and "limited review capacity"; the maintainer cited roughly 300 open PRs in May 2026.
- **No local models**, by choice. No Intel Mac `t3` binary. Background service has no Windows support (per the blog review; UNVERIFIED in docs).
- **Worktree disk growth** needs a cleanup setting.

### Inferences

- T3's weaknesses are mostly the price of owning the process: restarts kill turns, every provider needs an adapter, and SDK-driven usage can be billed differently. session-board's hook-based observation avoids all three and gives up exact turn control in exchange.
- The import feature shows the demand for seeing outside sessions is real, and that T3 answers it only at onboarding. Live passive aggregation remains session-board's distinct ground.

---

## "Why it feels good": top 8 mechanisms, ranked

1. **An inbox, not a list.** Threads that are working fold away and return to the top only when they finish, fail or need you, and settle/snooze file them. Evidence: `docs/user/thread-sidebar.md` (Working section, snooze wake rules); it is the feature users name most ("best in the business", "works like inbox zero").
2. **One short priority ladder for status, with unseen-only dampers.** Approval > input > working > failed-unseen > plan ready > completed-unseen, so a label never lies and never nags twice. Evidence: `resolveThreadStatusPill` and `hasUnseenCompletion` in `Sidebar.logic.ts`.
3. **"Turn ended" is recorded before follow-up work.** Checkpoint, diff and PR discovery run as outbox effects and cannot keep the spinner alive. Evidence: `overview.md`, "A late checkpoint or diff must not ... keep the client showing provider work as active."
4. **The sidebar and the open thread are separate, tiny streams.** The shell row carries everything needed for status; bodies and tool output load on expansion, with byte budgets failing CI. Evidence: `performance-regressions.md`, `transferBudgetV2.integration.test.ts`.
5. **Resume instead of reload.** Sequence cursors, a five-minute detail cache, desktop keep-alive of running threads, and offline-readable caches make switching threads instant. Evidence: `connection-runtime.md`; the maintainer's stated motive was a one-second thread open elsewhere.
6. **Server-owned state that follows you.** Order, pins, read marks, snooze, settlement and pending requests live on the server, so phone and desktop agree and approvals "follow the thread". Evidence: `resolveThreadLastVisitedAt`, `thread-sidebar.md`, HN remote praise.
7. **Every action is reversible and idempotent.** Five-second Undo on parking actions, "a one-way door is a bug", and `commandId` receipts so a retry never double-sends. Evidence: `AGENTS.md`, `commands.ts`, `providers.md`.
8. **Anti-flicker and anti-jank rules written down.** 400 ms show delay and minimum hold for statuses, no continuously repainting animations, mandatory React Compiler, steady rows on mobile. Evidence: `delayedStatus.ts`, `AGENTS.md` Taste, `web-ui.md`.

---

## Portable to session-board, ranked

Reminder of the constraint: session-board does not own the agent process. It observes through hooks and acts only through tmux replies, headless resume, and permission-hook round-trips.

1. **The status ladder with unseen-only dampers.**
   - Build: one pure function from projected session state to a label, in T3's order, plus a server-stored `lastVisitedAt` per session. `Completed` and `Failed` show only when newer than the last visit; interrupted sessions never show as unread. Add a "mark unread" action.
   - Why it matters here: hooks already deliver the inputs (PermissionRequest, AskUserQuestion, Stop, errors). The ladder is what makes many sessions readable at a glance.
   - Does not carry over: `Connecting` (session-board never starts a session) and `Plan Ready` unless plan output is detectable from hooks.

2. **Working fold and "came back to you" ordering.**
   - Build: a collapsed Working section in the inbox; a session leaves the active list while working and re-enters at the top when it stops, fails or asks. Order the active list by that return time. Add snooze with wake-early on approval, question or failure.
   - Why: session-board aggregates sessions from everywhere, so its list is longer and noisier than T3's.
   - Does not carry over: T3's distinction between a dev server and awaited background work relies on adapter reports. Hooks do not say what the agent is waiting on, so treat "Stop fired" as the return signal.

3. **`responseCapability` on every pending request.**
   - Build: persist, per permission request or question, how it can still be answered: `live` (the hook process is still blocked and the board can reply), `message` (answer by tmux reply or headless resume), `not_resumable` (hook timed out or session gone, with a reason). Render the buttons from that field.
   - Why: this is session-board's sharpest failure mode. A hook round-trip has a deadline, and today's approve button can silently do nothing.
   - Does not carry over: nothing; this fits the hook model better than T3's.

4. **Separate "turn ended" from "follow-up settled".**
   - Build: project the Stop hook straight to an ended state. Run diff attribution, PR lookup and summaries as queued follow-up work with its own state, never as part of "working".
   - Why: session-board's attribution and PR checks are slow and must not hold a spinner.
   - Does not carry over: checkpoint capture.

5. **Two streams with a self-sufficient row.**
   - Build: a board stream whose row carries status inputs, a pending-request summary `{id, kind, createdAt, blocking}`, latest message preview and counts; a per-session detail stream opened on demand. Omit tool output bodies until a row is expanded. Add a payload-size test that fails when the board snapshot grows.
   - Why: session-board already has delta SSE; this bounds it as session count grows and makes the office and kanban views cheap.
   - Does not carry over: client opt-in flags for old servers; session-board ships client and hub together.

6. **Cursor resume with snapshot fallback, and "transport down" kept apart from "data stale".**
   - Build: SSE resume by sequence; replay up to a bounded number of events, otherwise send a snapshot; keep the cached board readable while disconnected and label it stale rather than "reconnecting" when the transport is fine. On tab focus, probe before reconnecting.
   - Why: laptops sleep; the board should not blank or reshuffle on wake.
   - Does not carry over: T3's mobile probe timings and relay token renewal.

7. **Receipts and a small leased outbox for outbound actions.**
   - Build: a client-generated action id on approve, deny, answer and reply; a receipts table so a double click or retry returns the first result; an outbox row per outbound action (tmux send, headless resume, hook response) with attempt count and last error, committed with the event that records the intent.
   - Why: session-board already dedups inbound events by id. Outbound actions are where a duplicate is costly: a reply typed twice into tmux.
   - Does not carry over: most effect types (turn start, steer, rollback).

8. **"Running does not prove delivery."**
   - Build: for a reply sent through tmux or headless resume, track three states: intent recorded, delivered (a later UserPromptSubmit hook from that session confirms it), turn finished. Show an undelivered reply as held, with resend, instead of assuming it arrived.
   - Why: tmux sends can land in the wrong mode or be swallowed; hooks give the confirmation signal for free.
   - Does not carry over: T3's automatic re-send of agent-authored prompts.

9. **Undo and reverse states for every filing action.**
   - Build: a five-second Undo toast on settle, snooze, archive and batch approve where reversible; a reverse action for each state.
   - Why: cheap, and it is what makes fast triage feel safe.
   - Does not carry over: undo of an approval already delivered to a hook.

10. **Status flicker damper.**
    - Build: show a status only after it has held 400 ms and keep it at least 400 ms.
    - Why: hook events arrive in bursts (PreToolUse, PostToolUse), which makes labels flap.
    - Does not carry over: nothing.

11. **Replay-transcript tests.**
    - Build: record real hook payload sequences per scenario (simple turn, permission ask, question, interrupt, crash, resume) and replay them through the real ingest, log and projections; assert on events, never on sleeps.
    - Why: hook payloads are session-board's provider protocol, and they change with agent versions.
    - Does not carry over: outbound-frame expectations.

12. **Turn-scoped diff that subtracts what Git brought in.**
    - Build: when attributing a diff to a session, exclude files changed only by a pull, merge or rebase during that turn; keep files the session edited, committed or conflict-resolved.
    - Why: improves the existing edited-files attribution after a rebase.
    - Does not carry over: exact tree snapshots; session-board must infer from tool events and reflog.

---

## Do not copy

- **Driving agents through an SDK or app-server.** It is what makes T3 blind to live outside sessions, ties it to per-provider adapters, and once changed how usage was metered.
- **Pruning the log so projections cannot be rebuilt.** Keep session-board's log replayable; compact with snapshots.
- **Hidden-ref checkpoints and revert.** They need turn boundaries T3 controls and write access to the user's repository; large workspaces hit timeouts (#26227). session-board cannot coordinate a file restore with a conversation rollback.
- **Sixty capability flags and a ten-provider matrix.** session-board has two sources; a few booleans per source are enough.
- **Full access as the default permission posture.** session-board's value is the approval round-trip.
- **A relay and tunnel service (T3 Connect).** It is the most complained-about part and its author keeps Tailscale as a fallback. Document Tailscale or LAN instead.
- **Best-effort transcript import as a substitute for observation.** T3's import drops tool activity; session-board's hooks already give a richer live record.
- **Restart-continuation machinery.** T3 needs it because its restart kills agents. A session-board restart kills nothing; it only needs to re-read state and mark stale pending requests `not_resumable`.
- **Server-enforced manual ordering combined with activity ordering.** T3 itself disables drag reordering when the Working fold is on; pick one ordering model.

---

## Sources

- Repo at commit `192ef9b`: `AGENTS.md`; `docs/internals/{overview,glossary,connection-runtime,providers,adding-a-provider,performance-regressions,web-ui}.md`; `docs/orchestration-v2/{README,core-graph-and-data-model,feature-lifecycles,testing-strategy}.md`; `docs/user/{thread-sidebar,composer,source-control,permission-modes,outside-agents,faq,usage,welcome-page,thread-migration,mobile-notifications,t3-connect-troubleshooting}.md`; `packages/contracts/src/{orchestrationV2,rpc,agentSessions}.ts`; `packages/provider-core/src/server/ProviderAdapter.ts`; `apps/server/src/orchestration-v2/{EffectOutbox,ProviderRuntimeRecoveryService,RestartContinuation,RestartBackgroundNote,ThreadLiveEventCoalescer,CheckpointService}.ts`; `apps/server/src/persistence/Migrations/{055_OrchestrationV2.ts,OrchestrationV2/Foundation.ts}`; `apps/server/src/vcs/GitVcsDriver.ts`; `apps/web/src/components/{Sidebar.logic.ts,ThreadNotificationCoordinator.tsx}`; `packages/client-runtime/src/{delayedStatus.ts,operations/commands.ts}`.
- Hacker News comments via `hn.algolia.com`, mainly stories 50366117, 50369503, 50535230, 50492141, 50491423, 50410107 (November 2026).
- Flavio Copes, "A deep dive into T3 Code", https://flaviocopes.com/t3-code (2026-08-28, updated 2026-11-18).
- Kent C. Dodds chat with Julius Marminge, https://kentcdodds.com/chats/07/08/speed-prioritization-and-maintainability-product-engineering-with-julius-marminge (2026-05-06, auto-transcript).
- Digg summaries of X posts: https://digg.com/tech/14rflh3u, https://digg.com/tech/35i2arg8.
- GitHub issue search for `pingdotgg/t3code`, open issues sorted by reactions (read 2026-11-23).
