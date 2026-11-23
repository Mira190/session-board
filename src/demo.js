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
    () => c('SessionEnd', { reason: 'other' }),
  ];
  // Permission requests stay open until someone answers them in the board,
  // so steps are fired without waiting for their responses.
  for (const step of steps) {
    step().catch(() => {});
    await sleep(700 / speed);
  }
}
