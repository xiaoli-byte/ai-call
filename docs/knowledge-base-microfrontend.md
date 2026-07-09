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

## 鉴权流（为什么免改造）

1. 用户在 ai-call（`app.example.com`）登录 → NestJS 下发 **httpOnly cookie**（域=`app.example.com`）。
2. 浏览器打开 `/knowledge/documents` → 网关路由到 ai-knowledge web → SSR/CSR 请求 `/knowledge/api/*`。
3. 同域，cookie **自动携带** → 网关转 ai-knowledge API → 它用**共享 JWT 密钥**验签同一个 token → 放行，并按 CLS 注入 tenant/user。
4. 租户隔离、RBAC、ResourceGrant 全部复用 ai-knowledge 现有逻辑。**无需 SSO、无需 token 交接。**

前提硬约束：**必须同域**（cookie 才共享）。不同域则需 `SameSite=None` + 跨域 token 交接（本方案不采用）。

## 本地联调步骤

1. ai-knowledge：`.env` 里设 `WEB_BASE_PATH=/knowledge`、`NEXT_PUBLIC_API_URL=/knowledge/api`，重启 web（NEXT_PUBLIC 改动需重建/重启 dev）。
2. ai-call：`.env`/`.env.local` 设 `KNOWLEDGE_ZONE_URL=http://localhost:8888`，重启 dashboard。
3. 浏览器开 `http://localhost:3000/knowledge` → 应看到 **ai-knowledge 的知识库/文档界面**（而非 ai-call 的 mock 页），且已登录态（cookie 共享）。
4. 回归：`/knowledge` 之外的 ai-call 页面、以及通话检索/「检索测试」按钮均不受影响。

## 回滚

清空 `KNOWLEDGE_ZONE_URL`（ai-call）→ 立即回落自带 mock 页；清空 `WEB_BASE_PATH`/还原 `NEXT_PUBLIC_API_URL`（ai-knowledge）→ 8888 独立访问照旧。纯配置，无代码回滚。

## 已知取舍

- 视觉继承 ai-knowledge 样式（管理界面与 ai-call 外壳有风格差，可接受；后续可让 ai-knowledge 出「嵌入模式」精简布局）。
- `NEXT_PUBLIC_API_URL` 是构建期变量：集成构建与独立构建产物不同，CI 需区分。
- 深链、浏览器前进/后退在 Multi-Zones 下正常（非 iframe）；跨 zone 跳转是整页导航（可接受）。
