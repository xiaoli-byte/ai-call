# 统一鉴权落地工单（authz implementation backlog）

> **共同规范**：与 [`authz-architecture.md`](./authz-architecture.md) 配套。两仓库（ai-call / ai-knowledge）各存一份，内容一致，改动需同步。
>
> 状态：Draft · 2026-07-08 ｜ **P2(ai-call) 进度更新 2026-07-09**：CALL-01/02/03/04/05/07 已完成，CALL-06 阻塞（依赖的 KB-08 在 ai-knowledge 尚未实现）。详见下方各工单「状态」行。

## 如何使用本文件

- 每个工单是一个**自包含**任务：指明仓库/文件、步骤、验收标准、前置依赖，可直接交给 Sonnet 执行。
- 架构决策已在 `authz-architecture.md` 固定；**工单内不做设计选择**，遇到分叉按架构文档执行，拿不准就停下来问，不要自行发挥。
- 派活给 Sonnet 的模板：
  > 阅读 `docs/authz-architecture.md` 与 `docs/authz-implementation-backlog.md`，执行工单 **`<ID>`**。只做该工单范围内的事，完成后按「验收」自检并报告。
- ⚠️ 标 **[高风险]** 的工单涉及数据迁移或跨系统联调，执行前需人工确认，且必须分「加列(nullable)→回填→设非空」三步走，不可一把梭。

---

## 总控清单

| ID | 阶段 | 仓库 | 标题 | 依赖 | 风险 |
|---|---|---|---|---|---|
| AUTHZ-01 | P0 | kb | 创建 `@xiaoli-byte/authz` 包骨架 | — | 低 |
| AUTHZ-02 | P0 | kb | core：claim 类型 + 权限码规范 + `can()` | 01 | 低 |
| AUTHZ-03 | P0 | kb | jwt：签发/校验 + 共享密钥 + refresh 全量哈希 | 02 | 低 |
| AUTHZ-04 | P0 | kb | nestjs：全局 Guard + 装饰器 + CLS 租户注入 | 02,03 | 中 |
| AUTHZ-05 | P0 | kb | acl：ResourceGrant 判定 + `visibleWhereSql()` | 02 | 中 |
| AUTHZ-06 | P0 | kb | prisma：统一模型片段 + seed 工具 | 02 | 低 |
| AUTHZ-07 | P0→P2 | both | 跨仓分发（GitHub Packages / subtree）**需先确认方式** | 01–06 | 中 |
| KB-01 | P1 | kb | 引入 `Tenant` 实体 | AUTHZ-06 | [高风险] |
| KB-02 | P1 | kb | `User.role` → `Membership.roles[]` | KB-01 | [高风险] |
| KB-03 | P1 | kb | RBAC 硬编码 → 落库 | KB-02,AUTHZ-06 | 中 |
| KB-04 | P1 | kb | 接入全局 Guard | KB-03,AUTHZ-04 | 中 |
| KB-05 | P1 | kb | 修 `permissions.controller` 半成品 | KB-04 | 低 |
| KB-06 | P1 | kb | refresh token 全量哈希 | AUTHZ-03 | 低 |
| KB-07 | P1 | kb | 前端 token localStorage → cookie | KB-06 | 中 |
| KB-08 | P1 | kb | 检索接口强制 tenantId 过滤 + service guard | KB-04,AUTHZ-05 | [高风险] |
| CALL-01 | P2 | call | 引入 `@xiaoli-byte/authz`，替换本地 auth ✅已完成 | AUTHZ-07 | 中 |
| CALL-02 | P2 | call | 核心业务表补 `tenantId` ✅已完成 | CALL-01,KB-01 | [高风险] |
| CALL-03 | P2 | call | CLS 租户注入 + 查询强制过滤 ✅已完成 | CALL-02 | [高风险] |
| CALL-04 | P2 | call | 权限码去「贴标签」 ✅已完成 | CALL-01 | 中 |
| CALL-05 | P2 | call | 接入 ResourceGrant 数据级 ACL ✅已完成 | CALL-03,AUTHZ-05 | 中 |
| CALL-06 | P2 | call | 接 ai-knowledge 检索带租户身份 🔴阻塞（KB-08 未完成） | CALL-03,KB-08 | [高风险] |
| CALL-07 | P2 | call | 修 Cookie CSRF 债 ✅已完成 | CALL-01 | 低 |

