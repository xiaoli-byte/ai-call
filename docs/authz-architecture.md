# 统一鉴权与权限架构（authz-architecture）

> **共同规范**：本文件是 `ai-call`（外呼系统）与 `ai-knowledge`（知识库系统，GitHub: yixiu-ai-kb）两个仓库的**共享权限设计规范**。两仓库各存一份，**内容必须保持一致，修改一处需同步另一处**。
>
> 状态：Draft · 起草日期 2026-07-08 · 适用于两系统「未上线、高速迭代」阶段的重做。
>
> **2026-07-16 修订**：§8 ai-knowledge 清单勾选全局 `APP_GUARD`（默认拒绝反转）、`permissions.controller` 半成品修复、检索接口 tenantId 过滤（补勾）；§4 补充角色词表代码真相源说明。**待同步 ai-call 仓库**（本文件与 ai-call 仓一份需保持一致，见下方共同规范）。
>
> **2026-07-17 状态校准**：`Tenant` 实体与 JIT 租户准入已完成（KB-01）；数据库驱动权限矩阵暂缓至出现「租户自定义角色」需求（KB-03），不应再被视作普通进行中事项。KB-02/06/07 已完成 Membership 双读双写、全量 bcrypt refresh token 轮换和 httpOnly Cookie 会话迁移；示例 access TTL 已收紧至 15m。`@xiaoli-byte/authz@0.3.0` 已发布，ai-call 已升级依赖，并在调用 ai-knowledge 时通过 `resolveKbRole()` 规范化角色声明。CALL-12 的多知识库选择与联合检索已实现，仍需逐场景配置真实 folder 并实测。CALL-13 的 JIT、角色映射、用户生命周期同步与 email 冲突保护已完成；上线后须运行一次历史用户回填。KB-10 的 RS256 源码、依赖、配置和测试已完成；生产环境仍须部署各自私钥与对应公钥，并在低峰期使旧 HS256 access token 自然失效后切换。部门 ACL（CALL-08）与独立 IdP/OIDC 均为明确暂缓的后续范围。

---

## 0. 为什么要一起重做

两个系统不是独立产品，而是有**调用关系**：

```
ai-call（通话中做 RAG 检索）── 调用 ──► ai-knowledge（作为知识库服务）
```

叠加**真多租户**（多个互不可见的客户）需求，推导出一条优先级最高的约束：

> 🔴 **ai-call 里租户 A 的通话，去 ai-knowledge 检索时，绝不能拿到租户 B 的文档。**
> 检索发生在通话实时链路里，一旦租户 / 权限过滤缺失即为跨租户数据泄露。
> 现状：ai-call 的 `KNOWLEDGE_SERVICE_BASE_URL` 尚为空（走 mock），**这条集成还没接** —— 正好现在把鉴权设计对，避免接完再补。

因此这不是「各做各的权限」，而是**一套横跨两系统的统一 authz 地基**。

### 现状：两个系统各做对了一半（互补）

| 能力 | ai-call | ai-knowledge | 采用谁 |
|---|---|---|---|
| RBAC 数据库驱动 | ✅ User-Role-Permission 表 + seed | ❌ 硬编码 `permissions.types.ts`，无 Role 表 | **ai-call** |
| 全局守卫 | ✅ `APP_GUARD` 全局 | ❌ 各 controller 分散 `@UseGuards` | **ai-call** |
| 认证载体 | ✅ httpOnly Cookie | ✅ httpOnly Cookie + middleware 拦截（KB-07，2026-07-17） | 两侧对齐 |
| refresh token | ✅ 全量 bcrypt 存表 | ✅ 不透明 token + 全量 bcrypt 存表、单次轮换（KB-06，2026-07-17） | 两侧对齐 |
| 角色归属 | ✅ Role 多对多 | ✅ `Membership.roles[]` + `User.role` 过渡期双读双写（KB-02，2026-07-17） | 模型语义对齐 |
| 数据级 / 资源级 ACL | ❌ 无 | ✅ document/folder `subjectType(USER/DEPT/ROLE)` + `visibleWhereSql()` + 审计 | **ai-knowledge** |
| 租户全链路注入 | ❌ tenantId 只在计费表（假多租户） | ✅ CLS 全链路注入，业务表带 tenantId | **ai-knowledge** |

