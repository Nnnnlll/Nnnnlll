// functions/api/tools/ping.js → GET /api/tools/ping
import { ok } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  let dbOk = false;
  try {
    const r = await env.DB.prepare('SELECT 1 AS x').first();
    dbOk = !!r;
  } catch {
    dbOk = false;
  }
  return ok({
    service: 'nnnnlll-api',
    time: new Date().toISOString(),
    db: dbOk ? 'ok' : 'error',
    region: request.headers.get('cf-ray') ? 'edge' : 'local',
  });
}