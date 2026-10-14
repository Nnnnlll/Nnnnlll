# 大大小小 · 后端（第二阶段）

纯静态站基础上叠加的一层 Serverless 后端，**不改变现有页面结构**。
技术栈：Cloudflare Pages（托管静态站）+ Pages Functions（API）+ D1（SQLite）。

## 目录

```
functions/api/           # API 路由（Pages Functions 约定：文件路径 = URL）
  _lib.js                # 共享：响应、PBKDF2 口令、会话、限流
  auth/register|login|logout|me.js
  scores/submit|top|me.js
  tools/ping|ai.js
js/api.js                # 前端 SDK，挂 window.NNN
js/auth-ui.js            # 顶栏账号按钮 + 登录/注册/个人面板
schema.sql               # D1 建表
wrangler.toml            # Pages + D1 绑定配置
devtest/                 # 仅本机：node:sqlite 模拟 D1 做端到端测试
```

## API

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | /api/auth/register | 注册（用户名 3-20，密码 6-64） | 否 |
| POST | /api/auth/login | 登录 | 否 |
| POST | /api/auth/logout | 注销 | 是 |
| GET | /api/auth/me | 当前用户 | 否 |
| POST | /api/scores/submit | 提交成绩 `{game,score,meta?}` | 是 |
| GET | /api/scores/top?game=&limit= | 排行榜（每人最高分） | 否 |
| GET | /api/scores/me?game= | 我的成绩 | 是 |
| GET | /api/tools/ping | 健康检查 | 否 |
| POST | /api/tools/ai | AI 转发 `{prompt}` | 是 |

统一响应：`{ok:true,data}` / `{ok:false,error:{code,message}}`。
会话：HttpOnly Cookie `nnn_session`（也可用 `Authorization: Bearer <token>`）。

## 本地联调

```bash
# 方式一：本机 PRoot 环境推荐（wrangler 的 workerd 在 PRoot 下 mmap 受限）
node devtest/server.mjs        # 起在 :8788
node devtest/e2e.mjs           # 18 项端到端断言

# 方式二：标准 wrangler（PC / 有完整虚拟地址空间的环境）
wrangler d1 execute nnnnlll-db --local --file=./schema.sql
wrangler pages dev .
```

## 部署

```bash
# 1. 登录
wrangler login                     # 或 export CLOUDFLARE_API_TOKEN=...

# 2. 建 D1 并拿到 database_id，填进 wrangler.toml
wrangler d1 create nnnnlll-db

# 3. 远端建表
wrangler d1 execute nnnnlll-db --remote --file=./schema.sql

# 4. 密钥（AI 转发用；不配置则 /api/tools/ai 返回 503）
wrangler pages secret put AI_KEY

# 5. 部署
wrangler pages deploy .
```

> 站点当前在 GitHub Pages（nnnnlll.github.io/Nnnnlll），**不支持服务端 Functions**。
> 上线后端需迁到 Cloudflare Pages，或把 GitHub 仓库 Connect 到 Cloudflare Pages（推送即自动部署）。
