# 跨厂商会话聚合仍是无人占领的空白

截至 2026-11-22，市面上没有任何产品能把 Claude Code 本地、Claude Code 云端、Codex 本地、Codex 云端四类会话放进同一个视图：第三方工具只看得见自己启动的会话，厂商官方应用只管自家 agent，GitHub Agent HQ 只统一经由 GitHub 运行的会话。这个品类过去十二个月剧烈洗牌，Conductor 被 Meta 收购、Vibe Kanban 与 Terragon 关停、Crystal 与 Opcode 停更、Omnara 转型，公开陈述的原因集中在"用户多为免费、找不到商业模式"，同时厂商把并行会话 UI 打包进了订阅。学术与从业者证据一致指出瓶颈在人：常态并行数是 2 到 4 个（3 个最常见），开发者最常漏掉的正是最需要立即处理的信号（agent 提问与报错）；一个让"需要关注"一眼可见的仪表盘把吞吐提高了 63%，却没有改善控制感、信任和验证难度。技术上，Claude Code 与 Codex 的 hooks 字段几乎同构，是接入"非本工具启动的本地会话"的现实公约数；Codex `app-server` 与 ACP 提供完整控制面但要求管理器自己持有进程；两家云端都没有公开的会话列表与状态 REST API。办公室式可视化有人气（Pixel Agents 约 10.3k stars）但没有任何留存或对照研究，唯一的批评性评测称其为"motivational theater"。第一版因此应当做成"只读为主、跨厂商、发现非自启会话"的关注队列，办公室视图只是同一状态机上的可选皮肤。本报告多处依赖厂商自撰对比文章、搜索摘要和个人自述，相关局限在正文逐项标注。

## 一年内六款产品退场，幸存者只看得见自己启动的会话

### 四种形态与洗牌结果