**结论**：把 ai-call 的「数据库驱动 RBAC + 全局 Guard + Cookie 认证」与 ai-knowledge 的「数据级 ACL + 审计 + CLS 租户注入」合并，抽成共享包，即目标形态。消灭「一个人维护两套权限心智模型」。

---

## 1. 核心设计决策

1. **统一租户身份，但不引入重量级 IdP**：用「共享 JWT 签名密钥 + 统一 claim 结构」实现 token 互认（穷人版 SSO）。一个系统签的 token，另一个用同一个包即可校验。规模上来后再把「签发」收敛为独立 identity 服务 —— 升级路径无缝，包接口不变。
2. **抽共享包 `@xiaoli-byte/authz`**：权限内核只写一次，两库复用。
3. **三层判定顺序**贯穿两系统：`super_admin 短路 → 租户隔离 → 功能级 RBAC → 资源级 ACL`。
4. **权限码是类型安全的常量（真相源）→ seed 落库（可运行时配置）**：兼顾类型安全与可配置。ai-call 已如此，ai-knowledge 对齐。

---

## 2. 目标架构总图

```
                        ┌──────────────────────────────────┐
                        │   统一租户 / 身份命名空间          │
                        │   Tenant · User · Membership       │
                        │   （同一个 tenantId 两系统都认）   │
                        └───────────────┬──────────────────┘
                                        │ 共享 JWT 签名密钥 + 统一 claim
                                        │ { sub, tenantId, roles[] }
          ┌─────────────────────────────┴─────────────────────────────┐
          ▼                                                            ▼
┌────────────────────┐     服务间调用（带用户/租户身份）    ┌────────────────────┐
│  ai-call           │ ───────────────────────────────────►│ ai-knowledge       │
│  功能级 RBAC        │   POST /retrieve                     │  功能级 RBAC       │
│  + 数据级 ACL(待补) │   Bearer JWT 或                      │  + 数据级 ACL(已有)│
│  + 租户隔离(待补)   │   X-Service-Token + X-Tenant/User    │  visibleWhereSql() │
└────────────────────┘                                      └────────────────────┘
                    ╲                                        ╱
                     ╲     共享权限内核 @xiaoli-byte/authz         ╱
                      ╲  Guard·装饰器·CLS·权限码规范·ACL 引擎╱
                       ╲──────────────────────────────────╱
```

---

## 3. 统一数据模型（两系统共用同一套建模约定）

```prisma
model Tenant   { id String @id; slug String @unique; name String; status String }
model User     { id String @id; email String @unique; passwordHash String /* 全局用户，不再挂 role 单字段 */ }
model Membership {
  userId   String
  tenantId String
  roles    String[]        // 用户 × 租户 × 角色；解决 kb「一人一角色」
  @@id([userId, tenantId])
}
model Role     { id String @id; tenantId String?; key String; name String /* tenantId=null 为系统内置角色 */ }
model Permission { id String @id; key String @unique /* "{sys}:{module}:{action}" */ }
model RolePermission { roleId String; permissionId String; @@id([roleId, permissionId]) }

// 数据级 ACL —— 从 ai-knowledge 的 document_permissions/folder_permissions 抽象为通用
model ResourceGrant {
  id           String @id
  tenantId     String
  resourceType String   // "document" | "folder" | "call_task" | "campaign" ...
  resourceId   String
  subjectType  String   // "USER" | "DEPT" | "ROLE"
  subjectId    String
  perms        Int      // 位掩码：view/download/edit/delete/manage
}
model AuditLog { id String @id; tenantId String; actor String; action String; subject String; details Json }
```

