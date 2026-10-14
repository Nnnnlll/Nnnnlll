// devtest/e2e.mjs —— 端到端 API 测试
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
let pass = 0, fail = 0;
const log = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

async function api(method, p, body, cookie) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let setCookie = r.headers.get('set-cookie');
  if (!setCookie && typeof r.headers.getSetCookie === 'function') {
    const arr = r.headers.getSetCookie();
    if (arr && arr.length) setCookie = arr[0];
  }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j, setCookie };
}

// 1. ping
let r = await api('GET', '/api/tools/ping');
log('GET /api/tools/ping → 200 ok', r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));

// 2. me (未登录)
r = await api('GET', '/api/auth/me');
log('GET /api/auth/me 未登录 → user:null', r.status === 200 && r.json?.data?.user === null);

// 3. 注册
const uname = 'tester_' + Math.floor(Math.random() * 1e6);
r = await api('POST', '/api/auth/register', { username: uname, password: 'secret123' });
log('POST register → 200 + cookie', r.status === 200 && r.json?.ok && !!r.setCookie, `user=${r.json?.data?.user?.username}`);
const cookie = (r.setCookie || '').split(';')[0];

// 4. 重复注册
r = await api('POST', '/api/auth/register', { username: uname, password: 'secret123' });
log('重复注册 → 409 USER_EXISTS', r.status === 409 && r.json?.error?.code === 'USER_EXISTS');

// 5. 弱密码
r = await api('POST', '/api/auth/register', { username: 'weak' + Math.floor(Math.random() * 1e6), password: '12' });
log('短密码 → 400 BAD_PASSWORD', r.status === 400 && r.json?.error?.code === 'BAD_PASSWORD');

// 6. 带 cookie 的 me
r = await api('GET', '/api/auth/me', null, cookie);
log('GET me 带 cookie → 拿到用户', r.status === 200 && r.json?.data?.user?.username === uname);

// 7. 错误密码登录
r = await api('POST', '/api/auth/login', { username: uname, password: 'wrongpass' });
log('错误密码 → 401 BAD_CREDENTIALS', r.status === 401 && r.json?.error?.code === 'BAD_CREDENTIALS');

// 8. 正确登录
r = await api('POST', '/api/auth/login', { username: uname, password: 'secret123' });
log('正确登录 → 200 + cookie', r.status === 200 && !!r.setCookie);
const cookie2 = (r.setCookie || '').split(';')[0];

// 9. 提交成绩（未登录）
r = await api('POST', '/api/scores/submit', { game: 'fps', score: 100 });
log('未登录提交成绩 → 401', r.status === 401);

// 10. 提交成绩
r = await api('POST', '/api/scores/submit', { game: 'fps', score: 88, meta: { kills: 12 } }, cookie2);
log('提交成绩 88 → saved', r.status === 200 && r.json?.data?.best === 88);

// 11. 再提交更高分
r = await api('POST', '/api/scores/submit', { game: 'fps', score: 150 }, cookie2);
log('再提交 150 → best 更新为 150', r.json?.data?.best === 150);

// 12. 再提交低分
r = await api('POST', '/api/scores/submit', { game: 'fps', score: 30 }, cookie2);
log('提交低分 30 → best 仍为 150', r.json?.data?.best === 150);

// 13. 排行榜
r = await api('GET', '/api/scores/top?game=fps&limit=10');
const top1 = r.json?.data?.list?.[0];
log('排行榜 → 包含用户 且最高 150', r.status === 200 && top1?.username === uname && top1?.score === 150, JSON.stringify(r.json?.data?.list));

// 14. 个人成绩
r = await api('GET', '/api/scores/me?game=fps', null, cookie2);
log('个人成绩 → best 150 plays 3', r.json?.data?.best === 150 && r.json?.data?.plays === 3, JSON.stringify(r.json?.data));

// 15. 非法 score
r = await api('POST', '/api/scores/submit', { game: 'fps', score: 'abc' }, cookie2);
log('非法 score → 400 BAD_SCORE', r.status === 400 && r.json?.error?.code === 'BAD_SCORE');

// 16. logout
r = await api('POST', '/api/auth/logout', {}, cookie2);
log('logout → 200', r.status === 200 && r.json?.ok);

// 17. logout 后 me
r = await api('GET', '/api/auth/me', null, cookie2);
log('logout 后 me → user:null', r.json?.data?.user === null);

// 18. AI 未配置
r = await api('POST', '/api/tools/ai', { prompt: 'hi' }, cookie);
log('AI 未配置 → 503 AI_NOT_CONFIGURED', r.status === 503 && r.json?.error?.code === 'AI_NOT_CONFIGURED');

console.log(`\n结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);