// functions/api/auth/me.js → GET /api/auth/me
import { ok, currentUser } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return ok({ user: null });
  return ok({ user: { id: user.id, username: user.username, created_at: user.created_at } });
}