**关键路径**：AUTHZ-01→02→(03/04/05/06) → KB-01→02→03→04 →(05/08) → CALL-01→02→03→06。
**可并行**：AUTHZ-03/04/05/06 在 02 后可并行；KB-06/07 与 KB-03/04 可并行；CALL-04/07 与 CALL-02/03 可并行。

---

## P0 — 地基（在 ai-knowledge/packages/authz 内开发；P2 前解决跨仓分发）

> 包源码放 **ai-knowledge**（它先落地 P1、且 ACL 资产在此），P2 时 ai-call 通过 AUTHZ-07 引入同一个包。

### AUTHZ-01 · 创建 `@xiaoli-byte/authz` 包骨架
- **仓库/位置**：ai-knowledge · `packages/authz`
- **依赖**：无
- **步骤**：
  1. 建 `package.json`（`"name": "@xiaoli-byte/authz"`, private, main 指向 dist, 有 build 脚本），复用 `@ai-knowledge/tsconfig`。
  2. 建 `tsconfig.json`、`src/index.ts`，子目录 `src/{core,nestjs,acl,jwt,prisma}/index.ts`（先空导出）。
  3. 确认已被 `pnpm-workspace.yaml` 的 `packages/*` 覆盖，`pnpm install`。
- **验收**：`pnpm --filter @xiaoli-byte/authz build` 通过；根 `pnpm install` 无报错。

### AUTHZ-02 · core：claim 类型 + 权限码规范 + `can()`
- **位置**：`packages/authz/src/core/`
- **依赖**：AUTHZ-01
- **步骤**：
  1. `claims.ts`：`AuthClaims { sub: string; tenantId: string; roles: string[]; email?: string }`。
  2. `permission.ts`：`buildPermission(system, module, action)` → `"{system}:{module}:{action}"`；`PermissionKey` 类型；`Action` 枚举（create/read/update/delete/manage）。
  3. `can.ts`：纯函数 `can(claims, required: PermissionKey[], rolePermMap: Record<role, PermissionKey[]>): boolean`，实现三层判定的「功能级」部分 + `super_admin` 短路。
- **验收**：`packages/authz` 下单测覆盖 `can()`（super_admin 放行 / 缺权限拒绝 / 全含放行）。

