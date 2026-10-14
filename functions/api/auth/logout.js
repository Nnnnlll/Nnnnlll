// functions/api/auth/logout.js → POST /api/auth/logout
import { ok, clearCookie, sessionToken } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return ok({ loggedOut: true }, { 'set-cookie': clearCookie() });
}
