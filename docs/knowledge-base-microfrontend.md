# 知识库微前端集成（ai-call ↔ ai-knowledge，Next.js Multi-Zones）

> 决策日期 2026-07-10。目标：把 ai-call 前端的「知识库管理」界面从**占位/mock**（外部模式下会 404，因为它代理到 ai-knowledge 不存在的 `/knowledge-base` 端点）改为**内嵌 ai-knowledge 原厂的知识库 UI**，零重写、永不脱节。
> 关联：`docs/authz-architecture.md`（统一鉴权，是本方案免鉴权改造的前提）、`docs/testing/call-10-cross-tenant-retrieval.md`（检索链路，**不受本方案影响**）。

## 为什么是 Multi-Zones（而非 API 代理 / iframe / Module Federation）

- 两端都是 **Next.js**（ai-call dashboard=14、ai-knowledge web=15），Multi-Zones 是官方原生组合方式。
- **鉴权白送**：两系统共享 `@xiaoli-byte/authz` + JWT 签名密钥 + httpOnly cookie。**同域部署**后 cookie 自动带给两个 zone，ai-knowledge 后端用共享密钥验同一个 token——微前端最难的跨应用鉴权**零改造**。
- iframe 有 UX 缝（高度/样式/深链/跨域交接）；Module Federation 在 App Router + Next 14/15 版本差下不成熟。均劣于 Multi-Zones。

## 边界：检索 vs 管理，两条路各走各的

| 能力 | 方案 | 状态 |
|---|---|---|
| **通话 RAG 检索**（voice-agent → ai-call → ai-knowledge `/search/retrieve`）| **API 级**（CALL-06），带租户身份、按租户隔离 | ✅ 已实测，**本方案不动** |
| 前端**「检索测试」**按钮 | 内部转 `retrieve()` → `/search/retrieve` | ✅ 能通，**本方案不动** |
| 前端**知识库管理**（建库/传文档/浏览）| **Multi-Zones 内嵌 ai-knowledge `/documents` 等页** | 🆕 本方案 |

安全敏感的检索是**后端契约**（可测、可隔离验证）；重且易脱节的管理 UI 交给 ai-knowledge 原厂。

## 路由拓扑（同域，靠网关/反代）

统一域名 `app.example.com` 下按路径前缀分流：

| 路径 | 目标 | 说明 |
|---|---|---|
| `/api/*` | **ai-call API**（NestJS :3001）| ai-call 自己的后端 |
| `/knowledge/api/*` | **ai-knowledge API**（NestJS :9999）| 知识库后端；前缀避免与上一行相撞 |
| `/knowledge/*`（页面/资源）| **ai-knowledge web**（Next :8888）| 内嵌的知识库 UI（含 `/knowledge/_next/*` 资源）|
| `/*` | **ai-call dashboard**（Next :3000）| 主 zone，外壳 + 其余全部页面 |

> `/knowledge/api/*` 必须排在 `/knowledge/*` **之前**匹配（更具体优先），否则页面 zone 会吞掉 API 请求。

### 关键陷阱与解法：ai-knowledge web 的 API 基址
ai-knowledge web 用 `NEXT_PUBLIC_API_URL`（构建期公开变量，prod 默认相对 `/api`）拼 API 地址。同域后裸 `/api/*` 会打到 **ai-call** 的 API。**解法**：作为 zone 运行时把它设为 `NEXT_PUBLIC_API_URL=/knowledge/api`，配合网关上表分流即可。

## 两侧改动（均 env 门控、可逆、不设变量则零影响）

### ai-knowledge web（`apps/web/next.config.mjs`）
- 新增 env 门控 `basePath`：`WEB_BASE_PATH=/knowledge` 时把所有页面与 `_next` 资源挂到 `/knowledge` 前缀下；不设则 8888 根路径独立访问**照旧**。
- 其自带的 `/api/:path*` → `API_INTERNAL_URL` rewrite 在 basePath 下自动变成 `/knowledge/api/:path*`（Next 默认给 rewrite source 加 basePath 前缀），与网关规则一致。

### ai-call dashboard（`apps/dashboard/next.config.js`）
- 新增 env 门控 rewrite：`KNOWLEDGE_ZONE_URL` 指向 ai-knowledge web 时，`beforeFiles` 把 `/knowledge` 与 `/knowledge/:path*` 转发过去（`beforeFiles` 覆盖本地文件路由 → 内嵌生效）；不设则 ai-call 仍渲染自己的 `/knowledge` mock 页（现状不变）。
- 现有 `/api/:path*` → NestJS 的 rewrite 挪到 `afterFiles`，行为不变。

> **dev（无网关）**：靠 ai-call dashboard 的 rewrite 做双跳组合（`3000/knowledge/*` → `8888/knowledge/*`，其中 API 再经 ai-knowledge web 自身 rewrite 到 :9999）。
> **prod（有网关）**：网关按上面「路由拓扑」表直接分流，ai-call 的 zone rewrite 可留可去（留着也无害，网关优先）。

## 环境变量

