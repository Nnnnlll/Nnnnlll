// devtest/server.mjs —— 本地端到端测试服务器
// 将 /api/* 路由到 functions/api/**/ 的 handler，用 node:sqlite 充当 D1。
// 只用于本机验证；线上是 Cloudflare Pages Functions。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeD1 } from './d1-shim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'functions');
const PORT = parseInt(process.env.PORT || '8788', 10);
const DBFILE = process.env.DBFILE || ':memory:';

const env = {
  DB: makeD1(DBFILE),
  SESSION_TTL_DAYS: '30',
};

// 应用 schema
await env.DB.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));

// 静态资源根
const STATIC_ROOT = ROOT;

function resolveHandler(pathname) {
  // /api/auth/login -> functions/api/auth/login.js
  const clean = pathname.replace(/\/+$/, '');
  let base = path.join(FUNCTIONS, clean);
  for (const cand of [base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handlerPath = resolveHandler(url.pathname);

  if (handlerPath) {
    try {
      const mod = await import(pathToFileURL(handlerPath).href + '?t=' + Date.now());
      const method = req.method.toUpperCase();
      const fn = mod['onRequest' + method.charAt(0) + method.slice(1).toLowerCase()] || mod.onRequest;
      if (!fn) { res.writeHead(405); res.end('Method Not Allowed'); return; }

      const body = await readBody(req);
      const headers = { ...req.headers };
      const request = new Request(url.href, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) || body.length === 0 ? undefined : body,
      });

      // waitUntil 桩
      const ctx = { waitUntil() {}, passThroughOnException() {} };
      const response = await fn({ request, env, params: {}, data: {}, next: async () => new Response('not found', { status: 404 }), functionPath: handlerPath, waitUntil: ctx.waitUntil });
      const outHeaders = {};
      response.headers.forEach((v, k) => { outHeaders[k] = v; });
      res.writeHead(response.status, outHeaders);
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (e) {
      console.error('[api error]', e);
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: String(e && e.stack || e) } }));
    }
    return;
  }

  // 静态文件（含 SPA 兜底到 index.html）
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.join(STATIC_ROOT, rel);
  if (!file.startsWith(STATIC_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dev server on http://0.0.0.0:${PORT} (db=${DBFILE})`);
});