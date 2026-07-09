# 统一鉴权落地工单（authz implementation backlog）

> **共同规范**：与 [`authz-architecture.md`](./authz-architecture.md) 配套。两仓库（ai-call / ai-knowledge）各存一份，内容一致，改动需同步。
>
> 状态：Draft · 2026-07-08 ｜ **P2(ai-call) 进度更新 2026-07-09**：CALL-01~07 代码工单已完成并进 `main`。对照 `authz-architecture.md` §8 的收尾项（决策 2026-07-10）：CALL-09（Campaign ACL）已完成；CALL-08（部门 ACL）ai-call 侧**暂缓**（部门能力落 ai-knowledge）；CALL-12（激活按库过滤）方案定为**配置对齐**（无需代码、运营激活）；**CALL-10（跨仓真隔离实测）已在真环境验证通过（14/14，并修掉一个让 CALL-06 运行时不通的 retrieve 401 bug）**；**CALL-11（迁移真库演练）已在一次性可弃库上演练通过（17 迁移 + 结构/回填校验 + seed 幂等）**。**两个上线阻塞项均已清除，P2(ai-call) 全部收尾完成。** 详见下方各工单「状态」行。

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
| CALL-06 | P2 | call | 接 ai-knowledge 检索带租户身份 ✅已完成 | CALL-03,KB-08 | [高风险] |
| CALL-07 | P2 | call | 修 Cookie CSRF 债 ✅已完成 | CALL-01 | 低 |
| CALL-08 | P2 | call | ResourceGrant 扩到部门(DEPT)主体 ⏸️暂缓（ai-call 侧，部门能力落在 ai-knowledge） | CALL-05 | [高风险] |
| CALL-09 | P2 | call | Campaign 复用 ResourceGrant ACL ✅已完成 | CALL-05 | 中 |
| CALL-10 | P2 | call | CALL-06 跨仓真隔离联调实测 ✅真环境通过（14/14，修 retrieve 401 bug） | CALL-06,KB-08 | [高风险] |
| CALL-11 | P2 | call | CALL-05 迁移真库演练(migrate deploy) ✅演练通过（17迁移+结构/回填+seed幂等） | CALL-05 | [高风险] |
| CALL-12 | P2 | both | 激活按库过滤：kb id ↔ folder id 对齐/映射 🟢方案定：配置对齐（无需代码，运营激活） | CALL-10 | 中 |
| CALL-13 | P3 | both | 身份联合：ai-call 用户在 ai-knowledge 开通/映射真实账号 🟡JIT 开通(a)已落地并加固(租户准入/负缓存/会话生命周期,2026-07-10)；剩(b)非对称签名/角色映射/生命周期同步/email 冲突/独立 IdP | CALL-12,§9 | [高风险] |

**关键路径**：AUTHZ-01→02→(03/04/05/06) → KB-01→02→03→04 →(05/08) → CALL-01→02→03→06 →（上线前）CALL-10/11。
**可并行**：AUTHZ-03/04/05/06 在 02 后可并行；KB-06/07 与 KB-03/04 可并行；CALL-04/07 与 CALL-02/03 可并行；CALL-08/09（范围决策项）与 CALL-10/11（上线阻塞项）互不依赖，可并行。

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
- **状态**：✅ 已完成（ai-knowledge commit 提交，2026-07-09）——新增 `/search/retrieve` 端点供 ai-call 服务间调用，使用 `ServiceAuthGuard` 保护，强制租户隔离和 ACL 过滤。
- **依赖**：KB-04, AUTHZ-05
- **步骤**：`retrieve` 接口接收调用方 `tenantId`(+`userId`)，用 `visibleDocumentWhereSql()` 过滤后返回；加 service-token guard（供 ai-call 服务间调用，复用 `@xiaoli-byte/authz` service-guard）。
- **验收**：构造租户 A/B 文档，A 身份检索**不返回** B 文档；service token 缺失/错误→拒绝；单测覆盖。
### CALL-06 · 接 ai-knowledge 检索带租户身份 **[高风险·联调]**
- **状态**：✅ 代码完成（ai-call commit `8c74101`，2026-07-09）——`voice-agent -> ai-call -> ai-knowledge` 链路已打通：任务上下文透传 `tenantId/ownerId`，RAG 请求补齐 `X-Service-Token` + `X-Tenant-Id`/`X-User-Id`，`knowledge-base.service` 代理切到 `/search/retrieve`，并在缺失租户上下文时 fail-closed。同轮 review 加固：外部模式启动自检（缺 `SERVICE_API_TOKEN` 拒启动）、去死代码、去重复解析。
  - ⚠️ **单测绿但未在真环境验证跨租户隔离** → 拆出 **CALL-10** 作为上线前必做的联调实测。