**关键点**
- 角色从「User 上的单字段」升级为 `Membership.roles[]` —— 支持一个用户在不同租户拥有不同角色。
- `ResourceGrant` 是 ai-knowledge 已有能力的通用化；ai-call 后续给 `call_task`/`campaign` 复用同一张表与同一套判定。
- **多租户隔离硬规则**：所有业务表带 `tenantId`；查询强制经 CLS 注入的 tenantId 过滤（见 §6）。ai-call 的核心业务表（OutboundTask/Scenario/TaskFlow/CallAttempt…）目前**缺 tenantId，必须补**。

---

## 4. 权限码规范

**统一命名空间，按系统前缀区分**：`{system}:{module}:{action}`

```
kb:document:read      kb:document:manage    kb:folder:create
call:task:dispatch    call:campaign:update  call:compliance:read
```

规则：
- 每个模块**注册自己的权限码**。解决 ai-call 现状的「贴标签复用」（campaigns 借 `task:*`、compliance/quality 借 `call:read`、tenants 借 `system:role:*`）——敏感面（合规审计、计费、租户管理）必须有独立权限码。
- 代码常量为真相源（ai-call 的 `PERMISSIONS`、kb 的 `permissions.types.ts` 保留），`seed` 落库到 `Permission`/`Role`/`RolePermission`。
- 内置角色跨系统对齐：`super_admin / tenant_admin / operator(editor) / viewer`。角色可系统专属，也可跨系统共用。
- **角色词表/层级/别名映射的代码真相源**：`packages/authz/src/core/roles.ts`（`@xiaoli-byte/authz@0.3.0`，2026-07-17）——`CANONICAL_ROLES`/`KB_ROLES`/`ROLE_RANK`/`TO_KB_ROLE`/`resolveKbRole`。两侧系统一律 `import` 消费，禁止各自复制一份映射表。**未知联合角色策略**：token 角色不在词表内 → 拒绝并告警（直接鉴权为 401、服务代理为 403；fail closed），不做静默降级。

判定顺序（`@xiaoli-byte/authz` 统一实现）：

```
1. super_admin           → 直接放行
2. 租户隔离               → 非本租户资源直接不可见（CLS tenantId 过滤）
3. 功能级 RBAC            → user 的 roles→permissions 是否含所需 permission（进不进得了接口）
4. 资源级 ACL             → ResourceGrant 是否授予该 subject 对该 resource 的操作位（能不能动这条数据）
```

---

## 5. `@xiaoli-byte/authz` 共享包

框架无关核心 + NestJS 适配两层：

| 模块 | 内容 | 来源 |
|---|---|---|
| core | 权限码规范、`can(subject, permission)`、三层判定、claim 类型定义 | 新写 |
| nestjs | 全局 `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions()` + CLS 租户注入 | 取 **ai-call** |
| acl | `ResourceGrant` 判定 + `visibleWhereSql()` 查询编译 | 取 **ai-knowledge** |
| jwt | 统一签发/校验（共享密钥）、Cookie 载体、refresh 全量哈希 | 取 **ai-call** |
| prisma | §3 schema 片段（参考模型）+ seed 工具 | 新写 |

**两个独立 git 仓库如何共享一个包**（个人维护，按省心程度）：
1. **GitHub Packages 私有 npm 包**——推荐，已有 GitHub，已采用。
   - **scope 必须等于拥有仓库的 GitHub org/user**（GitHub Packages 的硬约束，不是命名喜好）。两仓库实际都在 `github.com/xiaoli-byte/*` 下，因此包名是 `@xiaoli-byte/authz`，**不是**最初设想的 `@yixiu/authz`（`yixiu` 只是 `yixiu-ai-kb` 这个仓库名的一部分，不是 GitHub 账号）。
   - 包源码放 ai-knowledge `packages/authz`，`package.json` 带 `repository` 指回 `xiaoli-byte/yixiu-ai-kb` 与 `publishConfig.registry=https://npm.pkg.github.com`。
   - 发布/安装都需要一个有 `write:packages`（发布方）/ `read:packages`（安装方）权限的 GitHub PAT，通过 `.npmrc` 的 `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}` 读取环境变量，**不写入仓库**。
2. `git subtree` / submodule 塞进两库的 `packages/authz`。
3. ❌ 不推荐硬合成一个 monorepo：高速迭代期合仓成本高、爆炸半径大。