| 变量 | 位置 | 值（集成时）| 不设时 |
|---|---|---|---|
| `KNOWLEDGE_ZONE_URL` | ai-call dashboard | ai-knowledge web 地址（dev: `http://localhost:8888`；prod: 网关内网地址）| ai-call 渲染自带 mock `/knowledge` 页 |
| `WEB_BASE_PATH` | ai-knowledge web | `/knowledge` | 8888 根路径独立访问 |
| `NEXT_PUBLIC_API_URL` | ai-knowledge web | `/knowledge/api`（构建期！改后需重新 build）| `/api`（独立部署默认）|

## 鉴权：现状、差距与两条路

> ⚠️ **重要更正**（2026-07-10 联调后）：Multi-Zones 只解决了**界面内嵌与路由**，**没有**自动带来单点登录。经核查，两系统鉴权当前**不互通**：

| 维度 | ai-call | ai-knowledge | 后果 |
|---|---|---|---|
| JWT 签名密钥 | `JWT_SECRET` | `JWT_ACCESS_SECRET`（**值不同**）| ai-call 的 token，ai-knowledge 验不过 |
| token 载体 | httpOnly **cookie** | **localStorage** + `Authorization: Bearer` | 同域也不互通（不同存储）|
| API 取 token | — | `ExtractJwt.fromAuthHeaderAsBearerToken()`（**只认 header，不认 cookie**）| cookie 送过去也无效 |
| claim | 复数 `roles` | 读单数 `payload.role` | 角色语义不一致 |

**实际现象**：ai-call middleware 用自己的 cookie 放行 `/knowledge`（能看到界面），但 ai-knowledge web 拉数据用 localStorage 的 token → 若未在 zone 内单独登录，API 请求 401、列表拉不出。**即：同域内嵌成立，SSO 不成立。**

### 路线 A（interim，今日可用，零代码）
用户分别登录 ai-call（cookie）与 ai-knowledge zone（其 `/knowledge/login`，写 localStorage）。同源下两套登录态并存，功能可用，但**登两次**。网关配置即可上生产。

### 路线 B ✅ 已实现（无状态联合登录，2026-07-10）

> 决策：取**无状态联合**（两系统独立用户表，不做用户开通/映射）。ai-call 登录 → 同域 cookie 带给 `/knowledge/api/*` → ai-knowledge 用**统一密钥**验签 → 一次登录即可。

已落地（ai-knowledge，commit `f5c53ee`；均对独立部署无害，无 cookie 自动回落 Bearer）：
1. **统一 JWT 签名密钥**（env）：ai-knowledge `JWT_ACCESS_SECRET` = ai-call `JWT_SECRET`（未提交，需两侧配置）。
2. **API 接受共享 cookie**：`jwt.strategy` 改 `fromExtractors([cookieExtractor, bearer])`，cookie 优先解析 `access_token`（直接读 Cookie 头，不依赖 cookie-parser）；`validate` 兼容 claim（单数 `role` ↔ ai-call 复数 `roles`），归一化 `id/name` 供 `/auth/me`。
3. **web 带 cookie**：client `fetch` 加 `credentials:'include'`；store 加 `setCookieSession`（内存哨兵 token 令路由守卫通过，不写 localStorage）；`(dashboard)/layout` 无本地令牌时先 `/auth/me` 用 cookie 引导会话，失败才跳登录页。

**身份模型：惰性联合开通（JIT provisioning，2026-07-10 已落地）**。ai-call 与 ai-knowledge 是独立用户表，ai-call 用户的 `sub` 原本在 ai-knowledge 无记录——纯无状态联合下**写操作会因 `documents.owner_id → users.id` 外键失败**（上传报 `Foreign key constraint violated`）。解法：`jwt.strategy.validate` 首次见到合法但陌生的 `userId` 时，按 token claim **幂等补建一个 user 行**（id=sub、email/name/role 从 claim、`passwordHash` 占位不可本地登录），内存缓存已知 id 避免每请求打库；已存在则 `update:{}` 不覆盖本地资料。对独立部署无影响。
- ✅ 租户隔离、按角色访问、**owner 归属**（上传文档归该用户、可见自己的 PRIVATE）、按 USER 的 ResourceGrant 授权——**全部生效**。
- ⚠️ **仍存的边界**（升级为 CALL-13 剩余范围）：跨系统**用户生命周期同步**（ai-call 改角色/停用/删除不自动反映到 ai-knowledge 的开通行——首次建行后 `update:{}` 不再更新）；**email 冲突**（token email 撞已有本地用户但 id 不同时，JIT 只告警不阻断，该身份的 owner 写仍会失败，需人工对齐）。完全打通（生命周期联动 / 独立 IdP）见 `authz-architecture.md` §9 与 backlog **CALL-13**。

**前提硬约束**：**必须同域**（cookie 才同源共享）+ **两侧 JWT 密钥统一**（否则 cookie 验签不过）。

## 本地联调步骤