- **依赖**：CALL-03, KB-08
- **步骤**：`knowledge-base.service` 调 ai-knowledge `retrieve`，带 `X-Service-Token` + `X-Tenant-Id`/`X-User-Id`（或透传 JWT）；配置 `KNOWLEDGE_SERVICE_BASE_URL`；voice-agent RAG 链路透传租户上下文。
- **验收**：单测覆盖身份透传 + fail-closed（KB spec 9/9、voice-agent pytest 17/17）；**真隔离实测见 CALL-10**。

### CALL-07 · 修 Cookie CSRF 债
- **状态**：✅ 已完成（ai-call commit `492cc7d`）——实际由 CALL-01 采用 `@xiaoli-byte/authz/jwt` 的 cookie builder 顺带修复（dev/prod 均默认 `sameSite=lax`+`httpOnly=true`），本次补了回归测试锁定。
- **依赖**：CALL-01
- **步骤**：`auth.controller` 生产 `SameSite` 同源改 `Lax`（或加双提交 CSRF token / Origin 校验）。
- **验收**：登录仍工作；跨站伪造请求被拒。

---

## P2 收尾 — 对照 `authz-architecture.md` §8 仍未闭合的目标

> CALL-01~07 是代码工单；以下 4 项是架构验收目标里尚未达成的部分。**CALL-08/09 是范围决策项**（做不做取决于产品是否需要部门粒度 / Campaign 粒度的数据权限），**CALL-10/11 是上线阻塞项**（安全实测与数据迁移，未过不可上生产）。

