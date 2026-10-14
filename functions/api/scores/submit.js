// functions/api/scores/submit.js → POST /api/scores/submit
import { ok, fail, readJson, requireUser, rateLimit } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireUser(env, request);
  if (error) return error;

  if (!rateLimit('score:' + user.id, 60, 60000)) return fail('RATE_LIMITED', '提交过于频繁', 429);

  const body = await readJson(request);
  if (!body) return fail('BAD_JSON', '请求格式错误');

  const game = (body.game || '').trim();
  const score = Number(body.score);
  if (!game || game.length > 32) return fail('BAD_GAME', 'game 参数无效');
  if (!Number.isFinite(score)) return fail('BAD_SCORE', 'score 必须是数字');

  let meta = null;
  if (body.meta != null) {
    try { meta = JSON.stringify(body.meta).slice(0, 2000); } catch { meta = null; }
  }

  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO scores (user_id, game, score, meta, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, game, score, meta, now).run();

  // 返回该游戏个人最好成绩
  const best = await env.DB.prepare(
    'SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND game = ?'
  ).bind(user.id, game).first();

  return ok({ saved: true, best: best ? best.best : score });
}