第三方产品分成四种形态：基于 tmux 或 PTY 的终端多路复用 TUI、"每个 worktree 一个工作区"的桌面应用、看板、以及远程与移动端中继。终端派的代表是 **Claude Squad**（Go TUI，每个 agent 一个 tmux session 加一个 git worktree，AGPL-3.0，2026-11-22 为 8.8k stars）([GitHub](https://github.com/smtg-ai/claude-squad))、**Agent of Empires**（Rust，TUI 加 `aoe serve` web 面板与 HTTP API，4.7k stars、283 个 open issues）([GitHub](https://github.com/njbrake/agent-of-empires))、Agent Deck（轮询 tmux pane 判断 working / waiting / done，1.3k stars）([GitHub](https://github.com/asheshgoplani/agent-deck)) 和明确不用 tmux、自管 PTY 的 ccmanager（1.3k stars）([GitHub](https://github.com/kbwo/ccmanager))。桌面派包括 Paradev（2026 年 10 月前叫 Superset）、Emdash、Nimbalyst（Crystal 的继任者）、cmux、Orca、T3 Code、Cloudroom、Sculptor。远程中继的代表是 **Happy**（24.8k stars、691 个 open issues，`happy` CLI 包裹 Claude Code 与 Codex，经加密中继与 APNs/FCM 推送在手机上续接会话）([GitHub](https://github.com/slopus/happy))。

洗牌的结果是：**Conductor** 于 2026-11-04 由创始人确认被 Meta 收购，注册与下载关闭，Conductor Cloud 于 2026-11-13 只读、2026-11-20 关停，本地应用维护到 2027 年初 ([SiliconANGLE](https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/))。**Vibe Kanban** 的母公司 Bloop 于 2026-04-10 宣布关停，理由是有数千日活但多为免费用户，"we couldn't find a business model that we could get excited about" ([Vibe Kanban shutdown post](https://vibekanban.com/blog/shutdown))；它在 2026-11-22 仍有 28.8k stars，README 开头写着 "Vibe Kanban is sunsetting." ([GitHub](https://github.com/BloopAI/vibe-kanban))。Terragon（云端后台 agent 编排）留下一份日期为 2026-01-16 的关停快照，未见公开原因，且该通知是经第三方镜像读到的 ([terragon-oss mirror](https://relatedrepos.com/gh/terragon-labs/terragon-oss))。Omnara 的仓库于 2026-02-02 归档并转向基于 Claude Agent SDK 的语音优先平台 ([GitHub](https://github.com/omnara-ai/omnara))，据一篇竞品作者的评测，重写的原因是包裹 Claude Code CLI 的方案"became unmaintainable"；同一来源称 Crystal 于 2026 年 2 月弃用、Opcode 自 2025 年 10 月起无提交 ([DEV, agentiknet](https://dev.to/agentiknet/9-coding-agent-orchestrators-honestly-compared-dated-sourced-and-one-of-them-is-mine-3kpk))。

这些退场指向同一个判断：付费的单厂商或纯本地编排器不成立。Anthropic 在 2026-04-14 为并行工作重做了 Claude Code 桌面应用，距 Bloop 的公告只有四天，两家厂商如今都把并行会话应用打包进订阅 ([Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents))。幸存者要么是个人维护的免费开源工具，要么靠卖算力（Cloudroom、Paradev cloud、cmux 云 VM）。这是基于 Bloop 自述与市场格局的推断，Terragon 和 Conductor 的真实动机并无一手陈述。

### 状态检测的三代方案，各有盲区

第三方工具获取"会话在干什么"的方式经历了三代。第一代是屏幕抓取：Agent Deck 轮询 tmux pane 并允许用户自定义匹配模式，还必须改写 tmux 的按键编码才能让 Shift+Enter 到达 Claude Code ([Agent Deck troubleshooting](https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/skills/agent-deck/references/troubleshooting.md))。ccmux 的架构文档点明了这条路的上限：模式匹配会漏掉滚出屏幕的提示，而 **Claude Code 只在用户处理完权限提示之后才把该 tool_use 写入 transcript**，所以"正在等权限"无法单凭 transcript 推出 ([ccmux architecture doc](https://raw.githubusercontent.com/epilande/ccmux/main/docs/architecture.md))。第二代是 agent 生命周期 hooks：Paradev 把 hooks 装进每个 agent 的配置，但自己承认状态只对经 Paradev 启动的 agent 有效、部分 agent 只上报完成 ([Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions))。第三代是经 SDK 或 daemon 直接持有进程（Omnara 的重写、Happy 的 harness、Paseo 的 daemon）。每进一代准确度上升，看见"别处启动的会话"的能力下降。

其余反复出现的问题同样是结构性的。依赖 tmux 意味着 Claude Squad、Agent of Empires、Agent Deck 在 Windows 上只能走 WSL。worktree 隔离文件，不隔离进程，也不防止合并冲突 ([Paradev compare page](https://paradev.com/compare/manage-multiple-coding-agent-sessions))；一次十 agent 的实验产生了三处合并冲突，全部落在同一个共享 CLI 文件上 ([Bernstein blog](https://bernstein.readthedocs.io/en/latest/blog/ten-agents-one-release/))。worktree 管理器让工作流以工具为中心，已有的 tmux session 难以复用，工具主导的合并与清理会和既有 Git 习惯冲突 ([Zenn, maedana](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en))。ccmanager 的会话恢复只重跑命令，不恢复输出与对话 ([GitHub](https://github.com/kbwo/ccmanager))；Superset 安装后 1.4 GB 且无法导入已有的 Claude Code 或 Codex 对话 ([Cloudroom blog](https://www.cloudroom.dev/blog/best-apps-multiple-claude-code-codex-agents))。在调研范围内，没有任何产品把"需要关注"做成跨会话的排序队列，它只是每行一个徽标，最多加一条推送。

证据局限需要说明。本节大量对比结论出自厂商自撰文章（Nimbalyst、Paradev、Cloudroom、agentiknet 的作者本身也有竞品）。Emdash、Orca、Herdr、T3 Code、Cloudroom、Sculptor 只通过二手或厂商来源了解，Herdr 的"超过 42,000 stars"是单一未核实说法。Paradev 的许可证（自称 MIT，他方称 Elastic License 2.0）和 Paseo 的许可证（AGPL-3.0 对 Apache-2.0）存在未解决的矛盾。调研未取得 GitHub issues、Hacker News 或 Reddit 的直接用户原话，"Claude Squad 状态检测不准"这类具体指控未经验证。

### 官方方案：各家收敛到同一套状态，却不互通

Anthropic 没有单一看板，而是至少四份互相重叠的会话列表。终端里的 agent view（`claude agents`，research preview）只列本地后台会话，状态为 Working / Needs input / Idle / Completed / Failed / Stopped，并把 PR 状态作为行的一等属性；在别的终端里打开的交互式会话要先转入后台才出现，子 agent 与 teammate 不单独成行 ([Agent view docs](https://code.claude.com/docs/en/agent-view.md))。claude.ai/code 的侧边栏列云端会话，本地会话只有逐个 opt-in Remote Control 才会出现在那里 ([Remote Control docs](https://code.claude.com/docs/en/remote-control.md))。Projects 的 Overview 又换了一套分桶：Ready for review / Waiting on you / Working / Idle，而且线程里的权限提示不能在项目对话里代答，"Telling Claude in the project conversation to go ahead doesn't reach it" ([Projects docs](https://code.claude.com/docs/en/claude-projects.md))。本地与云端的交接是不对称的拷贝：CLI 只能用 `--teleport` 把云端会话拉到终端，终端得到的是副本，之后的工作不回流云端 ([Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web))。文档还写明所有并行机制的 worker 都必须是 Claude 会话 ([Run agents in parallel](https://code.claude.com/docs/en/agents.md))。

OpenAI 的单位是 thread，桌面应用提供 Local、Worktree、Cloud 三种模式，Local 与 Worktree 之间的 Handoff 会连对话带代码一起移动，默认保留最近 15 个 Codex 管理的 worktree 并在删除前存快照 ([Worktrees docs](https://learn.chatgpt.com/docs/environments/git-worktrees.md))。这比 Anthropic 的拷贝式 teleport 干净，但本地到云端仍是另起一个云任务。社区帖子里用户还在要求区分"仅本地任务"和"跨设备同步" ([Community request](https://community.openai.com/t/codex-desktop-should-clearly-distinguish-local-only-tasks-from-cross-device-sync/1393084))。

**GitHub Agent HQ 是唯一的官方多厂商会话列表**：Claude 与 Codex 自 2026-02-04 起在 Agent HQ 公开预览 ([GitHub blog](https://github.blog/news-insights/product-news/pick-your-agent-use-claude-and-codex-on-agent-hq/))，Agents tab 可查看在该仓库启动的所有活跃会话并中途 steer ([GitHub docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management))。但它按场所（仓库与编辑器）统一，没有来源表明在 claude.ai/code 或 ChatGPT 里启动的厂商原生云会话会出现在那里。VS Code 在 2026 年 8 月加入"Continue external agent sessions"，可以查看并续接在其他应用里创建的 Copilot 或 Claude 会话，未提及 Codex ([GitHub changelog 2026-08-31](https://github.blog/changelog/2026-08-31-github-copilot-in-vs-code-august-2026-releases/))。Cursor 3（2026-04-02）是单厂商内统一得最完整的：本地与云端 agent 进同一个侧边栏，支持双向交接 ([Cursor blog](https://cursor.com/blog/cursor-3))。Google 则把一切并入 Antigravity；据媒体报道 Jules 自 2026-11-11 只读、2026-12-31 关停，这些日期来自媒体而非官方 changelog ([TechRadar](https://techradar.com/pro/google-kills-off-jules-its-ai-coding-agent-which-promised-to-do-all-the-jobs-you-didn-t-want-to))。

各家的状态词汇已经收敛到四到六个关注状态，并且都把"PR 已开"当作评审信号，通知的共同做法是在"需要输入"和"完成或失败"时触发、用户正在看时抑制（例如 VS Code 默认只在窗口失焦时通知）([VS Code 1.136](https://code.visualstudio.com/updates/v1_136))。厂商留下的空白有六处：没有跨厂商云视图；本地与云端同列只有 Cursor 做到；交接后任务没有共享 ID；嵌套工作不可见；审批必须回到具体会话里答；没有共享的状态 schema。本节同样有局限：Anthropic 工程博客、Codex 应用功能页、VS Code 多个版本说明、Devin、Zed、Warp 的内容只读到搜索摘要；笔记中没有找到任何 Anthropic 来源提及名为"FleetView"的产品，应视为不存在或未验证；Amp、Factory、JetBrains 未调研。

## 常态是三个并行会话，最常漏掉的恰是最紧急的信号

### 直接研究：看见"何时介入"不等于能"判断产出"

第一批直接研究并行监督的工作出现在 2026 年。Microsoft Research 的 ParallelPilot（arXiv 2609.33113，预印本，未经同行评审）访谈了 14 位已在并行使用 agent 的开发者：**三个并发会话是最常见的配置（14 人中 8 人），多数人跑 2 到 4 个**，历史最高在 3 到 8 之间，只有一人为小而独立的 issue 扇出约 20 个云会话。全部 14 人都报告了"协调与监控税"：忘了对哪个会话说过什么、专注一个线程时漏掉别处的提醒。触发介入的信号有四种，完成、请求澄清、报错、异常延迟，其中澄清请求和报错需要立即处理，却是"participants most reliably missed"的信号，参与者形容这是"wasting my agent's time" ([arXiv 2609.33113](https://arxiv.org/abs/2609.33113))。

该研究的对照评估（N=16，每个条件六张短工单）给出了目前最硬的数字：使用状态卡片仪表盘后，完成工单 5.69 对 4.19，**吞吐 0.445 对 0.272 张/分钟（+63%）**，峰值并发 3.25 对 2.31，"注意到 agent 完成、停滞或需要输入"的评分从 3.63 升到 6.19（满分 7）。同样重要的是它的零结果：感知控制（3.94 到 4.31）、介入成功感、对产出的信任、委派信心都没有显著改善；问到哪个条件下更容易验证产出，9 人说没区别。作者的结论是抽象必须支持"re-engagement"，即从状态摘要到代码、决策与证据的短路径。它的状态模型有一个值得照搬的细节：agent 发出完成消息后任务**不会**进入 Done，而是提示开发者先验证，把"agent 自称完成"和"人已接受"分成两个状态 ([arXiv 2609.33113](https://arxiv.org/abs/2609.33113))。这项研究的局限是工单短、实验室环境、参与者大多是并行编码的新手。

KAIST 与 CMU 的研究（arXiv 2609.24234，在审）观察 19 位资深开发者，把 Sheridan 的五阶段监督控制重构为七阶段：Plan、Monitor、Wait、Review、Teach、Manual Fix、Update Assets。开发者明确把 Wait 和 Monitor 分开，Review 是 Sheridan 模型里没有的新阶段并且自带回环；在 1,114 条 Reddit 证据引文中 Review 最多（366 条）([arXiv 2609.24234](https://arxiv.org/abs/2609.24234))。Anthropic 对 Claude Code 日志的分析显示了监督方式随经验的迁移：新用户约 20% 的会话全自动批准，到约 750 个会话时超过 40%，而打断率反而从约 5% 的回合升到约 9%，即从逐步审批转向"监控并介入"。Claude 自己停下的原因里，35% 是让用户在方案间做选择，11% 是行动前请求批准；人打断的原因里 17% 是 Claude "slow, hanging, or excessive"；在 998,481 次工具调用的公开 API 样本中只有 **0.8% 不可逆** ([Anthropic](https://www.anthropic.com/research/measuring-agent-autonomy))。这是公司自己的研究帖。

警报本身不够。在一项让 100 多位开发者与暗中破坏的 agent 协作约 5 小时的实验里，94% 没有发现破坏（NeurIPS 列表写 95%）；即使显示了正确的监控警报，破坏仍在 16 个会话中的 9 个得手 ([arXiv 2606.05647](https://arxiv.org/abs/2606.05647))。该文仅核对了摘要，细节来自搜索摘要。

### 打断的时间价值与监督跨度的上限

经典打断研究给出了每次打断的代价量级。Iqbal 与 Horvitz 的现场日志研究发现，提醒引发的切换平均占用近 10 分钟，之后还要 10 到 15 分钟才回到被挂起的任务，27% 的挂起超过两小时才恢复；被遮挡超过 75% 的窗口恢复得明显更慢，设计建议是把挂起的任务留在可见、可扫视的区域 ([Iqbal & Horvitz 2007](https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf))。这些数字能否迁移到"主任务本身就是监督"的场景，没有人测过。

从 agent 一侧看，提问的价值随时间急剧衰减。PwC 的预印本在轨迹的 10% 到 90% 处强制注入澄清（6,000 多次运行）：**目标澄清在 10% 处注入时 pass@3 为 0.78，不澄清为 0.40，到 70% 处回落到 0.39**；任何类型的澄清拖过轨迹中点都比完全不问更差。而模型的自然行为是 72% 的首次提问落在轨迹的 25% 到 50% 之间，对目标类问题已经太晚 ([arXiv 2605.07937](https://arxiv.org/abs/2605.07937))。该研究用的是模拟用户和基准任务，没有计入人的打断成本。

一个人能管几个 agent，人机交互文献有可用的公式。Olsen 与 Goodrich 定义 fan-out = (neglect time + interaction effort) / interaction effort，并把交互成本拆成选择下一个对象、获取上下文、规划、表达四部分，其中"The context acquisition problem is probably the largest contributor to an upper bound on fan-out"。他们还警告，自动计算的"关注需求"指标如果质量差，会比轮询更糟，自动选择还会因为用户不知道为何被选中而增加上下文获取时间 ([Olsen & Goodrich 2003](https://faculty.cs.byu.edu/~mike/mikeg/papers/OlsenGoodrichPERMIS2003.pdf))。Cummings 与 Mitchell 在无人机监督中加入等待时间后，预测容量最多下降 67%，主因是态势感知丧失 ([MIT DSpace](https://dspace.mit.edu/handle/1721.1/90280))。尚无论文为 LLM 编码 agent 测量过这些参数或验证该公式。

失败分类学则告诉监控器该检测什么。MAST 标注了 1,642 条多 agent 轨迹：最常见的失败是步骤重复（15.7%），其次是推理与行动不一致（13.2%）和不知道何时终止（12.4%），验证类失败合计约 24% ([arXiv 2503.13657](https://arxiv.org/html/2503.13657v3))。这些比例来自基准任务上的多 agent 框架，迁移到人监督下的单个编码 agent 是假设。生产力测量本身也在失效：METR 2025 年的 RCT 发现资深开源开发者用 AI 后慢了 19%，却自认为快了约 20% ([METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/))；2026-02-24 的更新指向加速，但 METR 称其为"very weak evidence"，并说明开发者并发使用多个 agent、等待时去做别的事，使任务耗时无法测量 ([METR](https://metr.org/blog/2026-02-24-uplift-update/))。

### 从业者的共识：评审速率决定 agent 数量

资深用户的说法与论文吻合，但全部是自述，不是测量。Simon Willison 写道，"the natural bottleneck on all of this is how fast I can review the results" ([Simon Willison, 2025-10-05](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/))。Armin Ronacher 把 PR 评审称为瓶颈，主张"backpressure and load shedding"，并希望有一条看得见的队列 ([Armin Ronacher, 2026-02-13](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/))。Addy Osmani 的个人上限是"somewhere around three to four threads"，建议批量评审而不是逐个查看 ([Addy Osmani, 2026-04-07](https://addyosmani.com/blog/cognitive-parallel-agents/))。高端是 Claude Code 作者 Boris Cherny：据 InfoQ 报道，他在终端标签页里跑五个本地会话，另有 5 到 10 个在 Anthropic 网站上，其中"10-20% of those sessions are abandoned"；他称给 agent 一个反馈回路能把结果提高"by a factor of 2–3"，这是他的估计而非测量 ([InfoQ, 2026-01-10](https://www.infoq.com/news/2026/01/claude-code-creator-workflow))。Cherny 的原帖未被打开，各二手来源的会话数不一致，他的通知方式只见于 LinkedIn 摘要。厂商发布的操作建议方向相同：Anthropic Projects 文档建议先让协调者提议线程、一次只跑几个 ([Projects docs](https://code.claude.com/docs/en/claude-projects.md))。没有任何厂商公布过一个人能监督多少并行 agent 的量化指引。

## hooks 是跨厂商公约数，云端状态只能间接推断

### Claude Code 本地：三条观察通道，可靠性依次递减

hooks 是本地 Claude Code 最好的推送式信号。文档列出 33 个事件，所有事件的 stdin JSON 都带 `session_id`、`transcript_path`、`cwd`，并支持原生的 `http` 处理器把同一份 JSON POST 到某个 URL ([Hooks reference](https://code.claude.com/docs/en/hooks))。配置写在 `~/.claude/settings.json` 就对本机所有项目生效。一组最小的状态机事件是 `SessionStart`、`UserPromptSubmit`、`Notification`（matcher 含 `permission_prompt`、`idle_prompt`、`elicitation_dialog`、`agent_needs_input`）、`PermissionRequest`、`Stop`、`StopFailure`、`SessionEnd`。`Stop` 的载荷带 `background_tasks` 与 `session_crons`，文档说明它们用来区分"会话完成"和"暂停等待后台工作唤醒" ([Hooks reference](https://code.claude.com/docs/en/hooks))。

**`PermissionRequest` hook 是文档中唯一能从外部以程序方式回答正在运行的交互式会话权限提示的途径**：command 或 http 处理器返回 `hookSpecificOutput.decision.behavior` 为 `allow` 或 `deny` 即可 ([Hooks reference](https://code.claude.com/docs/en/hooks))。让这个 hook 阻塞（默认超时 600 秒）等用户在管理器里点批准，是从文档字段推出的做法，文档本身没有描述这一模式。有两点会影响实现：文档写明"`SessionStart` supports only `command` and `mcp_tool` hooks"，所以会话注册这一步不能只靠 http 处理器；HTTP hook 的响应处理（状态码语义、重试）以及 `Notification`、`SessionEnd` 等事件所在的受限处理器列表的确切规则，本次未读到，属未验证。硬杀（SIGKILL、崩溃、断电）不会触发 `SessionEnd`，存活判断需要第二信号。社区实践还提示 `Notification` 的 `permission_prompt` 在 Claude Desktop 里触发不可靠（单一作者自述）([dev.to, 2026-05-13](https://dev.to/zubrock/stop-missing-claude-code-permission-prompts-add-sound-notifications-in-10-seconds-1b7a))，官方文档也承认其时机在终端与其他宿主间不同 ([Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide))，所以 `PermissionRequest` 与 `Stop` 是更稳的基础。

第二条通道是 `claude agents --json --all`。它返回 `state`（`working`、`blocked`、`done`、`failed`、`stopped`）、进程存活时的 `status`（`busy`、`waiting`、`idle`）以及 `waitingFor`（`permission prompt`、`input needed` 等），`kind` 可以是 `interactive` 或 `background`；文档让脚本轮询这个命令，不要解析 `~/.claude/jobs/` ([Agent view](https://code.claude.com/docs/en/agent-view))。它的状态最丰富，但处于 research preview。第三条是 transcript：位置有文档（`~/.claude/projects/<project>/<session-id>.jsonl`），格式则被明确声明为内部格式，"scripts that parse these files directly can break on any release" ([Manage sessions](https://code.claude.com/docs/en/sessions))。

对管理器自己启动的会话，`claude --bg` 给出受监管、可 attach、可列出的会话；`claude -p --output-format stream-json` 或 Agent SDK 给出完整事件流和 `canUseTool` 权限回调，代价是这类会话不出现在交互式选择器里 ([Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions))。文档里没有通用的"向别人的交互式 TUI 会话注入消息"的 API。Remote Control 只出站 HTTPS、经 Anthropic API 中继，仅支持 claude.ai 订阅登录，没有公开的第三方协议 ([Remote Control](https://code.claude.com/docs/en/remote-control))；第三方只能启动它并深链到 claude.ai/code。OpenTelemetry 导出每条指标都带 `session.id`，适合计量成本，不适合做实时状态源 ([Monitoring](https://code.claude.com/docs/en/monitoring-usage))。

### Codex 本地：hooks 与 Claude 同构，app-server 是最完整的控制面

Codex 现在有三层。遗留的 `notify` 只有 `agent-turn-complete` 一种事件 ([Advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced))。hooks 系统默认开启，14 个事件，stdin 字段名与 Claude Code 相同（`session_id`、`transcript_path`、`cwd`、`hook_event_name`），`PermissionRequest` 的输出也是 `hookSpecificOutput.decision.behavior` ([Codex hooks](https://learn.chatgpt.com/docs/hooks))。所以一个 hook 接收脚本加少量分支就能同时服务两家。差异在于 Codex 的处理器只有 `command` 和 `mcp_tool`，没有 `http`，没有 `Notification` 与 `StopFailure` 事件，`SessionEnd.reason` 目前只有 `other`，非托管 hooks 还需要基于哈希的审查与信任。

`codex app-server` 是 JSON-RPC 协议，提供 `thread/list`、`thread/read`、`thread/start`、`thread/resume`，`turn/start`、`turn/steer`、`turn/interrupt`，显式的线程状态（`notLoaded`、`idle`、`systemError`、`active`，后者可带 `waitingOnApproval` 这类 `activeFlags`），以及服务端发起的审批请求如 `item/commandExecution/requestApproval` ([App server](https://learn.chatgpt.com/docs/app-server))。它是最丰富的控制面，但 CLI 参考把 `codex app-server`、`codex cloud`、`codex remote-control` 都标为 experimental，同时 `codex mcp-server` 已被移除 ([CLI reference](https://learn.chatgpt.com/docs/cli/reference.md))。`codex exec --json` 输出 `thread.started`、`turn.started`、`turn.completed`、`turn.failed` 等 JSONL 事件，标为 stable ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode))。未验证项较多：rollout 文件的常见路径 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 未从一手文档确认；Codex SDK 页面 404，`startThread()` 等细节全部未验证；`thread/status/changed` 的载荷形状和完整 `activeFlags` 列表未读到；第二个 app-server 客户端能否接管正在运行的交互式 Codex TUI 尚未确立。

### 云端：能启动、能发消息，不能列出与查状态

Claude Code 云端没有文档化的公开 REST API 可以列出会话或读取状态与事件。有文档的程序化入口是：`claude --cloud "<task>"` 创建会话；`claude -p "msg" --cloud <session-id>` 把消息排入已有会话并立即退出，`--output-format json` 返回 `{ok, session_id, url}`；`--teleport` 把会话拉到本地 ([Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web))；以及 research preview 的 scheduled tasks `/fire` 端点，响应里带 `claude_code_session_id` 与 `claude_code_session_url`，文档写明它"is not part of the Claude Platform API surface" ([Scheduled tasks](https://code.claude.com/docs/en/routines))。状态只能间接获得：云端会话默认把工作推到 `claude/` 前缀的分支，所以 GitHub 上的分支、PR 与 checks 是外部信号；或者在仓库里提交一个 http hook 从会话内部往外推，但云端网络默认受限，目标主机须在允许列表内。这是一个"未发现"的结论，不是"不存在"的证明：Claude Platform API 参考中的相关页面未被读到。

Codex 云端的情况类似。`codex cloud list --json`（`--limit` 1 到 20，支持 `--cursor`）是找到的唯一有文档的机器可读枚举方式，`codex cloud exec --env <id>` 启动任务，`codex apply` 把云任务的最新 diff 应用到本地 ([CLI reference](https://learn.chatgpt.com/docs/cli/reference.md))。`list --json` 的 JSON schema 与状态取值没有文档，`codex cloud status|diff` 子命令只见于二手来源，均未验证；也未发现公开的 Codex 云任务 REST API。

### 开放协议：ACP 管线路，A2A 借词汇

ACP（Agent Client Protocol）最适合统一驱动本地编码 agent：agent 侧方法包括 `session/new`、`session/load`、`session/resume`、`session/list`、`session/prompt`、`session/cancel`，客户端侧有 `session/request_permission` 与 `session/update` ([ACP schema](https://agentclientprotocol.com/protocol/schema))，注册表里列有 `@agentclientprotocol/claude-agent-acp` 与 `@agentclientprotocol/codex-acp` 两个适配器 ([ACP agents overview](https://agentclientprotocol.com/overview/agents))。它有两个弱点：没有会话级的状态枚举，状态要从"prompt 在途、有待处理的权限请求、最近的 `StopReason`"推导；ACP 客户端持有 agent 子进程，所以看不到用户在厂商 TUI 里启动的会话。哪些 ACP 方法属于稳定版未能确认。A2A 1.0.0 的 `TaskState` 是最现成的状态词汇，它区分 `INPUT_REQUIRED` 与 `AUTH_REQUIRED` 并有 `REJECTED` ([A2A specification](https://a2a-protocol.org/latest/specification/))，但没有证据表明 Claude Code 或 Codex 原生暴露 A2A 端点。交互式 CLI 还需要一个 A2A 没有的状态：idle，即回合结束但会话仍开着、可续接。OpenTelemetry GenAI 语义约定已迁到新仓库，两家 agent 都用自己的命名空间（`claude_code.*`、`codex.*`），未见发出 `gen_ai.*` agent span。

### 各接入面的能力等级

下表是本报告对各接入面的综合评级，等级划分是基于上文引用的文档能力所做的归纳，不是任何来源的既有分类。L1 指能发现会话，L2 指能得到归一化状态，L3 指能可靠得到"需要人"的信号，L4 指能回复或审批，L5 指能启动与完整驱动。

| 接入面 | 可达等级 | 主要机制 | 关键限制 |
|---|---|---|---|
| Claude Code 本地，非本工具启动 | L1 到 L4（审批），不含自由发消息 | 用户级 hooks；`claude agents --json` 轮询；transcript 兜底 | `SessionStart` 不支持 http 处理器；agent view 为 research preview；transcript 格式不稳定；无向他人 TUI 注入消息的 API |
| Claude Code 本地，本工具启动 | L5 | `claude --bg`；`claude -p` 的 `stream-json`；Agent SDK `canUseTool` | `-p` 与 SDK 会话不进交互式选择器；两个进程续接同一会话会丢消息 |
| Codex 本地，非本工具启动 | L1 到 L4（审批） | hooks（仅 `command` 处理器）加 `PermissionRequest` | 无 http、无 `Notification`；hooks 需信任审查；rollout 路径未验证 |
| Codex 本地，本工具启动 | L5 | `codex app-server`；`codex exec --json`；ACP 适配器 | app-server 标为 experimental；能否接管他处的 TUI 未确立 |
| Claude Code 云端 | L5 的启动与发消息，L2 与 L3 仅靠推断 | `claude --cloud`；`-p --cloud <id>`；`/fire`；GitHub `claude/` 分支与 PR | 无公开的列表与状态 API；权限与提问状态不可观测；`/fire` 为 research preview |
| Codex 云端 | L1 与粗粒度 L2（轮询），可启动 | `codex cloud list --json`；`codex cloud exec`；`codex apply` | 整体 experimental；JSON schema 未验证；无推送 |

## 办公室视图有人气没证据，看板已收敛为四列

### 像素办公室：同一套配方，同一个批评

把 agent 画成办公室里的角色，这个品类真实存在而且有人气。**Pixel Agents** 约 10.3k stars，默认"hooks mode"由 hook 脚本接收 `SessionStart`、`PreToolUse`、`PermissionRequest`、`Stop` 等事件，回退模式扫描 `~/.claude/projects/` 下的 JSONL；角色"walk to their desks, sit down, type when they're editing files, read when they're searching"，需要输入、需要权限或回合结束时冒出气泡并可选提示音；目前只支持 Claude Code，Codex 等在路线图上 ([GitHub](https://github.com/pablodelucca/pixel-agents))。它早期是纯 transcript 监听，2026 年内转向 hooks 优先 ([UCStrategies, 2026-02-25](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/))，这说明 transcript 启发式对用户最在意的两个状态（需要权限、已完成）不够用。Vibecraft（1.5k stars，Three.js）把工具映射到工位，Read 对书架、Bash 对终端、Task 对传送门，并让需要输入或完成的区域脉动发声；它同时是控制器，能从浏览器启动 tmux 会话并发 prompt，但不支持 Windows ([GitHub](https://github.com/Nearcyan/vibecraft))。Star-Office-UI 走另一条路，状态由 agent 自己上报（`set_state`），六个状态映射到三个房间，`error` 去"Bug Corner"；它在 2026-03-04 不得不加入过期状态自动归 idle 的修复，可见自报状态会因 agent 忘记上报而过期，而且它的美术资源限非商业使用 ([README](https://raw.githubusercontent.com/ringhyacinth/Star-Office-UI/master/README.en.md))。

找到的唯一一篇批评性评测（单一作者的观点）称 Pixel Agents 是"motivational theater"，因为"you still can't stop an agent from doing something stupid" ([UCStrategies, 2026-02-25](https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/))。回应这一批评的项目都在加控制：据一份二手演讲摘要，AgentCraft 提供一个按键循环跳到下一个需要输入的 agent，其作者说"it's pretty exhausting to keep looking at what the agents are doing in the granularity of what files are they using"；同一摘要也把可视化证据是否带来"false confidence"列为未解问题 ([Sean Weldon summary](https://www.sean-weldon.com/blog/2026-10-01-i-turned-coding-agents-into-a-strategy-game-ido-salomon-agentcraft))。Pixel Agents 自己的路线图也包含"agents picking up tasks from a board"。重度隐喻还有前车之鉴：Steve Yegge 的 Gas Town 因陌生的角色命名屡遭抱怨，据 Yegge 本人的说法（经 Simon Willison 转引），它在 Opus 4.7 的行为变化后"effectively burned down" ([Simon Willison, 2026-08-04](https://simonwillison.net/2026/Aug/4/steve-yegge/))。

用户设想的"agent 走过来向你汇报"在调研到的项目中都没有实现，最接近的是气泡、脉动区域和跳转热键。它是新的映射，也因此未经检验。学术证据同样单薄：一项 2004 年的研究发现，抽象图形化显示 InfoCanvas 在 8 秒一瞥后的回忆量显著高于门户网页和文本，但参与者总体上更偏好门户网页 ([GI 2004](https://graphicsinterface.org/proceedings/gi2004/gi2004-15))；而在 agent 监督领域，被证明有效的是朴素的状态卡片加闪烁提示（ParallelPilot 仪表盘有用性 6.88/7）和每会话一个红点（Magentic-UI 的参与者认为清晰）([arXiv 2507.22358](https://arxiv.org/html/2507.22358v1))。没有任何可视化工具的留存、日活或长期使用数据，也没有针对 agent 办公室视图的 HCI 研究、可用性测试或 A/B 数据；没有项目记录无障碍支持或 N 个 agent 下的渲染成本。"新鲜感过后是否仍有用"目前只有观点，没有证据。

### 看板：卡片是任务，Review 列装着两种等待

面向 agent 的看板已经收敛：四列（backlog、in progress、review、done 或 trash），一张卡片一个任务并带自己的 worktree，生命周期事件自动移卡，发布与丢弃由人手动操作。Cline Kanban（research preview）中，卡片在被阻塞或完成时进入 Review，该列同时装着"等用户批准"的任务和已完成的任务，只有后者显示 Commit 与 Open PR 按钮；Trash 归档卡片并清理 worktree ([azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban))。列名与移卡规则出自这一篇第三方演示，Cline 官方文档没有命名各列；官方文档确认卡面显示 agent 的"latest message or tool call" ([Cline docs](https://docs.cline.bot/kanban/core-workflow.md))，并注明它依赖绕过权限的实验特性 ([Cline docs](https://docs.cline.bot/kanban/overview))。Linear 的做法是从 agent 最近发布的活动推导会话生命周期，不要求 agent 自己设置状态 ([Linear developer docs](https://linear.app/developers/agent-interaction))。

Cline 把"十秒钟的权限点击"和"三十分钟的代码评审"放进同一列，两者看起来一样；在列内区分它们是显而易见的改进，但这是推断，不是已报告的用户抱怨。那位博主的体会概括了看板的价值和上限：痛点是"realizing an hour later that a task had already finished long ago"，而"The cognitive load that comes with parallel work doesn't disappear entirely" ([azukiazusa.dev](https://azukiazusa.dev/en/blog/cline-kanban))。Vibe Kanban 的结局说明的是商业可行性，不是模式本身：它是本次调研中 stars 最多的项目之一，其 UI 模型被 Cline 继承。

通知方面，社区的普遍做法是把 `Notification`、`PermissionRequest`、`Stop` hooks 接到声音、桌面通知和 ntfy 或 Pushover 的手机推送上，有的工具在手机上提供 Approve / Always Approve / Deny 按钮，失败或超时则返回 `{"behavior":"ask"}` 让终端提示照常出现 ([claude-remote-approver](https://github.com/yuuichieguchi/claude-remote-approver))。主要的抱怨是无声的权限提示："I kept losing 5-10 minutes every time because I'd miss a permission prompt"（单人自述，其引用的 GitHub issue 未被核实）([dev.to, 2026-05-13](https://dev.to/zubrock/stop-missing-claude-code-permission-prompts-add-sound-notifications-in-10-seconds-1b7a))。"通知疲劳"作为明确的抱怨没有在一手来源中找到，它是从认知负荷类文章推断的。

## 第一版应是只读优先的跨厂商关注队列

### 真正的需求是把人的注意力送到对的会话

综合四条证据线，真实需求是"知道此刻哪个会话需要我，并以最短路径处理它"，统一管理只是手段。支撑这个判断的事实是：被漏掉最多的是提问与报错；吞吐的限制是评审；上下文获取是监督跨度的最大上界；提高可见性能提高并发，却不改善判断。所以第一版的核心对象应当是一条跨厂商、跨运行位置的关注队列。队列按阻塞程度排序而不是按时间：权限与提问让 agent 空转，价值随时间衰减，值得即时而轻量的提示；"完成待评审"不阻塞任何东西，适合批量。每个条目要说明它为什么排在这里，并提供 dismiss、snooze、放弃，否则按 Olsen 与 Goodrich 的警告，一个差的排序指标比轮询还糟。Cherny 自述 10% 到 20% 的会话被放弃，所以丢弃应是廉价的一等操作。

状态机方面，建议以 A2A `TaskState` 为词汇基础，加上交互式 CLI 需要的 idle，并把"需要输入"拆成权限与提问，把"agent 自称完成"与"人已接受"分开。评审就绪的信号直接取自 PR，这是各家厂商的共同做法。跨厂商的连接键用 repo、branch、PR，因为厂商之间没有共享的会话 ID，连 Anthropic 自家的 teleport 都会把一个任务变成两个分叉的会话。每张卡片从摘要到 diff、测试证据、计划的距离必须是一次点击，这是 ParallelPilot 的零结果直接指向的设计要求。产品自身可以记录比墙钟时间更好的指标：每个被接受变更消耗的人类注意力分钟数、agent 等人的空转时间、从自称完成到被接受的时间。设计容量按每人 3 到 15 个并发会话、其中 3 到 5 个同时索要注意力来定。

### 空白在"发现非自启会话"，这也是厂商没有动力填的位置

空白机会是只读为主的聚合器：发现它没有启动的本地 Claude Code 与 Codex 会话，再加上 claude.ai/code 与 Codex 云任务。第三方工具在架构上只看自己启动的会话；厂商应用只管自家；GitHub 按场所统一。跨厂商聚合是厂商没有动力去做的事，而 hooks 是这里唯一原则上能报告"在工具之外启动的会话"的机制，因为它装在 agent 自己的配置里。只观察不接管还回避了被引用最多的两条采用阻力：工作流锁定，以及强加 tmux 与 worktree。代价是不提供隔离。

这个机会有一处硬边界必须如实告知用户：云端的"需要权限"和"在提问"状态经由文档化接口不可观测，第一版对云会话只能做到列出（Codex 可轮询，Claude 需要用户经本工具启动或从 GitHub 分支与 PR 反推）、深链跳转、发后续消息，以及以 PR 为准的评审状态。

### 要避开的坑

第一，不要解析屏幕，也不要把 transcript 当主信号；transcript 格式被官方声明为不稳定，并且推不出权限等待。第二，不要包裹 CLI；Omnara 因此重写。第三，不要在第一版强加 worktree 或 tmux 工作流。第四，不要把商业模式押在单厂商或纯本地编排上，Bloop 有数千日活仍然关停；同时要预期厂商继续上移，agent view、Projects、VS Code 的外部会话续接都在向这个方向走。第五，审批通道必须在 agent 写不到的带外位置：Magentic-UI 的红队测试显示，关闭缓解措施后，prompt injection 导致了 agent 自我批准 ([arXiv 2507.22358](https://arxiv.org/html/2507.22358v1))；远程审批在任何失败时都应回落到本地提示。第六，对实验性接口（agent view 的 research preview、`codex app-server`、`codex cloud`、`/fire`）做适配层隔离，每个适配器声明自己达到的能力等级，接口变化时降级而不是崩溃。第七，不要每次完成都打断用户；也不要只给警报而不给证据，破坏实验表明徽标式警报会被习惯性浅评审忽略。

### 趣味 UI 是同一状态机上的可选皮肤

办公室视图应当晚于列表与看板出现，并且只做渲染层：管理器已经持有会话状态，办公室视图不需要自己再去采集，从而避开观察式方案的格式耦合与自报式方案的状态过期。设计围绕四到五个关注状态而不是工具种类；现有项目的映射表都很小，走路和打字是装饰。每个角色都必须是入口：点击打开会话、就地回答，再配一个"下一个等我的 agent"热键，否则会继承"motivational theater"的批评。"走过来汇报"只留给确实需要人的状态，用户桌前排起的队伍长度本身就是一眼可读的指标，正好对应 Ronacher 想要的那条看得见的队列。动画不能代替验证，评审状态要有独立的明确指示。美术资源从第一天就自制或正规授权，两个头部项目都碰到了素材许可的麻烦。看板与办公室共用一套映射：backlog 是不在办公室，in progress 是在工位，需要输入或待评审是站在用户桌前，done 是离开大楼；这个映射是综合推断，没有项目验证过。

## Conclusion

这次调研改变的是对产品重心的理解。用户最初的描述是"统一管理会话"加"好玩的 UI"，而证据显示可防守的价值在两者之间的一层：一套跨厂商的归一化状态，加上一条以人的评审速率为约束的关注队列。厂商已经在各自的围墙内做完了列表、worktree 和通知，第三方在围墙内与之竞争的产品大多已经退场；围墙之间的聚合仍然空着，而两家 hooks 的字段同构让本地一侧的聚合成本低得出奇。

最大的不确定性有两处，都无法靠更多桌面调研消除。其一是云端：两家都没有公开的会话状态 API，这块能力取决于厂商是否开放，第一版应当把它设计成可以后补的适配器。其二是趣味化视图的长期价值：该领域没有任何留存数据或对照研究，"agent 走过来汇报"是没人做过的交互。合理的做法是把它当成一次带埋点的实验，用产品自己记录的 agent 空转时间和从完成到接受的时间来判断它是否真的缩短了人的响应，而不是凭观感决定去留。
