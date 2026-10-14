// functions/api/tools/ai.js → POST /api/tools/ai
// 服务端持有上游 key，前端不暴露。密钥用：wrangler secret put AI_KEY
import { ok, fail, readJson, requireUser, rateLimit } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireUser(env, request);
  if (error) return error;
  if (!rateLimit('ai:' + user.id, 20, 60000)) return fail('RATE_LIMITED', '请求过于频繁', 429);

  if (!env.AI_KEY) return fail('AI_NOT_CONFIGURED', '服务端未配置 AI_KEY', 503);

  const body = await readJson(request);
  const prompt = (body && body.prompt ? String(body.prompt) : '').trim();
  if (!prompt) return fail('EMPTY_PROMPT', 'prompt 不能为空');
  if (prompt.length > 4000) return fail('PROMPT_TOO_LONG', 'prompt 过长');

  const upstream = env.AI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const model = env.AI_MODEL || 'gpt-4o-mini';

  const r = await fetch(upstream, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + env.AI_KEY,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return fail('UPSTREAM_ERROR', '上游返回 ' + r.status + ': ' + t.slice(0, 300), 502);
  }

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return ok({ text, model });
}