1. ai-knowledge：`.env` 里设 `WEB_BASE_PATH=/knowledge`、`NEXT_PUBLIC_API_URL=/knowledge/api`，重启 web（NEXT_PUBLIC 改动需重建/重启 dev）。
2. ai-call：`.env`/`.env.local` 设 `KNOWLEDGE_ZONE_URL=http://localhost:8888`，重启 dashboard。
3. 浏览器开 `http://localhost:3000/knowledge` → 应看到 **ai-knowledge 的知识库/文档界面**（而非 ai-call 的 mock 页）。**注意**：界面出来 ≠ 数据出来——当前鉴权未互通（见「鉴权」章），未在 zone 内单独登录时列表可能 401。要真单点登录需走路线 B。
4. 回归：`/knowledge` 之外的 ai-call 页面、以及通话检索/「检索测试」按钮均不受影响。

## 回滚

清空 `KNOWLEDGE_ZONE_URL`（ai-call）→ 立即回落自带 mock 页；清空 `WEB_BASE_PATH`/还原 `NEXT_PUBLIC_API_URL`（ai-knowledge）→ 8888 独立访问照旧。纯配置，无代码回滚。

## 已知取舍

- 视觉继承 ai-knowledge 样式（管理界面与 ai-call 外壳有风格差，可接受；后续可让 ai-knowledge 出「嵌入模式」精简布局）。
- `NEXT_PUBLIC_API_URL` 是构建期变量：集成构建与独立构建产物不同，CI 需区分。
- 深链、浏览器前进/后退在 Multi-Zones 下正常（非 iframe）；跨 zone 跳转是整页导航（可接受）。

## 附录：网关配置样例

同域下按路径前缀分流四条规则，关键是 **`/knowledge/api/*` 必须比 `/knowledge/*` 先匹配**。
上游：ai-call web `:3000`、ai-call API `:3001`、ai-knowledge web `:8888`、ai-knowledge API `:9999`。

### nginx

```nginx
upstream ai_call_web { server 127.0.0.1:3000; }
upstream ai_call_api { server 127.0.0.1:3001; }
upstream ai_kb_web   { server 127.0.0.1:8888; }
upstream ai_kb_api   { server 127.0.0.1:9999; }

# 复用的代理头（含 WebSocket 升级）
# 放到单独文件 proxy_common.conf 再 include，或直接内联
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 80;
  server_name app.example.com;

  # /knowledge 无斜杠时补斜杠，避免漏匹配
  location = /knowledge { return 308 /knowledge/; }

  # ① 知识库 API：/knowledge/api/* → ai-knowledge API（剥掉 /knowledge，保留 /api）
  #    ^~ 提升前缀优先级；且它比 /knowledge/ 更长，天然优先
  location ^~ /knowledge/api/ {
    rewrite ^/knowledge(/api/.*)$ $1 break;   # /knowledge/api/x → /api/x
    proxy_pass http://ai_kb_api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # ② 知识库前端（含 /knowledge/_next 资源）：/knowledge/* → ai-knowledge web
  #    保留完整路径（与 basePath=/knowledge 一致，不剥前缀）
  location ^~ /knowledge/ {
    proxy_pass http://ai_kb_web;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # Next dev HMR/WS
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # ③ ai-call API：/api/* → ai-call API（保留 /api）
  location ^~ /api/ {
    proxy_pass http://ai_call_api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # ④ 其余全部 → ai-call dashboard
  location / {
    proxy_pass http://ai_call_web;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> nginx 前缀 `location` 是**最长匹配优先**（与书写顺序无关），故 `/knowledge/api/` 天然先于 `/knowledge/`；用 `^~` 再确保不被 regex location 抢走。

### Traefik（等价，动态路由 + 优先级）

```yaml
http:
  routers:
    kb-api:                       # ① 优先级最高
      rule: "Host(`app.example.com`) && PathPrefix(`/knowledge/api`)"
      priority: 100
      service: ai-kb-api
      middlewares: [strip-knowledge]
    kb-web:                       # ②
      rule: "Host(`app.example.com`) && PathPrefix(`/knowledge`)"
      priority: 90
      service: ai-kb-web          # 不剥前缀（basePath=/knowledge）
    call-api:                     # ③
      rule: "Host(`app.example.com`) && PathPrefix(`/api`)"
      priority: 80
      service: ai-call-api
    call-web:                     # ④ 兜底
      rule: "Host(`app.example.com`) && PathPrefix(`/`)"
      priority: 1
      service: ai-call-web
  middlewares:
    strip-knowledge:
      stripPrefix: { prefixes: ["/knowledge"] }   # /knowledge/api/x → /api/x
  services:
    ai-call-web: { loadBalancer: { servers: [{ url: "http://127.0.0.1:3000" }] } }
    ai-call-api: { loadBalancer: { servers: [{ url: "http://127.0.0.1:3001" }] } }
    ai-kb-web:   { loadBalancer: { servers: [{ url: "http://127.0.0.1:8888" }] } }
    ai-kb-api:   { loadBalancer: { servers: [{ url: "http://127.0.0.1:9999" }] } }
```

> **仅做路由不够**：要真单点登录，还需完成上面「鉴权·路线 B」。仅有网关时表现为路线 A（同域内嵌 + 各登各的）。生产用 HTTPS，并确认 ai-call 下发 cookie 的 `Path=/`、`Domain` 覆盖该域（默认即可）。