---

## 6. 两个必须做对的跨系统安全点

### 6.1 RAG 检索的租户 + 权限过滤（最高优先级）
- ai-knowledge 的检索接口接收调用方 `tenantId`（+ 可选 `userId`），用已有的 `visibleDocumentWhereSql()` **过滤后再返回**给 ai-call 的 voice-agent。
- ai-call 侧调用带 `X-Service-Token`（服务信任）+ `X-Tenant-Id` / `X-User-Id`，或直接透传用户 JWT。
- **不做此过滤，多租户即为纸面。**

### 6.2 服务间信任边界
- 复用 ai-call 已有的 `SERVICE_API_TOKEN`（+ 可选 HMAC 时间戳签名）机制，**对称地**用到「ai-call ↔ ai-knowledge」这条新链路，由 `@xiaoli-byte/authz` 的 service-guard 统一实现。**不要发明第二套。**

---

## 7. 分阶段落地路径（不阻塞现有迭代）

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 地基** | 抽 `@xiaoli-byte/authz` 骨架 + 统一 `Tenant/User/Membership/Role/Permission/ResourceGrant` 模型 + 统一 JWT claim 与共享签名密钥 | 两库能互认 token |
| **P1 ai-knowledge**（先做，风险小、被依赖） | RBAC 硬编码→落库；补 `Tenant` 实体；上全局 Guard；修 `permissions.controller` 半成品；检索接口暴露租户过滤 | kb 权限可配置 + 检索安全 |
| **P2 ai-call** | 业务表加 `tenantId` + CLS 强制过滤（补齐假多租户）；接入 ACL（坐席只看自己任务/本部门通话）；权限码去「贴标签」；接 ai-knowledge 检索带租户身份 | ai-call 真隔离 + 数据级权限 |
| **P3 可选** | 签发收敛为独立 identity 服务 / 真 OIDC SSO | 终端 SSO |

**顺序理由**：先 P0 立规范与模型；**P1 先做 ai-knowledge**（被依赖方、ACL 已成熟、改造风险小）；它稳了，P2 的 ai-call 才有安全的知识库可接。

---

## 8. 各系统改造清单

### ai-call（`@ai-call`）
> 进度对照见 `authz-implementation-backlog.md`（CALL-01~12）。以下勾选反映 2026-07-10 `main` 实况：**P2(ai-call) 全部收尾完成，两个上线阻塞项(CALL-10/11)均已清除。**
- [x] 核心业务表补 `tenantId`（OutboundTask/OutboundScenario/TaskFlow/TaskFlowVersion/CallAttempt/Campaign/KnowledgeDocument…）+ 数据迁移回填。（CALL-02；**迁移真库演练已通过**——一次性可弃库 17 迁移顺序应用 + 结构/回填/索引校验 + seed 幂等，见 CALL-11）
- [x] CLS 注入 tenantId，所有 Prisma 查询强制租户过滤（对齐 ai-knowledge 的 `database.service` 模式）。（CALL-03，fail-closed + `runAsSystem` 旁路）
- [x] 权限码去「贴标签」：给 campaigns / quality / compliance / analytics / tenants / platform 定义独立 `call:{module}:{action}`。（CALL-04；tenant/platform 一并收紧为 admin 专属）
- [x] 接入 `ResourceGrant` 数据级 ACL（如坐席只见自己 `call_task`）。（CALL-05：`call_task` owner + 显式授权 + admin；CALL-09：**Campaign 复用**（共用 `common/resource-acl.ts`）。**部门(DEPT)主体** → CALL-08 **ai-call 侧暂缓**，部门能力落在 ai-knowledge；无产品驱动前不付高风险 User/claim 迁移。）
- [x] 接 ai-knowledge 检索时传 `X-Tenant-Id`/`X-User-Id` 或透传 JWT。（CALL-06 代码完成；**CALL-10 真环境隔离实测已通过（14/14）**，并修掉一个让服务调用被 JWT 类守卫挡成 401 的 retrieve bug——§6.1「最高优先级」安全点已实证。）
- [x] 现存安全债顺带修：生产 Cookie `SameSite=None`→同源改 `Lax` 或加 CSRF（见 ai-call 架构评审）。（CALL-07，由 CALL-01 的 cookie builder 顺带修复 + 回归测试）
- [x] 用 `@xiaoli-byte/authz` 替换本地 auth/permissions 实现。（CALL-01）

