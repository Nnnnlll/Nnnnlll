// functions/api/scores/top.js → GET /api/scores/top?game=xxx&limit=20
// 每个用户只取历史最高分，按分数倒序
import { ok, fail } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const game = (url.searchParams.get('game') || '').trim();
  if (!game || game.length > 32) return fail('BAD_GAME', 'game 参数无效');

  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  const rows = await env.DB.prepare(
    `SELECT u.username, MAX(s.score) AS score, MAX(s.created_at) AS created_at
       FROM scores s JOIN users u ON u.id = s.user_id
      WHERE s.game = ?
      GROUP BY s.user_id
      ORDER BY score DESC
      LIMIT ?`
  ).bind(game, limit).all();

  const list = (rows.results || []).map((r, i) => ({
    rank: i + 1,
    username: r.username,
    score: r.score,
    created_at: r.created_at,
  }));

  return ok({ game, limit, list });
}