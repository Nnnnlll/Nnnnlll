// functions/api/_lib.js —— 共享工具（Cloudflare Pages Functions / Workers 运行时）
// 运行时可用：WebCrypto(crypto.subtle)、TextEncoder、fetch、crypto.getRandomValues

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function ok(data = null, extraHeaders = {}) {
  return json({ ok: true, data }, 200, extraHeaders);
}

export function fail(code, message, status = 400) {
  return json({ ok: false, error: { code, message } }, status);
}

// ── 密码：PBKDF2-SHA256, 100k 迭代 ─────────────────────────────
const enc = new TextEncoder();
const HEX = [...Array(256)].map((_, i) => i.toString(16).padStart(2, '0'));

function toHex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i]];
  return s;
}

function randHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

// 供注册时生成盐（导出）
export function randSalt(bytes = 16) {
  return randHex(bytes);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    key, 256
  );
  return toHex(bits);
}

export async function hashPassword(password, salt) {
  return pbkdf2(password, salt, 100000);
}

export async function verifyPassword(password, salt, expected) {
  const got = await pbkdf2(password, salt, 100000);
  // 定长常量时间比较
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── 输入校验 ───────────────────────────────────────────────────
export function checkUsername(u) {
  if (typeof u !== 'string') return '用户名不能为空';
  u = u.trim();
  if (u.length < 3 || u.length > 20) return '用户名需 3-20 个字符';
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(u)) return '用户名只允许中英文、数字、下划线';
  return null;
}

export function checkPassword(p) {
  if (typeof p !== 'string') return '密码不能为空';
  if (p.length < 6 || p.length > 64) return '密码需 6-64 个字符';
  return null;
}

// ── 会话 ───────────────────────────────────────────────────────
export const COOKIE_NAME = 'nnn_session';

export function parseCookies(request) {
  const h = request.headers.get('cookie') || '';
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionToken(request) {
  const c = parseCookies(request)[COOKIE_NAME];
  if (c) return c;
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export async function createSession(env, userId) {
  const token = randHex(32);
  const now = Date.now();
  const days = parseInt(env.SESSION_TTL_DAYS || '30', 10) || 30;
  const exp = now + days * 86400000;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, userId, now, exp).run();
  return { token, exp };
}

export function sessionCookie(token, exp) {
  const maxAge = Math.max(0, Math.floor((exp - Date.now()) / 1000));
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

// 返回 user 行或 null
export async function currentUser(env, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, now).first();
  return row || null;
}

export async function requireUser(env, request) {
  const u = await currentUser(env, request);
  if (!u) return { user: null, error: fail('UNAUTHORIZED', '请先登录', 401) };
  return { user: u, error: null };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 简单内存级限流（同一 isolate 内有效，够挡暴力破解的突发流量）
const hits = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let arr = hits.get(key) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= limit) return false;
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10000) hits.clear();
  return true;
}