### ai-knowledge（`@ai-knowledge` / yixiu-ai-kb）
- [ ] RBAC 从 `permissions.types.ts` 硬编码 → `Role`/`Permission`/`RolePermission` 落库 + seed。（**暂缓**：仅在出现「租户自定义角色」需求时启动；角色词表、别名与层级已先收敛至 `@xiaoli-byte/authz`，见 KB-03。）
- [x] 建 `Tenant` 实体。（KB-01 已完成：`schema.prisma` 已有 `Tenant` model，JIT 租户准入要求 token `tenantId` 对应的租户存在且为 active；`BOOTSTRAP_TENANT_ID` 仅保留为引导配置，不再表示「无表」。）
- [x] `User.role` 单字段 → `Membership.roles[]`。（KB-02，2026-07-17：已有 migration 的回填结果已接入应用读写；Membership 优先读取，`User.role` 在过渡期双写/回退读取，管理端单角色变更写为 `roles:[role]`。）
- [x] 上全局 `APP_GUARD`（当前各 controller 分散 `@UseGuards`）。（2026-07-16：`app.module` 全局注册 `JwtAuthGuard`+`PermissionsGuard`，且 `PermissionsGuard` 反转为**默认拒绝**——非 `@Public` 路由无权限声明即 403，而非原来的「无声明即放行」；见 backlog KB-04。）
- [x] 修 `permissions.controller` 半成品（`getMyPermissions` 死值、`updateUserRole` 未落库、`getUsersWithRoles` 占位）。（2026-07-16：三处桩已全部接线；并发现 `PermissionsModule` 此前从未注册 `controllers`，`/api/permissions/*` 历史上从未真正挂载，本次一并修复，见 backlog KB-05。）
- [x] refresh token 全量哈希存储。（KB-06，2026-07-17：使用不透明的「记录 ID + 随机秘密」token；完整 token 以 bcrypt 哈希存储，刷新时验证哈希并原子撤销旧记录、签发新 token。）
- [x] 检索接口显式接收并强制 `tenantId` 过滤（`visibleDocumentWhereSql` 已有，补服务入口）。（backlog KB-08 已标 2026-07-09 完成；此前本文件与 backlog 未同步勾选，本次补勾。）
- [x] 前端 token：localStorage → httpOnly cookie（使 `middleware.ts` 能做服务端拦截）；access TTL 从 7d 收短。（KB-07，2026-07-17：API 仅以 cookie 下发 access/refresh，前端不再持久化 token；示例 TTL 为 15m，生产环境须同步设置 `JWT_ACCESS_TTL=15m`。）
- [ ] 用 `@xiaoli-byte/authz` 替换本地实现。（**部分完成**：角色词表、access JWT 签发、refresh 哈希/轮换和 cookie builder 已复用；保留本地 Nest 适配层以承载 JIT 用户开通、Bearer 兼容及暂缓的硬编码权限矩阵。RBAC 落库恢复时再收敛该适配层。）

---

## 9. 升级到真 SSO 的路径（P3，非当下）

当需要终端用户「一次登录用两个系统」的真单点登录时：
- 把「签发」从各系统内的 `AuthService` 收敛到独立 identity 服务（自建，或选 Logto / Keycloak / SuperTokens 做 OIDC provider）。
- 两系统改为该 IdP 的 OIDC client，仅保留「本系统内该用户的角色 / ResourceGrant」。
- `@xiaoli-byte/authz` 的校验接口不变（仍是「验 token → 得 claim → 三层判定」），仅签发方改变 —— 因此现在的「共享密钥互认」是该终局的平滑前身。

---

*本文件为跨系统契约，任何改动需在 ai-call 与 ai-knowledge 两仓库同步。*
