# CALL-10 · 跨仓真隔离联调实测 运行手册

> 工单见 `docs/authz-implementation-backlog.md` 的 **CALL-10**（上线阻塞项）。
> 驱动脚本：`scripts/call-10-cross-tenant-retrieval.mjs`（零依赖，Node ≥ 18）。

> ✅ **首次真环境验证通过**（2026-07-10，ai-call:3001 + ai-knowledge:9999，两租户 `tenant_demo`/`tenant_b` 各一篇 COMPANY 文档）：**14/14 必过断言通过**。同轮抓到并修复一个 bug——`/search/retrieve` 原在 `SearchController`（类级 `AuthGuard('jwt')`），无 JWT 的服务调用被挡成 401，CALL-06 运行时实际不通；已拆到独立 `SearchRetrieveController`（ai-knowledge commit `832daae`）。本地 ai-knowledge 未配 `SERVICE_API_TOKEN`（dev fail-open），故「缺/错 service token → 401」两条断言 skip；生产两边配同值后应转通过。

## 目的

在**真实运行**的 ai-knowledge 上验证 CALL-06 检索链路的租户隔离——这是 `authz-architecture.md` §6.1 列的最高优先级安全点。CALL-06 的单测（KB spec 9/9、voice-agent 17/17）只覆盖了 ai-call 侧的身份透传与 fail-closed，**从未在真环境验证「租户 A 通话检索不返回租户 B 文档」**。本测补齐该实证。

## 被测链路

```
（脚本模拟 voice-agent）
  └─场景1/2 直连─► ai-knowledge  POST /api/search/retrieve      （SearchController + ServiceAuthGuard）
  └─场景3 端到端─► ai-call       POST /api/knowledge-base/:id/retrieve
                     └─代理─────► ai-knowledge  POST /api/search/retrieve
```

## 前置条件

1. **ai-knowledge API 运行中**，并已按 tenantId 播种两个租户的文档（见「Fixtures」）。
2. **ai-call API 运行中**，且处于外部知识库模式：
   - `KNOWLEDGE_SERVICE_BASE_URL` 指向 ai-knowledge（含 `/api`）。
   - `KNOWLEDGE_SERVICE_API_TOKEN` **等于 ai-knowledge 的 `SERVICE_API_TOKEN`**（两跳令牌必须对齐，否则代理被 ai-knowledge 拒）。
   - `SERVICE_API_TOKEN`（ai-call 入站令牌）已配置——否则 CALL-06 的启动自检会拒绝启动。
3. 令牌关系一览（三个 env，两跳）：

   | 位置 | env | 作用 |
   |---|---|---|
   | ai-call 入站 | `SERVICE_API_TOKEN` | 校验 voice-agent（或本脚本）打 ai-call 的 `X-Service-Token` |
   | ai-call 出站 | `KNOWLEDGE_SERVICE_API_TOKEN` | ai-call 代理 ai-knowledge 时带的 `X-Service-Token` |
   | ai-knowledge 入站 | `SERVICE_API_TOKEN` | 校验上一行；**必须等于 ai-call 的 `KNOWLEDGE_SERVICE_API_TOKEN`** |

   最省心：三者取同一个值。

## 脚本环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_CALL_BASE` | `http://127.0.0.1:3001/api` | ai-call API 根 |
| `AI_KNOWLEDGE_BASE` | `http://127.0.0.1:3010/api` | ai-knowledge API 根 |
| `SERVICE_API_TOKEN` | （空） | ai-knowledge 入站令牌；直连场景与端到端出站都用它 |
| `AI_CALL_SERVICE_TOKEN` | 回退到 `SERVICE_API_TOKEN` | ai-call 入站令牌（脚本打 ai-call 用） |
| `TENANT_A` / `USER_A` | `tenant-a` / `user-a` | 租户 A 身份（须与 fixtures 一致） |
| `TENANT_B` / `USER_B` | `tenant-b` / `user-b` | 租户 B 身份 |
| `KB_ID` | `kb-collection` | ai-call scenario 的 knowledgeBaseId（透传给 ai-knowledge） |
| `KB_ID_OTHER` | （空） | 同租户 A 下另一个库 id，用于 knowledgeBaseId 作用域探针（可选） |
| `QUERY_SHARED` | `SHAREDTERM` | 两租户文档都含的检索词 |
| `MARKER_A` / `MARKER_B` | `ALPHAMARK` / `BETAMARK` | 各租户文档专属标记，用于判断结果归属 |
| `TOP_K` | `5` | 检索条数 |