### AUTHZ-03 · jwt：签发/校验 + 共享密钥 + refresh 全量哈希
- **位置**：`packages/authz/src/jwt/`
- **依赖**：AUTHZ-02
- **参考来源**：ai-call `apps/api/src/auth/`（auth.service / jwt.strategy / auth.config / auth.controller 的 cookie 部分）。
- **步骤**：
  1. 移植 access/refresh 签发与校验；claim 结构用 AUTHZ-02 的 `AuthClaims`。
  2. Cookie 读写工具（httpOnly，SameSite 同源用 Lax）。
  3. refresh token **全量 bcrypt** 存储 + 旋转（对齐 ai-call，弃用 kb 的「尾部 32 字符」）。
  4. 密钥读 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`（两库配同值即 token 互认）。
- **验收**：单测：签发→校验往返、过期拒绝、refresh 旋转后旧 token 失效。

### AUTHZ-04 · nestjs：全局 Guard + 装饰器 + CLS 租户注入
- **位置**：`packages/authz/src/nestjs/`
- **依赖**：AUTHZ-02, AUTHZ-03
- **参考**：ai-call `JwtAuthGuard`/`PermissionsGuard`/`@Public`/`@RequirePermissions`；ai-knowledge 的 `nestjs-cls` 注入方式。
- **步骤**：
  1. `JwtAuthGuard`（从 cookie 取 token → 校验 → 写 CLS：userId/tenantId/roles）。
  2. `PermissionsGuard` + `@RequirePermissions()` + `@Public()`；调用 core `can()`。
  3. 导出可注册为 `APP_GUARD` 的 provider + CLS 模块封装。
- **验收**：最小 Nest 测试模块：无 token→401、缺权限→403、有权限→200。

### AUTHZ-05 · acl：ResourceGrant 判定 + `visibleWhereSql()`
- **位置**：`packages/authz/src/acl/`
- **依赖**：AUTHZ-02
- **参考来源**：ai-knowledge `apps/api/src/modules/documents/document-access.service.ts`。
- **步骤**：
  1. 抽象出通用 `ResourceGrant` 判定：入参 `resourceType` 参数化（不再写死 document/folder）。
  2. `visibleWhereSql(resourceType, claims): string`（编译进列表/检索查询）；`getAccessFlags()`、`assertAccess()`。
  3. 保留 owner 特权、super_admin/admin 全通、permission_scope 语义。
- **验收**：单测：给定 grants + claims，生成的 where 片段与 flags 正确；跨租户 grant 不可见。

### AUTHZ-06 · prisma：统一模型片段 + seed 工具
- **位置**：`packages/authz/src/prisma/`
- **依赖**：AUTHZ-02
- **步骤**：
  1. `schema.partial.prisma`：`authz-architecture.md` §3 的 Tenant/User/Membership/Role/Permission/RolePermission/ResourceGrant/AuditLog（作为可复制片段，不自动注入宿主 schema）。
  2. `seed-permissions.ts`：把权限码常量数组 + 角色→权限映射幂等落库的工具函数（宿主传入自己的 PrismaClient 与常量）。
- **验收**：在 KB-03 集成时验证 seed 落库成功；本工单先保证 TS 编译与函数签名清晰。

### AUTHZ-07 · 跨仓分发 **[方式已确认：GitHub Packages]**
- **仓库**：both
- **依赖**：AUTHZ-01–06 接口基本稳定
- **已确认**：GitHub Packages 私有包。两仓库实际 owner 都是 `xiaoli-byte`（不是最初设想的 `yixiu`），包名已定为 **`@xiaoli-byte/authz`**（scope 必须等于 GitHub owner，见 architecture.md §5）。
- **已完成的配置**（ai-knowledge 侧）：
  - `packages/authz/package.json`：`name: "@xiaoli-byte/authz"` + `repository` 指回 `xiaoli-byte/yixiu-ai-kb` + `publishConfig.registry=https://npm.pkg.github.com`。
  - build（`pnpm --filter @xiaoli-byte/authz build`）与单测（44/44）已跑通，见 AUTHZ-01~06。
- **剩余手工步骤（需要用户本人的 GitHub 凭证，AI 助手无法代为完成）**：
  1. 在 GitHub 生成一个 PAT（classic 或 fine-grained），发布方权限含 `write:packages`，安装方（ai-call 侧）权限含 `read:packages`（可以是同一个 token）。
  2. 两仓库根目录各建/改 `.npmrc`，追加：
     ```
     @xiaoli-byte:registry=https://npm.pkg.github.com
     //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
     ```
     （`ai-knowledge` 根 `.npmrc` 已有其他配置，追加即可；`ai-call` 根目前没有 `.npmrc`，需新建。）
  3. 本地 `export GITHUB_TOKEN=<你的PAT>`（不要写进任何提交的文件），在 `I:/ai-knowledge` 执行 `pnpm --filter @xiaoli-byte/authz publish --no-git-checks` 发布首个版本。
  4. 在 `I:/ai-call` 执行 `pnpm add @xiaoli-byte/authz`（此时 GITHUB_TOKEN 需在环境中）。
- **验收**：ai-call 能 import `@xiaoli-byte/authz`（及子路径）并 build 通过 —— **该验收待第 3/4 步的手工发布完成后才能满足**；AI 助手已把能自动化的部分（包配置、build、测试）做完。

---

## P1 — ai-knowledge 落地（先做，被依赖方、风险小）

### KB-01 · 引入 `Tenant` 实体 **[高风险·迁移]**
- **仓库**：ai-knowledge
- **依赖**：AUTHZ-06
- **步骤**：
  1. `schema.prisma` 加 `Tenant` model（§3）。
  2. 迁移：为现有 `BOOTSTRAP_TENANT_ID=tenant_demo` 建一行；现有裸 `tenantId` 字段暂**不加外键**（降风险），仅建表 + seed。
  3. seed 建 demo 租户。
