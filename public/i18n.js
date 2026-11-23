// UI language. English is the source language: every string in the app is an
// English key, and ZH holds the Chinese translation. Anything without an entry
// shows as written. Placeholders look like {name}.
//
// The setting is "auto" (follow the browser/system language), "en" or "zh".
// Auto resolves to Chinese for any zh-* locale and to English otherwise.
// Changing it reloads the page, so nothing has to be re-translated in place.

const KEY = 'lang';
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
};

export const LANGS = ['auto', 'en', 'zh'];
export const systemLang = () => {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return String(list[0] || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
};
export const langPref = () => (LANGS.includes(store.get()) ? store.get() : 'auto');
export const setLangPref = (v) => store.set(LANGS.includes(v) ? v : 'auto');
export const lang = () => (langPref() === 'auto' ? systemLang() : langPref());

const ZH = {
  // ---- review, re-entry, limits, overlap
  'tests': '测试',
  'type check': '类型检查',
  'lint': '代码检查',
  'build': '构建',
  '{age} ago': '{age}前',
  'No test run seen in this session': '这个会话里没见它跑过测试',
  'Edited again after the last test run': '最后一次测试之后又改了代码',
  '{n} new instruction(s) from you': '你新说了 {n} 次',
  '{n} tool calls': '调用了 {n} 次工具',
  '{n} failed command(s)': '{n} 条命令失败',
  '{n} request(s) to you ({a} allowed, {d} denied, {r} by rule)': '向你请求了 {n} 次（允许 {a}、拒绝 {d}，其中 {r} 次由规则决定）',
  'context compacted {n} time(s): it may have forgotten early details': '上下文被压缩了 {n} 次：它可能已经忘了早先的细节',
  'Originally asked: ': '最初的要求：',
  'Since you last looked: ': '你上次看过之后：',
  'So far: ': '到目前为止：',
  'Also being edited by {n} other live session(s) ({who}): {file}{more}': '还有 {n} 个正在进行的会话（{who}）也在改：{file}{more}',
  ' and {n} more file(s)': ' 等另外 {n} 个文件',
  'Would conflict when merged with branch {branch} ({who}): {files}': '与分支 {branch}（{who}）合并时会冲突：{files}',
  'Since it started': '会话开始以来',
  'Its own edits': '它自己编辑的',
  'Whole workspace': '整个工作区',
  'Everything that changed in the working tree since this session began, shell commands included. Other sessions in the same folder show up too.': '这个会话开始以来工作区里的全部改动，包括它用命令行改的。同一个文件夹里其他会话的改动也会出现。',
  'Only files this session’s edit tools touched. Misses what it changed through shell commands.': '只看这个会话用编辑工具改过的文件。它用命令行改的看不到。',
  'Everything uncommitted, whoever changed it.': '所有没提交的改动，不管是谁改的。',
  'Review': '审查',
  'No snapshot from when it started, showing the whole workspace.': '没有会话开始时的快照，显示的是整个工作区。',
  '{done} of {n} files reviewed': '已看 {done} / {n} 个文件',
  'No changes.': '没有改动。',
  'Mark as reviewed': '标为已看',
  'changed since you reviewed it': '你看过之后又改了',
  'Comment': '提意见',
  'Start a reply about this file': '针对这个文件写一条回复',
  '(binary or too large to show)': '（二进制文件或太大，无法显示）',
  'The diff was too long and is cut off.': '改动太长，已截断。',
  'Rename': '改名',
  'Name this session': '给这个会话起个名字',
  'Same file as {who}: {file}': '和「{who}」在改同一个文件：{file}',
  'No test run seen': '没见它跑过测试',
  'Last test run failed': '最后一次测试失败',
  'Edited after the last test run': '测试之后又改了代码',
  'Tests passed after the last edit': '最后一次改动之后测试通过',
  '{n} sessions stopped at the usage limit': '{n} 个会话因用量上限停下了',
  'Nothing is wrong with the work. When the limit resets they can pick up where they stopped.': '活本身没问题。额度恢复后可以接着做。',
  'Tell {n} to continue': '让 {n} 个继续',
  'Sends “continue” to the ones the board can reach. Use it once the limit has reset.': '给看板能联系上的会话发“继续”。等额度恢复后再用。',
  'Continue where you left off.': '接着刚才停下的地方继续。',
  'Sent to {n} session(s).': '已发给 {n} 个会话。',
  'Acknowledge all ({n})': '全部知道了（{n}）',
  'Acknowledged {n}.': '已知悉 {n} 个。',
  'What the agents report having spent, added up. It is what was used, not what is left: the board does not know your limits.': '把各个 agent 自己报告的花费加起来。这是已经用掉的，不是还剩多少：看板不知道你的额度上限。',
  ' · ${usd} in the last {h}h across {n} session(s)': ' · 近 {h} 小时 {n} 个会话共花费 ${usd}',

  // ---- static page
  'View': '视图', 'Workbench': '处理台', 'Board': '看板', 'Office': '办公室',
  'Filter sessions… (/)': '筛选：项目、标题、机器…（/）', 'Filter sessions': '筛选会话',
  'Auto rules {n}': '自动规则 {n}', 'Commands that are auto-allowed in every session': '在所有会话里自动允许的命令',
  'Import history': '导入历史', 'Import sessions that existed before the hooks were installed, from their history files': '把装 hooks 之前就存在的会话从历史文件里导入进来',
  'Desktop notifications': '桌面通知', 'Sound': '提示音', 'Connecting…': '连接中…', 'Live': '实时', 'Disconnected, reconnecting…': '断开，重连中…',
  'Sessions': '会话',
  'Whoever is at their own desk needs nothing from you. Whoever walks over and queues at your desk is waiting for you; the one at the front needs you most. When the queue is full, the rest raise a red flag at their desks. Finished work goes into your in-tray. Each room is a project. Click anyone to handle it on the right.':
    '在工位上的不用管。走到你桌前排队的在等你，排在最前面的最该先处理；队伍排不下时，其余的在工位上举红牌。做完的会把文件放进你的收件盘。每个房间是一个项目。点任何一个都在右边处理。',
  'Next waiting': '下一个等你的', 'Allow': '允许', 'Deny': '拒绝', 'Accepted': '已验收', 'Reply': '回复', 'Filter': '筛选',
  'Settings': '设置', 'Language': '语言', 'Follow system': '跟随系统', 'English': 'English', 'Close': '关闭',
  'Language changes apply right away. “Follow system” uses your browser’s language: Chinese if it is Chinese, English otherwise.':
    '语言设置立即生效。“跟随系统”会使用浏览器的语言：是中文就用中文，否则用英文。',

  // ---- time
  '{n}s': '{n} 秒', '{n}m': '{n} 分钟', '{h}h {m}m': '{h} 小时 {m} 分', '{n}d': '{n} 天',
  '{age} ago': '{age}前', '{age}': '已 {age}', 'waiting {age}': '已等 {age}', 'stopped {age}': '已停 {age}', 'waited {age}': '等了 {age}',

  // ---- states
  'Snoozed until {at}': '稍后处理（到 {at}）',
  'Needs permission': '要权限', 'Needs permission: {tool}': '要权限：{tool}', 'Asking you': '在问你',
  'Stopped: rate limited or out of quota': '被限流或额度用完，停下了', 'Stopped on an error': '出错停下了',
  'Lost: its process is gone': '失联：找不到它的进程了',
  'Finished and exited, awaiting review': '做完并退出了，待验收', 'Finished, awaiting review': '做完了，待验收',
  'Waiting on its own background task ({task})': '等它自己的后台任务（{task}）', 'Using {tool}': '在用 {tool}', 'Thinking': '在想',
  'Merged, counted as accepted': '已合并，自动算作验收', 'Past session (imported)': '历史会话（导入）', 'Ended': '已结束', 'Idle, waiting for work': '空闲，等你派活',
  'PR checks failing': 'PR 检查失败', 'PR changes requested': 'PR 被要求修改', 'PR checks failing and changes requested': 'PR 检查失败，并被要求修改', 'PR needs attention': 'PR 需要处理',
  'PR #{n}: the checks failed. Look at why, fix it, and push.': 'PR #{n} 的检查失败了，请查看失败原因，修好后推送。',
  'PR #{n}: a reviewer requested changes. Read the review comments, fix them, and push.': 'PR #{n} 被评审要求修改，请查看评审意见，修好后推送。',
  'PR #{n}: the checks failed and a reviewer requested changes. Look at both, fix them, and push.': 'PR #{n} 的检查失败了，并且被评审要求修改，请查看失败原因和评审意见，修好后推送。',
  'PR #{n} needs attention. Take a look, fix it, and push.': 'PR #{n} 需要处理，请查看，修好后推送。',
  'Open': '开着', 'Merged': '已合并', 'Closed (not merged)': '已关闭（未合并）',
  'Checks passing': '检查通过', 'Checks failing': '检查失败', 'Checks running': '检查进行中',
  'Approved': '已批准', 'Changes requested': '要求修改', 'Review required': '等评审', 'Draft': '草稿',
  'context {n}': '上下文 {n}', 'output {n}': '输出 {n}',

  // ---- actions & notices
  'Request failed ({status})': '请求失败 ({status})', 'Undo': '撤销', 'Copied': '已复制',
  'Accepted.': '已验收。', 'Noted.': '已知悉。', 'Archived.': '已归档。',
  'Snoozed until {label}. It comes back early if something new happens.': '已推迟到{label}。期间它有新情况会提前回来。',
  '1 hour from now': ' 1 小时后', 'tomorrow 9:00': '明早 9 点',
  'Pick or type an answer for every question.': '每个问题都要选一个或填一个答案。',

  // ---- lists
  'Needs you': '等你回应', 'Permissions, questions, failures, lost sessions, PR problems. Higher means more urgent.': '权限、提问、失败、失联、PR 出问题。越靠上越该先处理。',
  'To review': '待验收', 'The agent says it is done and you have not looked yet.': 'agent 说做完了，你还没看。',
  'Working': '工作中', 'Does not need you, unless it has been quiet too long.': '不需要你，除非它安静太久。',
  'Idle / ended': '空闲 / 已结束', 'Waiting for your next job, or already exited.': '等你派下一件事，或已退出。',
  '(unknown project)': '(未知项目)', ' · {n} more projects': ' · 另有 {n} 个项目',
  'Suggest allow': '建议允许', 'Suggest deny': '建议拒绝', 'Needs a look': '需要你看',
  'Task · {n} sessions': '任务 · {n} 个会话', '(no task description yet)': '(还没有任务描述)',
  'Cloud': '云端', '{n} subagents': '{n} 个子 agent', 'Not seen yet': '还没看过', ' ({n} requests)': '（共 {n} 个请求）',
  'Risky command, confirm on its own': '高风险命令，请单独确认', 'No activity for over 10 minutes': '超过 10 分钟没有任何动静',
  'Handled {n}. “{cmd} …” commands are now allowed automatically.': '已处理 {n} 个，以后“{cmd} …”这一类自动允许。',
  'Handled {n}. This command is now allowed automatically.': '已处理 {n} 个，以后这条命令自动允许。', 'Handled {n}.': '已处理 {n} 个。',
  '{n} sessions are asking for the same kind of command: {tool}': '{n} 个会话在请求同一类命令：{tool}',
  '…and {n} more': '…另有 {n} 条', 'Allow all ({n})': '全部允许（{n}）',
  'Allow all, and auto-allow this kind from now on': '全部允许，以后这一类也自动允许',
  'From now on “{stem} ” with any arguments is allowed automatically; commands with ; | && or risky forms still ask. Undo in “Auto rules”.':
    '以后“{stem} ”加任意参数都自动允许；带 ; | && 或高风险写法的仍会问你。可在“自动规则”里撤销',
  'Deny all': '全部拒绝', '{n} sessions are asking for the same thing: {tool}': '{n} 个会话在请求同一件事：{tool}',
  ', ': '、', '{list} and others ({n} projects)': '{list} 等 {n} 个项目',
  'Allow all, and auto-allow from now on': '全部允许，以后也自动允许',
  'Applies to this exact command only. Undo in “Auto rules”.': '只对完全相同的这条命令生效，可在“自动规则”里撤销',
  'No matching sessions.': '没有匹配的会话。', 'Nobody is waiting for you.': '没有人在等你。',

  // ---- office
  'Has a question': '有问题问你', 'Rate limited': '被限流了', 'Hit an error': '出错了', 'Lost': '失联',
  'At your desk: queued for you': '你的桌前：排队等你的', '{n} waiting': '{n} 等你', '{n} to review': '{n} 待验收', '{n}/{total} working': '{n}/{total} 在干活',
  '{n} more are waiting for you, holding up signs at their desks': '还有 {n} 个在等你，在各自工位上举着牌子',
  'Nobody is in the office yet. Start any Claude Code or Codex session and it will walk in by itself.': '办公室里还没有人。启动任意一个 Claude Code 或 Codex 会话，它会自己走进来。',
  'Done': '做完了', 'Quiet for long': '很久没动静', '+{n} helpers': '+{n} 帮手', '(no task yet)': '(还没有任务)', 'You': '你',
  'To review: {title}': '待验收：{title}', 'To review {n}': '待验收 {n}', '{a}: {b}': '{a}：{b}', '{agent}: {title}, {what}': '{agent}：{title}，{what}',

  // ---- workbench
  'Its terminal is stopped on the request above: anything typed there now would be taken as the answer to it. Handle the request first, then reply.':
    '它的终端正停在上面那个请求上：现在往里打字会被当成对那个请求的回答，所以先处理请求，再回复。',
  'This session is not on this machine; reply from its own interface.': '这个会话不在本机上，只能在它自己的界面里回复。',
  'It runs in a terminal the board cannot type into (not tmux). Sessions started inside tmux can be replied to from here.':
    '它开在一个看板没法输入的终端里（不是 tmux）。在 tmux 里启动的会话可以直接从这里回复。',
  'Copy attach command': '复制接入命令', 'Tell it what to do next…': '告诉它下一步做什么…', 'Send': '发送',
  'Goes straight into its tmux window.': '会直接打进它所在的 tmux 窗口。',
  'Its process has exited: this resumes the same session for another round in the background.': '它的进程已退出：会在后台接着同一个会话再跑一轮。',
  ' Ctrl/⌘ + Enter to send': ' Ctrl/⌘ + Enter 发送',
  'Multiple choice': '可以多选', 'Or write your own answer…': '或者自己写一个答案…',
  'Adopted this version: accepted {a}, archived the other {b}.': '已采用这一版，验收 {a} 个，归档其余 {b} 个。',
  'Accepted {n} sessions of this task.': '已验收这个任务的 {n} 个会话。',
  '{n} sessions of the same task (same instruction or same branch). Click a row to switch, compare them one by one, then accept by task.':
    '同一个任务的 {n} 个会话（同一句指令或同一个分支）。点一行切换，逐个对比后按任务验收。',
  '{n} files changed': '改了 {n} 个文件', 'Adopt this one, archive the rest': '采用这一版，其余归档',
  'Accept this session and archive the task’s other stopped sessions; ones still working are left alone': '验收当前这个会话，把同任务里其他已停下的会话归档；还在干活的不动',
  'Accept all ({n})': '全部验收（{n}）', 'Split this session off': '把这个会话拆出去', 'It is actually a different task': '它其实是另一件事',
  'Triage note': '分诊备注', ' Advice from the triage agent, not a decision': '　分诊 agent 的建议，不是决定',
  'Have it fix this': '让它去修', 'Open PR': '打开 PR', 'Got it (E)': '知道了 (E)', 'Leave it for now; the same problem will not remind you again': '先不管；同一个问题不会再提醒',
  'Answer': '回答', 'Hand back to terminal': '交回终端', 'Do not answer here; let it ask in its own terminal': '不在这里回答，让它在自己的终端里问你',
  'This question can only be answered in its own terminal right now.': '这个提问现在只能在它自己的终端里回答。',
  'Allow (A)': '允许 (A)', 'Deny (D)': '拒绝 (D)', 'Allow {tool} for this session': '本会话都允许 {tool}',
  'Do not decide here; let it ask in its own terminal': '不在这里决定，让它在自己的终端里问你',
  '{label} will be allowed automatically in every session from now on.': '以后所有会话里{label}都自动允许。', 'this command': '这条命令',
  'Auto-allow in every session from now on:': '所有会话以后都自动允许：', 'This one': '这一条',
  'With any arguments; commands with ; | && or risky forms still ask': '带任意参数；带 ; | && 或高风险写法的仍会问你',
  'This request can only be answered in its own terminal right now (the board was not open when it was sent, or it was handed back).':
    '这个请求现在只能在它自己的终端里回答（它发出时看板没开着，或已被交回终端）。',
  'Accepted (E)': '已验收 (E)', 'Archive': '归档', 'In 1 hour': '1 小时后再说', 'Tomorrow morning': '明早再说',
  'Mark unread': '标为未读', 'Keep it in the queue, look again later': '保持在队列里，稍后再看', 'Handle now': '现在处理',
  'No activity for {age}: the process is still there; it may be on a long task or stuck.': '{age} 没有任何动静：进程还在，可能在跑长任务，也可能卡住了。',
  '{n} more requests are queued behind this one.': '后面还有 {n} 个请求在排队。',
  'Nobody is waiting for you': '没有人在等你', 'No sessions yet': '还没有会话',
  'Pick a session on the left to look at it, or go do something else: it shows up here by itself when someone needs you.': '从左边选一个会话查看，或者去做别的事：有人需要你时这里会自动出现。',
  'Start any Claude Code or Codex session and it will show up here by itself.': '启动任意一个 Claude Code 或 Codex 会话，它会自动出现在这里。',
  'turn {n}': '第 {n} 轮', '☁ Cloud': '☁ 云端', 'What you said last': '你上一次说的', 'What it said last': '它上一次说的',
  'Files this session changed: {n} (relative to the last commit; changes made through shell commands are not included)': '这个会话改过的 {n} 个文件（相对上一次提交；它用命令行改的不在内）',
  'All changes in the workspace (relative to the last commit, not only this session’s)': '整个工作区的改动（相对上一次提交，不只是这个会话改的）',
  'See the whole workspace': '看整个工作区', 'Only what this session changed': '只看这个会话改的', 'No uncommitted changes.': '没有未提交的改动。',
  'Full diff (too long, truncated)': '完整 diff（太长，已截断）', 'Full diff': '完整 diff',
  'The message you sent has not been received yet ({why}):': '发出的消息还没被它接收（{why}）：',
  'its terminal may be stopped on another prompt, take a look': '终端可能停在别的提示上，去看一眼', 'the background process may not have started': '后台进程可能没启动起来',
  'Sent, waiting for it to receive:': '已发送，等它接收：',
  'Tools auto-allowed in this session': '这个会话里自动允许的工具', 'Stop auto-allowing': '不再自动允许',
  'Event log (latest {n})': '事件记录（最近 {n} 条）', '(late, not used)': '(迟到，未采用)',

  // ---- header summary
  '{n} waiting for you': '{n} 个会话在等你', 'Nothing is waiting for you': '没有会话在等你',
  ', {r} to review, {w} working': '，{r} 个待验收，{w} 个在工作', ' (filtered: showing {v} / {t})': '（筛选后显示 {v} / {t}）',
  'Imported {n}': '导入了 {n} 个', 'No new past sessions': '没有新的历史会话',

  // ---- rules dialog
  'Auto rules': '自动规则',
  'Commands that match are allowed automatically whenever any session asks. A rule is either one exact command or a kind of command with any arguments. Commands joined with ; | && never match a “kind” rule, and anything that looks risky is always confirmed one by one.':
    '任何会话请求匹配的命令时自动允许。规则可以是完全相同的一条命令，或一类命令加任意参数。带 ; | && 这类连接符的命令不会匹配“一类”规则，看起来高风险的命令永远逐个确认。',
  ' … (any arguments)': ' …（任意参数）', 'No rules yet.': '还没有规则。',
};

export function t(key, vars) {
  let s = lang() === 'zh' ? (ZH[key] ?? key) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

// Static markup: data-i18n (text), data-i18n-title / -placeholder / -aria-label.
export function translatePage(root = document) {
  document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    const data = `i18n${attr[0].toUpperCase()}${attr.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase())}`;
    for (const n of root.querySelectorAll(`[data-i18n-${attr}]`)) n.setAttribute(attr, t(n.dataset[data]));
  }
}