### CALL-08 · ResourceGrant 扩到部门(DEPT)主体 **[高风险·需先确认部门模型]**
- **状态**：⏸️ **暂缓（ai-call 侧）**（决策 2026-07-10）。部门能力落在 **ai-knowledge**（已有 `departments` 模块 + `Department` 表 + `User.departmentId`）即可；ai-call 当前**无明确产品驱动**，且任一建模都要动 `User`/JWT claim（高风险迁移）。现阶段「本部门可见」用**显式 grant 给 role/user 模拟**，等有真实客户需求再启动。届时需先定语义（同部门自动互见 vs 显式授权给部门主体）与建模（ai-call 自建 Department vs 把 departmentId 加进 `@xiaoli-byte/authz` claim 复用 kb 部门）。
- ~~**状态（原）**：范围决策，未做 `subjectType=DEPT`。~~ CALL-05 因 `User` 无部门字段**主动收窄**为「owner + 显式授权 + admin」。架构 `authz-architecture.md` §3（`ResourceGrant.subjectType` 含 `DEPT`）与 §7 P2（「坐席只看自己任务/**本部门通话**」）要求部门粒度——该目标由 ai-knowledge 侧承载。
- **依赖**：CALL-05
- **前置确认（不可自行发明）**：是否引入部门模型？建模方式（`Department` 表 + `User.departmentId`，还是复用 org/team 既有结构）？跨租户部门命名空间？——按架构规范，拿不准先问，不擅自造 DEPT 语义。
- **步骤**（确认后）：1) 加部门模型 + 迁移回填；2) `task-acl.ts` 的可见性判定加入 `subjectType=DEPT` 分支（用户所属部门被 grant 即可见）；3) grant 写入/管理入口支持 DEPT 主体。
- **验收**：构造「同租户不同部门」坐席，A 部门坐席看不到仅授予 B 部门的 `call_task`；owner/admin 特权不受影响；单测覆盖 DEPT 分支。

### CALL-09 · Campaign 复用 ResourceGrant ACL **[中]**
- **状态**：✅ 已完成（ai-call，2026-07-09）。Campaign 加 `ownerId`（迁移 `20260709140000_call09_campaign_owner`，可空 uuid + 索引）；抽出通用 `common/resource-acl.ts`（`task-acl` 一并复用，不另造一套），新增 `campaigns/campaign-acl.ts`（`resourceType='campaign'`）；`campaigns.service` 注入 CLS、create 记 `ownerId`、list 走可见性 where、新增 `assertCampaignVisible`（controller `GET :id` 调用，非授权抛 404）。语义与 CALL-05 同构：owner + 显式授权 + admin/super_admin 全见；`ownerId=null`（历史/系统）对租户内 `campaign:read` 持有者公开。
- **依赖**：CALL-05
- **步骤**：Campaign 加 `ownerId`（或复用创建者）+ 迁移；查询/详情走与 `call_task` 同构的 `resourceType="campaign"` 可见性判定；避免另造一套 ACL。
- **验收**：非 owner / 未授权用户不可见他人 Campaign；admin/super_admin 全通；单测覆盖（`campaign-acl.spec` 6/6、`campaigns.service.spec` 新增 4 条 ACL）。迁移真库演练并入 CALL-11（脚本已加 `campaigns.owner_id` 断言）。

### CALL-10 · CALL-06 跨仓真隔离联调实测 **[高风险·联调·上线阻塞]**
- **状态**：✅ **已完成·真环境验证通过**（2026-07-10，本地 ai-call:3001 + ai-knowledge:9999）。`scripts/call-10-cross-tenant-retrieval.mjs` **14/14 必过断言通过**：直连 ai-knowledge 与经 ai-call 代理两条路径下，租户 A 检索共享词只得 A 文档、B 只得 B 文档、命中文档 id 不相交；缺 X-Tenant-Id / X-User-Id → 401；ai-call 缺 X-Service-Token → 401。
  - 🔴 **联调中抓到并修复真 bug**：ai-knowledge `/search/retrieve` 原在 `SearchController`（类级 `AuthGuard('jwt')`），无 JWT 的服务调用被挡成 401 → CALL-06 运行时**实际一直不通**（单测 mock 未覆盖）。已拆到独立 `SearchRetrieveController`（ai-knowledge commit `832daae`）。
  - 说明：本地 ai-knowledge 未配 `SERVICE_API_TOKEN`（dev fail-open），故「缺/错 service token → 401」两条断言在本轮 **skip**；生产两边配 `SERVICE_API_TOKEN` 后应转为通过。`knowledgeBaseId` 作用域探针需两个真实 folder id（CALL-12 配置对齐后验），本轮 skip。
- **依赖**：CALL-06, KB-08（需 ai-knowledge 实例可连）
- **步骤**：1) 起 ai-knowledge，配 ai-call 的 `KNOWLEDGE_SERVICE_BASE_URL` + `KNOWLEDGE_SERVICE_API_TOKEN` + `SERVICE_API_TOKEN`；2) 造租户 A/B 各自文档；3) 用 A 的任务上下文发起通话检索。
- **验收**：租户 A 通话检索**不返回** B 文档；错误/缺失 service token → 被拒。（`knowledgeBaseId` 按库过滤见 CALL-12。）

### CALL-11 · CALL-05 迁移真库演练(migrate deploy) **[高风险·迁移·上线阻塞]**
- **状态**：✅ **真库演练通过**（2026-07-10）。在一次性可弃库 `ai_call_migration_dryrun`（与开发库同服务器、独立空库，跑完即 DROP）上执行全部 17 条迁移：`prisma migrate deploy` 顺序应用无误 → 结构/回填/索引校验全绿（tenant_demo 由迁移自建、15 张表 `tenant_id` NOT NULL+默认+索引、`outbound_tasks`/`campaigns` 的 `owner_id`、`resource_grants` 表与复合索引、无未完成/回滚迁移）→ seed 幂等（连跑两次 permissions 38→38、roles 3→3、outbound_scenarios 3→3，第二次全 `[跳过]`）。演练脚本 `scripts/call-11-migration-dryrun.ps1` + 手册 `docs/testing/call-11-migration-dryrun.md`。**上线阻塞项已清除。**
- **依赖**：CALL-05
- **步骤**：在一次性可弃的库上 `prisma migrate deploy` 演练全部 P2 迁移（tenantId 三步、`ownerId`、`ResourceGrant`），核对回填结果与索引；产出可复现的演练记录（参照 `docs/testing/operations-loop-regression.md`）。
- **验收**：迁移在干净库上顺序执行无误；现有数据回填正确（tenantId=`tenant_demo`、历史任务 `ownerId=null` 按公开语义）；seed 幂等。脚本断言覆盖结构/默认/索引/无 NULL 残留/迁移状态/seed 幂等；真实旧数据回填见手册「分批 deploy」可选演练。

### CALL-12 · 激活按库过滤：kb id ↔ folder id 对齐/映射 **[中]**
- **状态**：🟢 **方案已定：配置对齐（无需代码，运营激活）**（决策 2026-07-10）。CALL-10 一轮里已在 ai-knowledge 实现 `knowledgeBaseId → folder` 按库过滤（优雅兜底：id 不对应真实 folder 则退回租户级）。**决策取方案 (a) 配置对齐**：把 ai-call scenario 的 `knowledgeBaseId`（voice-agent 的 `scenario.knowledge_base_id` / ai-call OutboundScenario 配置）直接填成 ai-knowledge 中目标 folder 的真实 id。零代码，纯配置即激活。
- **依赖**：CALL-10（隔离实测先通过，确认基线安全）
- **激活步骤**：1) 在 ai-knowledge 确认/建立目标知识库对应的 folder，取其 id；2) 把该 folder id 配到 ai-call 对应 scenario 的 `knowledgeBaseId`；3) 用 `scripts/call-10-cross-tenant-retrieval.mjs` 设两个真实 folder id 验证。（若将来出现「一个 KB 跨多 folder / 一个 folder 属多 KB」的需求，再升级到方案 (c) 独立 `KnowledgeBase` 实体。）
- **验收**：`scripts/call-10-cross-tenant-retrieval.mjs` 的场景 4（`KB_ID`/`KB_ID_OTHER` 设为两个真实且文档不同的 folder id）断言 `4.1` 由 WARN 变为通过——不同 kb id 返回不同结果集，按库过滤真正生效。

---

## P3 — 可选（未来，非当下）

- 签发收敛为独立 identity 服务 / 真 OIDC SSO（Logto/Keycloak/SuperTokens）；两系统改 OIDC client；`@xiaoli-byte/authz` 校验接口不变。详见 `authz-architecture.md` §9。

### CALL-13 · 身份联合：ai-call 用户在 ai-knowledge 开通/映射真实账号 **[P3·高风险]**
- **状态**：🟡 **方案 (a) JIT 开通轻量版已落地**（2026-07-10，ai-knowledge commit `0e38ab7`）——`jwt.strategy.validate` 首次见到合法陌生 `userId` 时按 token claim 幂等补建 user 行，修复了上传等写操作的 `owner_id` 外键报错。已实测：ai-call **admin** 与 **非 admin（editor）** 上传文档均正确归其所有（`owner_id` = 上传者、PRIVATE 可见）。
- **2026-07-10 架构 review 加固**（同日落地，ai-knowledge + ai-call）：
  - **JIT 租户准入（fail closed）**：创建前校验 token `tenantId` 已存在于 `tenants` 表且 active + 可选 `FEDERATED_TENANT_ALLOWLIST` 白名单，不满足则拒绝开通并 401——堵住「任意 ai-call 租户被隐式入驻 + 悬空 tenant_id 数据」。
  - **JIT 失败负缓存**：失败（如 email 冲突）后 60s 内同 id 不重试不刷日志；并发首请求主键竞态按成功处理；畸形 cookie 值不再可能把提取器炸成 500。
  - **token 提取顺序**：Bearer 优先、cookie 回落（显式凭证 > 环境凭证，防同域下本地 Bearer 用户被残留 ai-call cookie 顶替身份）。
  - **zone 会话生命周期**：ai-knowledge「退出」在 cookie 会话下先调 ai-call `POST /api/auth/logout` 作废 cookie；cookie 过期 401 时清态并整页跳 ai-call `/login?redirect=…`（原为死路/跳错到本地登录页）；ai-call 登录页 `redirect` 参数防开放重定向 + `/knowledge` 前缀整页导航（跨 zone 软导航本就不通）。
  **剩余范围未排期**：
  - **(b) 非对称签名（信任单向化）**：`packages/authz`（源码在 ai-knowledge 仓 `packages/authz`，经 GitHub Packages 发布）当前硬编码 HS256 共享 secret——ai-knowledge 持同一把钥匙也能**签发**合法 ai-call token，任一侧泄露即两侧全失守。升级步骤：① `packages/authz` 的 `signAccessToken/verifyAccessToken` 增加算法与公私钥参数（向后兼容，缺省仍 HS256）；② 发新版并让 ai-call 升级依赖；③ ai-call 换 RS256/EdDSA 私钥签发、ai-knowledge `jwt.strategy` 改公钥验签；④ 切换窗口内旧 token 全体失效，需选低峰期并同步分发密钥。属协调式迁移（改包+发版+双端同步+token 作废），不适合单仓顺手做，须单独排期。
  - **角色词表映射**（实测缺口）：ai-call 角色 `admin/operator/viewer` 与 ai-knowledge `super_admin/admin/editor/viewer` 只有 `admin`、`viewer` 名字对齐；**ai-call `operator` 映射不到 ai-knowledge `editor`（写权限门槛）→ ai-call operator/viewer 在知识库实为只读，仅 admin 可写**。需一层角色映射（ai-call 角色 → ai-knowledge 角色）。
  - **用户生命周期同步**：JIT 只在首次建行（`update:{}`），之后 ai-call 改角色/停用/删除不联动 ai-knowledge 的开通行（实测：改 ai-call 角色后 ai-knowledge 行 role 仍为旧值；此处不影响鉴权因 RBAC 读 token 角色，但库内数据陈旧）。
  - **email 冲突处理**；以及是否升级到独立 IdP（§9）。
- **背景**：知识库微前端（Multi-Zones）+ 无状态联合登录已落地（见 ai-call 仓 `docs/knowledge-base-microfrontend.md`）：ai-call 的 httpOnly cookie 经统一 JWT 密钥被 ai-knowledge 验签放行，一次登录即用。但两系统**用户表独立**，ai-call 用户的 `sub` 在 ai-knowledge 无对应记录——身份仅是 token claim 层面的「外来信任」：
  - ✅ 租户隔离、按角色访问正常（admin 租户内全见）。
  - ⚠️ **owner 归属功能对 ai-call 身份降级**：非 admin 的 ai-call 用户看不到 ai-knowledge 中按 `owner_id` 私有（`permission_scope=PRIVATE`）的文档，也无法「拥有」自己上传的文档；ResourceGrant 按 USER 主体授权时授不到这个外来 id。
- **目标**：ai-call 用户在 ai-knowledge 拥有真实账号（自动开通 JIT provisioning 或映射表），owner 归属、个人级 ACL、审计主体全部打通。
- **方案候选**（届时决策）：
  - (a) **JIT 开通**：ai-knowledge 首次见到合法 token 的陌生 `sub` 时按 claim 自动建 user 行（email/name/tenantId/role），后续即为真实主体。实现最轻，但需处理 email 冲突/角色同步/停用同步。
  - (b) **映射表**：`external_identities(provider, external_sub, user_id)`，ai-call 身份显式绑定 ai-knowledge 账号；语义最清晰，多一张表和绑定流程。
  - (c) **独立 IdP（§9 全量方案）**：两系统同一 identity 源，`sub` 天然一致；最彻底也最重，与本工单二选一或先 (a)/(b) 过渡。
- **依赖**：CALL-12（微前端+联合登录基线）；与 §9 IdP 演进方向需对齐后再动工。
- **风险**：用户生命周期同步（改角色/停用/删除的跨系统一致性）、email 唯一性冲突、审计主体追溯口径变化——属账号体系改造，须单独评审。
- **验收**：非 admin 的 ai-call 用户经 `/knowledge` 上传文档后成为其 owner；PRIVATE 文档对其可见性与 ai-knowledge 本地账号一致；ResourceGrant 可按该用户授权。

---

*本文件为跨系统契约，任何改动需在 ai-call 与 ai-knowledge 两仓库同步。*