- **验收**：`prisma migrate` 通过；库中存在 tenant_demo；现有登录/查询不受影响。

### KB-02 · `User.role` → `Membership.roles[]` **[高风险·迁移]**
- **依赖**：KB-01
- **步骤**：加 `Membership` model；迁移回填（每个 User 按现 `role` 生成一条 `Membership{userId,tenantId,roles:[role]}`）；`User.role` 暂保留并标注 deprecated。
- **验收**：迁移后每 user 有对应 membership；旧接口仍可读到角色（过渡期双读）。

### KB-03 · RBAC 硬编码 → 落库
- **依赖**：KB-02, AUTHZ-06
- **步骤**：把 `common/permissions/permissions.types.ts` 的 `ROLE_PERMISSIONS` 作为常量真相源，用 AUTHZ-06 的 seed 工具落库到 `Role`/`Permission`/`RolePermission`；权限码统一为 `kb:{module}:{action}`。
- **验收**：seed 后库含全部 `kb:*` 权限码与 4 角色映射；`can()` 从库读映射判定与旧硬编码一致（对拍测试）。

### KB-04 · 接入全局 Guard
- **依赖**：KB-03, AUTHZ-04
- **步骤**：`app.module` 注册 `APP_GUARD`（来自 `@xiaoli-byte/authz`）；移除各 controller 分散的 `@UseGuards(AuthGuard('jwt'))`；保留/迁移 `@RequirePermissions`；`@Public` 标注登录等公开路由。
- **验收**：全部受保护路由行为不变；现有 e2e/单测通过。

### KB-05 · 修 `permissions.controller` 半成品
- **依赖**：KB-04
- **步骤**：`getMyPermissions` 用真实 CLS claims（弃 `"current"` 死值）；`updateUserRole` 真正落库（改 Membership）；`getUsersWithRoles` 读真实 role。
- **验收**：三接口返回真实数据 + 单测覆盖。

### KB-06 · refresh token 全量哈希
- **依赖**：AUTHZ-03
- **步骤**：用 `@xiaoli-byte/authz` jwt 的 refresh 实现替换「仅存尾部 32 字符」；`RefreshToken` 表存全量哈希。
- **验收**：刷新往返 + 旋转测试；旧 refresh 失效。

### KB-07 · 前端 token localStorage → cookie
- **依赖**：KB-06
- **步骤**：`apps/web` `lib/api/client.ts` 改用 httpOnly cookie（`credentials:'include'`）；`middleware.ts` 改为读 cookie 做服务端拦截重定向；access TTL 从 7d 收短（如 15m–1h）。
- **验收**：登录后 cookie 下发；未登录访问受保护页被 middleware 重定向。

### KB-08 · 检索接口强制 tenantId 过滤 + service guard **[高风险·安全]**
- **依赖**：KB-04, AUTHZ-05
- **步骤**：`retrieve` 接口接收调用方 `tenantId`(+`userId`)，用 `visibleDocumentWhereSql()` 过滤后返回；加 service-token guard（供 ai-call 服务间调用，复用 `@xiaoli-byte/authz` service-guard）。
- **验收**：构造租户 A/B 文档，A 身份检索**不返回** B 文档；service token 缺失/错误→拒绝；单测覆盖。

---

## P2 — ai-call 落地

### CALL-01 · 引入 `@xiaoli-byte/authz`，替换本地 auth
- **状态**：✅ 已完成（ai-call commit `4b6fdca`）
- **仓库**：ai-call
- **依赖**：AUTHZ-07
- **步骤**：引入包；用其 `JwtAuthGuard`/`PermissionsGuard`/装饰器替换 `apps/api/src/auth` 与 `common/service-auth.guard` 中的本地实现；`app.module` 注册来自包的 `APP_GUARD`。
- **验收**：现有 auth 相关 `*.spec.ts`（含 `internal-endpoints.spec.ts`、`product-module-permissions.spec.ts`）通过。

