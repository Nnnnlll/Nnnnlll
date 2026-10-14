// functions/api/auth/login.js → POST /api/auth/login
import {
  json, fail, readJson, verifyPassword, createSession, sessionCookie, rateLimit,
} from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (!rateLimit('login:' + ip, 15, 60000)) return fail('RATE_LIMITED', '尝试过于频繁，请稍后再试', 429);

  const body = await readJson(request);
  if (!body) return fail('BAD_JSON', '请求格式错误');

  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return fail('MISSING', '请输入用户名和密码');

  const user = await env.DB.prepare(
    'SELECT id, username, pass_hash, salt, created_at FROM users WHERE username = ?'
  ).bind(username).first();

  // 统一错误信息，避免用户名枚举
  if (!user) return fail('BAD_CREDENTIALS', '用户名或密码错误', 401);

  const good = await verifyPassword(password, user.salt, user.pass_hash);
  if (!good) return fail('BAD_CREDENTIALS', '用户名或密码错误', 401);

  const now = Date.now();
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();

  const { token, exp } = await createSession(env, user.id);

  return json(
    { ok: true, data: { user: { id: user.id, username: user.username, created_at: user.created_at } } },
    200,
    { 'set-cookie': sessionCookie(token, exp) }
  );
}
