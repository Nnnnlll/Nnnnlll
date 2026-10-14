// devtest/d1-shim.mjs —— 用 node:sqlite 模拟 Cloudflare D1 的最小 API
// 仅供本机（PRoot）端到端联调；生产环境用真正的 D1 绑定，不加载此文件。
import { DatabaseSync } from 'node:sqlite';

export function makeD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  return {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...args) { params = args; return stmt; },
        _norm() { return params.map((p) => (p === undefined ? null : p)); },
        async first() {
          const s = db.prepare(sql);
          const rows = s.all(...stmt._norm());
          return rows.length ? rows[0] : null;
        },
        async all() {
          const s = db.prepare(sql);
          return { results: s.all(...stmt._norm()) };
        },
        async run() {
          const s = db.prepare(sql);
          const info = s.run(...stmt._norm());
          return {
            success: true,
            meta: {
              last_row_id: Number(info.lastInsertRowid),
              changes: Number(info.changes),
            },
          };
        },
      };
      return stmt;
    },
    async exec(sql) { db.exec(sql); },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
  };
}