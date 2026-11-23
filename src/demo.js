// Feeds a running hub a scripted afternoon of agent activity, through the same
// hook endpoints real agents use. For trying the UI without wiring anything.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function demo(url, { speed = 1, headers = { 'content-type': 'application/json' } } = {}) {
  const post = (agent, host, body, runtime) =>
    fetch(`${url}/ingest/${agent}?host=${host}${runtime ? `&runtime=${runtime}` : ''}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  const S = (agent, host, id, cwd, runtime) => (hook_event_name, extra = {}) =>
    post(agent, host, { session_id: id, cwd, hook_event_name, ...extra }, runtime);
  const run = Date.now().toString(36);

  const a = S('claude', 'macbook', `demo-auth-${run}`, '/work/shop-api');
  const b = S('codex', 'macbook', `demo-flaky-${run}`, '/work/shop-api');
  const c = S('claude', 'cloud', `demo-docs-${run}`, '/home/user/docs-site', 'cloud');
  const d = S('codex', 'devbox', `demo-migrate-${run}`, '/srv/billing');
  const e = S('claude', 'macbook', `demo-perf-${run}`, '/work/web-app');
  // The same job given to both agents: one task, two versions to compare.
  const f = S('claude', 'macbook', `demo-csv-a-${run}`, '/work/shop-api');
  const g = S('codex', 'macbook', `demo-csv-b-${run}`, '/work/shop-api');

  const steps = [
    () => a('SessionStart', { source: 'startup' }),
    () => a('UserPromptSubmit', { prompt: '把登录接口改成支持 passkey，保留密码登录作为回退' }),
    () => b('UserPromptSubmit', { prompt: 'Fix the flaky checkout integration test' }),
    () => c('UserPromptSubmit', { prompt: '把 API 文档里所有 v1 示例迁移到 v2' }),
    () => a('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'src/auth/login.ts' } }),
    () => d('UserPromptSubmit', { prompt: 'Write the migration that splits invoices.address into columns' }),
    () => e('UserPromptSubmit', { prompt: '首页 LCP 从 3.1s 降到 2s 以内，先定位再改' }),
    () => b('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test -- checkout' } }),
    () => a('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm install @simplewebauthn/server' } }),
    () => a('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm install @simplewebauthn/server' } }),
    () => c('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'docs/api/orders.md' } }),
    () => e('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '首屏大图可以换成 AVIF 并延迟加载轮播吗？这会改动视觉稿。' }] } }),
    () => b('PostToolUse', { tool_name: 'Bash' }),
    () => d('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'psql -f migrations/0042_split_address.sql' } }),
    () => d('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'psql -f migrations/0042_split_address.sql' } }),
    () => b('Stop', { last_assistant_message: 'The test raced the payment webhook. I added an explicit wait on the order status and ran it 30 times: 30/30 passing. One file changed: test/checkout.int.test.ts.' }),
    () => c('Stop', { last_assistant_message: '已迁移 14 个文件里的 61 处示例，并开了 PR。有 3 处 v1 独有的字段在 v2 没有对应，我在 PR 描述里列出来了，需要你决定怎么写。' }),
    () => f('UserPromptSubmit', { prompt: '给订单导出加上 CSV 格式，保留现有的 JSON 导出' }),
    () => g('UserPromptSubmit', { prompt: '给订单导出加上 CSV 格式，保留现有的 JSON 导出' }),
    () => f('Stop', { last_assistant_message: '加了 /orders/export?format=csv，用流式写出，10 万行内存稳定。改了 4 个文件，补了 6 个测试。' }),
    () => g('Stop', { last_assistant_message: 'Added CSV export behind the existing endpoint via an Accept header. 2 files changed, 3 tests. Large exports are buffered in memory.' }),
    () => c('SessionEnd', { reason: 'other' }),
    () => fetch(`${url}/ingest/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        { agent: 'claude', session_id: `demo-docs-${run}`, type: 'pr.updated', data: { pr: { number: 214, url: 'https://github.com/example/docs-site/pull/214', title: 'Migrate API examples to v2', state: 'open', draft: false, checks: 'passing', review: 'review_required', base: 'main' } } },
        { agent: 'codex', session_id: `demo-flaky-${run}`, type: 'pr.updated', data: { pr: { number: 87, url: 'https://github.com/example/shop-api/pull/87', title: 'Fix flaky checkout test', state: 'open', draft: false, checks: 'failing', review: null, base: 'main', head_sha: 'demo' } } },
      ]),
    }),
  ];
  // Permission requests stay open until someone answers them in the board,
  // so steps are fired without waiting for their responses.
  for (const step of steps) {
    step().catch(() => {});
    await sleep(700 / speed);
  }
}

// A fleet: `n` sessions across a handful of projects in a realistic mix of
// states, including the same permission request open in many sessions at once.
export async function demoFleet(url, n, { headers = { 'content-type': 'application/json' } } = {}) {
  const repos = ['shop-api', 'web-app', 'billing', 'docs-site', 'mobile', 'infra', 'search', 'ml-pipeline'];
  const tasks = ['升级依赖并修复类型错误', 'Add pagination to the list endpoint', '给导出功能补测试', 'Refactor the retry logic', '修复时区相关的偶发失败', 'Migrate config to the new schema', '把日志改成结构化输出', 'Speed up the cold start'];
  const run = Date.now().toString(36);
  const post = (agent, body) => fetch(`${url}/ingest/${agent}?host=${body.host}`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => {});
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const agent = i % 3 === 2 ? 'codex' : 'claude';
    const repo = repos[Math.floor((i * 7) % 23 / 3) % repos.length];
    const me = { session_id: `fleet-${run}-${i}`, cwd: `/work/${repo}`, host: i % 5 === 4 ? 'devbox' : 'macbook' };
    const say = (hook_event_name, extra = {}) => post(agent, { ...me, hook_event_name, ...extra });
    jobs.push((async () => {
      await say('UserPromptSubmit', { prompt: `${tasks[i % tasks.length]}（${repo} #${i}）`, prompt_id: `p${i}` });
      await say('PreToolUse', { tool_name: 'Bash', tool_use_id: `t${i}`, tool_input: { command: 'npm test' } });
      const kind = i % 20;
      if (kind < 3) return say('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm install' } }); // same request, many sessions
      if (kind === 3) return say('PermissionRequest', { tool_name: 'Bash', tool_input: { command: `git push origin feature-${i}` } });
      if (kind === 4) return say('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules dist' } });
      if (kind === 5) return say('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: `q${i}`, tool_input: { questions: [{ question: '要保留旧接口的兼容层吗？', options: [{ label: '保留' }, { label: '删除' }] }] } });
      if (kind === 6) return say('StopFailure', { error: 'rate_limit' });
      if (kind < 11) return say('Stop', { last_assistant_message: '做完了：改了 3 个文件，测试全部通过。' });
      if (kind === 11) { await say('Stop', { last_assistant_message: 'Done.' }); return say('SessionEnd', {}); }
      return null; // still working
    })());
    if (i % 25 === 24) await sleep(50);
  }
  await Promise.all(jobs.map((j) => Promise.race([j, sleep(1500)]))); // held requests never resolve
}