## Fixtures（两租户各一篇文档）

核心约定：**两篇文档都含 `QUERY_SHARED`**（否则跨租户命中无从比较），**各自含 `MARKER_A` / `MARKER_B`**。

- 租户 A 文档正文示例：`... SHAREDTERM 关于延期政策 ... ALPHAMARK ...`
- 租户 B 文档正文示例：`... SHAREDTERM 关于延期政策 ... BETAMARK ...`

### 方式一（推荐）：走 ai-knowledge 真实上传接口

用两个分属租户 A / B 的用户登录 ai-knowledge，各上传一篇上述文档，等待解析+索引完成（`d.searchable = TRUE`）。这条路径能保证 ACL / 索引 / 权限范围都正确，最贴近真实。用户可见性方面，最简单是把文档权限范围设为**租户内公开**（如 `COMPANY`），或归属为对应的 `USER_A`/`USER_B`。

### 方式二（快速）：SQL 直插（keyword 模式）

若只想快速验证隔离、不跑完整摄取管线：向 ai-knowledge 库直插 `documents` + 对应 chunk 行，`mode` 用 `keyword` 走 BM25/trgm 免向量。注意 `search.service` 的可见性由 `visibleDocumentWhereSql` 决定，须保证：`searchable=TRUE`、`archived=FALSE`、`tenant_id` 正确、`permission_scope` 对服务调用者可见（如 `COMPANY`）或 `owner_id = USER_x`。

> ⚠️ 具体列名/表名（`documents`、chunk 表、`permission_scope` 取值、trgm/tsvector 触发器）以 ai-knowledge 的 `schema.prisma` 与迁移为准，直插前先核对，避免播种出「存在但检索不到」的行。方式一免去这些坑。

## 运行

```bash
# 三令牌取同值示例
export SERVICE_API_TOKEN=dev-shared-service-token
export TENANT_A=tenant-a USER_A=user-a
export TENANT_B=tenant-b USER_B=user-b
export KB_ID=kb-collection QUERY_SHARED=SHAREDTERM MARKER_A=ALPHAMARK MARKER_B=BETAMARK
# 可选：knowledgeBaseId 作用域探针
export KB_ID_OTHER=kb-other

node scripts/call-10-cross-tenant-retrieval.mjs
```

退出码：任一**【必过】**断言失败 → `1`；全过（含仅 WARN）→ `0`。

## 判定标准

**【安全·必过】**
- `1.3` / `1.4`：ai-knowledge 直连，A 结果不含 `MARKER_B`、B 结果不含 `MARKER_A`。
- `1.5`：A/B 命中文档 id 集合不相交。
- `3.2` / `3.3`：经 ai-call 端到端，同样的租户隔离成立。

**【鉴权·必过】**
- `2.1` / `2.2`：ai-knowledge 缺/错 `X-Service-Token` → 401（需 ai-knowledge 配了 `SERVICE_API_TOKEN`，否则跳过）。
- `2.3` / `2.4`：缺 `X-Tenant-Id` / `X-User-Id` → 401。
- `3.4`：ai-call 缺 `X-Service-Token` → 401。

**就绪性**：`1.1` A 查询命中非空——若为 0，是 fixtures 未播种/未索引，先修 fixtures 再谈隔离。

## 两处契约缺口（已修复，此处记录激活条件与验证方式）

> 下面两条曾是 CALL-06 落地后发现的缺口，现已分别在 ai-knowledge / ai-call 修复。脚本的场景 4 / 2.4 用于回归验证。

### 1. `knowledgeBaseId` 按库过滤 — 已在 ai-knowledge 实现（映射到 folder，优雅兜底）
**原状**：`/search/retrieve` 用 `SearchQuery`（zod）解析，旧 schema 不含 `knowledgeBaseId`，字段被剥离 → 检索是租户级全库，选库失效（隔离不受影响，属功能性错误）。

