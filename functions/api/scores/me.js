// functions/api/scores/me.js → GET /api/scores/me?game=xxx
import { ok, fail, requireUser } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const { user, error } = await requireUser(env, request);
  if (error) return error;

  const url = new URL(request.url);
  const game = (url.searchParams.get('game') || '').trim();

  if (game) {
    if (game.length > 32) return fail('BAD_GAME', 'game 参数无效');
    const row = await env.DB.prepare(
      `SELECT MAX(score) AS best, COUNT(*) AS plays
         FROM scores WHERE user_id = ? AND game = ?`
    ).bind(user.id, game).first();
    return ok({ game, best: row ? row.best : null, plays: row ? row.plays : 0 });
  }

  // 不带 game：返回各游戏最好成绩概览
  const rows = await env.DB.prepare(
    `SELECT game, MAX(score) AS best, COUNT(*) AS plays
       FROM scores WHERE user_id = ?
      GROUP BY game ORDER BY game`
  ).bind(user.id).all();

  return ok({ games: rows.results || [] });
}