### CALL-02 · 核心业务表补 `tenantId` **[高风险·迁移]**
- **状态**：✅ 已完成（15 张业务表加 `tenant_id` 并回填至共享默认租户 `tenant_demo`）
- **依赖**：CALL-01, KB-01（共享租户命名空间）
- **步骤**（严格三步）：
  1. 加 `tenantId String?`（nullable）到 OutboundTask/OutboundScenario/TaskFlow/TaskFlowVersion/CallAttempt/Campaign/KnowledgeDocument 等业务表 + `Tenant` model。
  2. 回填现有行为默认租户。
  3. 设非空 + 建 `@@index([tenantId, ...])`。
- **验收**：三步各自 migrate 通过；seed/现有数据完整；typecheck 通过。

### CALL-03 · CLS 租户注入 + 查询强制过滤 **[高风险]**
- **状态**：✅ 已完成（ai-call commit `5fb261d`——Prisma Client Extension 强制过滤 + fail-closed + `runAsSystem` 系统旁路）
- **依赖**：CALL-02
- **步骤**：引入 `nestjs-cls`；在 Prisma service 层（对齐 ai-knowledge `database.service` 的 `get tenantId()`）对业务表查询强制注入 tenantId 过滤。
- **验收**：跨租户读/写被隔离（测试构造双租户数据验证）；现有测试通过。

### CALL-04 · 权限码去「贴标签」
- **状态**：✅ 已完成（ai-call commit `a87144c`；tenant/platform 一并收紧为 admin 专属，修正此前借用 `call:read` 导致的越权）
- **依赖**：CALL-01
- **步骤**：为 campaigns/quality/compliance/analytics/tenants/platform 定义独立 `call:{module}:{action}`（替换借用的 `task:*`/`call:read`/`system:role:*`）；更新各 controller `@RequirePermissions`；更新 `packages/shared/src/auth.ts` 常量与 seed。
- **验收**：typecheck + 权限单测；viewer/operator 可见范围符合预期。

### CALL-05 · 接入 ResourceGrant 数据级 ACL
- **状态**：✅ 已完成（ai-call commit `00d0a5c`）——范围收窄为 owner + 显式授权，未做 DEPARTMENT 主体（`User` 无部门字段）、未接 `campaign`（按「按需」标注本轮跳过）；迁移未在真实库验证。
- **依赖**：CALL-03, AUTHZ-05
- **步骤**：对 `call_task`（及按需 `campaign`）接 ACL；列表/详情查询经 `visibleWhereSql`（如坐席仅见自己或本部门任务）。
- **验收**：数据级测试：非授权用户看不到他人任务。

### CALL-06 · 接 ai-knowledge 检索带租户身份 **[高风险·联调]**
- **状态**：🔴 阻塞——依赖的 KB-08 在 ai-knowledge 尚未实现（无 retrieve 端点、无 service guard、无相关提交），需先在 ai-knowledge 完成 KB-08 才能继续。
- **依赖**：CALL-03, KB-08
- **步骤**：`knowledge-base.service` 调 ai-knowledge `retrieve`，带 `X-Service-Token` + `X-Tenant-Id`/`X-User-Id`（或透传 JWT）；配置 `KNOWLEDGE_SERVICE_BASE_URL`；voice-agent RAG 链路透传租户上下文。
- **验收**：联调 —— 租户 A 通话检索只得 A 文档；service token 校验生效。

### CALL-07 · 修 Cookie CSRF 债
- **状态**：✅ 已完成（ai-call commit `492cc7d`）——实际由 CALL-01 采用 `@xiaoli-byte/authz/jwt` 的 cookie builder 顺带修复（dev/prod 均默认 `sameSite=lax`+`httpOnly=true`），本次补了回归测试锁定。
- **依赖**：CALL-01
- **步骤**：`auth.controller` 生产 `SameSite` 同源改 `Lax`（或加双提交 CSRF token / Origin 校验）。
- **验收**：登录仍工作；跨站伪造请求被拒。

---

## P3 — 可选（未来，非当下）

- 签发收敛为独立 identity 服务 / 真 OIDC SSO（Logto/Keycloak/SuperTokens）；两系统改 OIDC client；`@xiaoli-byte/authz` 校验接口不变。详见 `authz-architecture.md` §9。

---

*本文件为跨系统契约，任何改动需在 ai-call 与 ai-knowledge 两仓库同步。*
