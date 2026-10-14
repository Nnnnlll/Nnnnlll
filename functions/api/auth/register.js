// functions/api/auth/register.js → POST /api/auth/register
import {
  json, fail, readJson, checkUsername, checkPassword,
  hashPassword, createSession, sessionCookie, randSalt, rateLimit,
} from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (!rateLimit('reg:' + ip, 10, 60000)) return fail('RATE_LIMITED', '操作过于频繁，请稍后再试', 429);

  const body = await readJson(request);
  if (!body) return fail('BAD_JSON', '请求格式错误');

  const username = (body.username || '').trim();
  const password = body.password || '';

  const eu = checkUsername(username);
  if (eu) return fail('BAD_USERNAME', eu);
  const ep = checkPassword(password);
  if (ep) return fail('BAD_PASSWORD', ep);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return fail('USER_EXISTS', '该用户名已被注册', 409);

  const salt = randSalt(16);
  const passHash = await hashPassword(password, salt);
  const now = Date.now();

  const res = await env.DB.prepare(
    'INSERT INTO users (username, pass_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)'
  ).bind(username, passHash, salt, now, now).run();

  const userId = res.meta.last_row_id;
  const { token, exp } = await createSession(env, userId);

  return json(
    { ok: true, data: { user: { id: userId, username, created_at: now } } },
    200,
    { 'set-cookie': sessionCookie(token, exp) }
  );
}