**修复**（ai-knowledge，`SearchQuery` + `SearchController.retrieve` + `search.service`）：ai-knowledge 以 **folder** 为知识库维度，`knowledgeBaseId` 映射到 `documents.folder_id`。`search()` 里的 `resolveKnowledgeBaseFilter` 做**优雅兜底**：
- `knowledgeBaseId` 在调用方租户下**对应一个真实 folder** → 按 `folder_id` 过滤（真正按库检索）。
- **不对应任何 folder** → 丢弃该过滤，退回租户级全库检索（**绝不因未对齐 id 返回空**）。

**激活条件（重要）**：ai-call 的 kb id（如 `kb-collection`）与 ai-knowledge 的 folder id 目前**尚未对齐**，故默认仍表现为租户级。**CALL-12 决策（2026-07-10）取「配置对齐」方案**：把 ai-call scenario 的 `knowledgeBaseId`（voice-agent `scenario.knowledge_base_id` / ai-call OutboundScenario 配置）直接填成 ai-knowledge 中目标 folder 的真实 id，即零代码激活按库过滤。验证时把本手册的 `KB_ID` / `KB_ID_OTHER` 设为两个真实且文档不同的 folder id，场景 4 的 `4.1` 应由 WARN 变为通过。

**脚本场景 4 的解读**：
- 若 `KB_ID` / `KB_ID_OTHER` 都不是真实 folder id → 两者都走兜底、结果集相同 → WARN「未按库过滤（id 未对齐）」。**这是预期**，不代表回归失败。
- 若两者是同租户下两个真实且文档不同的 folder id → 结果集应不同 → 断言 `4.1` 变为通过（按库过滤生效）。

### 2. `X-User-Id` 缺失（ownerId=null 的历史/系统任务）→ 401 — 已在 ai-call 修复
**原状**：ai-knowledge 的 `ServiceAuthGuard` 强制要求 `X-User-Id`；ai-call 的 `X-User-Id = task.ownerId`，而 CALL-05 保留了系统/历史任务 `ownerId=null` → 这类任务被 ai-knowledge 401 → 降级空上下文，做不了 RAG。

**修复**（ai-call，`knowledge-base.service` 的 `resolveIdentity`）：无用户上下文时回退到服务账号 `KNOWLEDGE_SERVICE_FALLBACK_USER_ID`（默认 `system`）。该账号不 own/被授予任何文档，只能检索到租户公开文档（`permission_scope=COMPANY/PUBLIC`），语义上等价「系统任务按租户公开语料检索」。

**验证**：场景 2.4「缺 X-User-Id → 401」验证 ai-knowledge 侧的强约束仍在；而经 ai-call 端到端（场景 3）时，即便任务 `ownerId=null`，ai-call 也会补上 `X-User-Id=system`，故不会 401。若要专门验证 fallback，可用一个 `ownerId=null` 的任务走 voice-agent → ai-call 链路，观察 ai-knowledge 收到 `X-User-Id: system`。

## 已知限制（按库过滤功能，非 bug）

- **精确 folder 匹配，不含子文件夹**：`knowledgeBaseId` 生效时按 `d.folder_id = <id>` 精确匹配，只检索直接挂在该 folder 下的文档。若某「知识库」= folder + 其子树，子文件夹文档不会被检索到。与 ai-knowledge 现有 `categoryId` 过滤行为一致，作为 v1 可接受；若需子树语义，改为 `folder_id IN (子树)`。
- **`knowledgeBaseId` 仅在 `/search/retrieve` 接线**：它进了共享 `SearchQuery` schema，面向用户的 `POST /search`（`handleSearch`）会解析但忽略该字段。无害，暂不影响用户搜索。

## 产出与回填

跑通后：
- 若全【必过】通过 → 在 CALL-10 工单「状态」记录：日期、ai-knowledge commit、隔离实测通过。
- 场景 4 / 2.4 的两个缺口按上面决策落地（可能派生新工单或改回 CALL-06/CALL-05）。
- 迁移相关另见 **CALL-11**（真库 `migrate deploy` 演练）。
