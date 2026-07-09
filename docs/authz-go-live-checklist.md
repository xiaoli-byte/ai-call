# P2 统一权限 · 上线 Checklist（ai-call ↔ ai-knowledge）

> 面向：把 P2 统一权限（CALL-01~12）从开发环境推到生产。
> 前提：代码工单全部合并进 `main`（CALL-01~09）、两个上线阻塞项已在本地演练/实测通过（CALL-10 真隔离、CALL-11 迁移真库演练）。本清单是**部署动作**，非编码工单。
> 关联文档：`authz-architecture.md`（§6 安全、§8 清单）、`authz-implementation-backlog.md`、`docs/testing/call-10-cross-tenant-retrieval.md`、`docs/testing/call-11-migration-dryrun.md`、`docs/testing/operations-loop-regression.md`。

---

## 0. 上线前冻结检查

- [ ] `main` 绿：`pnpm check`（shared build → prisma generate → typecheck → 全部 TS & Python 测试）本地全过。
- [ ] 两仓 `docs/authz-architecture.md` 与 `docs/authz-implementation-backlog.md` **字节一致**（改任一必同步另一仓）。
- [ ] 已对生产库做**全量备份 / 快照**，且验证过可恢复（迁移含 `tenant_id` NOT NULL 收紧，回滚代价高）。

---

## 1. 环境变量（最容易出错，先对齐）

### 1.1 服务间令牌 —— 两跳，三个 env 必须对齐
CALL-06 的检索链路是 `voice-agent → ai-call → ai-knowledge`，跨两跳鉴权：

| 位置 | env | 作用 | 约束 |
|---|---|---|---|
| ai-call 入站 | `SERVICE_API_TOKEN` | 校验 voice-agent 打 ai-call 的 `X-Service-Token` | 非空（否则 CALL-06 外部模式**启动自检拒绝启动**）|
| ai-call 出站 | `KNOWLEDGE_SERVICE_API_TOKEN` | ai-call 代理 ai-knowledge 时带的 `X-Service-Token` | **必须等于下一行** |
| ai-knowledge 入站 | `SERVICE_API_TOKEN` | 校验上一行 | **必须等于 ai-call 的 `KNOWLEDGE_SERVICE_API_TOKEN`** |

- [ ] 三者按上表配置（最省心：ai-call 的 `KNOWLEDGE_SERVICE_API_TOKEN` == ai-knowledge 的 `SERVICE_API_TOKEN`；均为强随机、非默认值）。
- [ ] ai-call `KNOWLEDGE_SERVICE_BASE_URL` 指向生产 ai-knowledge（含 `/api`），**不为空**（为空=走 mock，RAG 不接真库）。
- [ ] ai-knowledge 生产**已配 `SERVICE_API_TOKEN`**（dev fail-open 只在非 prod；生产缺 token 会拒绝服务调用）。
- [ ] voice-agent 侧 `SERVICE_API_TOKEN` == ai-call 入站 `SERVICE_API_TOKEN`。

### 1.2 JWT 互认与其它安全项
- [ ] 两系统共享 **JWT 签名密钥**一致（token 互认前提）；生产密钥**必须是强随机值**且非开发默认值——HS256 共享 secret 意味着任一侧泄露即两侧全失守（持钥即可签发对方 token），泄露时须两侧同步轮换。信任单向化（非对称签名）见 backlog CALL-13(b)。
- [ ] ai-knowledge 生产**已配 `FEDERATED_TENANT_ALLOWLIST`**（联合登录 JIT 开通的租户白名单，逗号分隔）；未设时仅要求租户已存在于 `tenants` 表且 active。
- [ ] `VOICE_AGENT_WS_TOKEN` 已配（语音 WebSocket 鉴权）。
- [ ] `CORS_ORIGINS` 为明确白名单，**生产绝不为 `*`**。
- [ ] `INTEGRATION_CONNECTOR_ALLOWLIST` 限定为 `mock://` 或白名单 HTTPS。
- [ ] `KNOWLEDGE_SERVICE_FALLBACK_USER_ID`（默认 `system`）符合预期——`ownerId=null` 的系统/历史任务将以此身份仅检索**租户公开语料**（`permission_scope=COMPANY/PUBLIC`）。

---

## 2. 数据库迁移（CALL-02/05/09）

> 演练已在一次性可弃库通过（CALL-11）：17 迁移顺序应用 + 结构/回填/索引校验 + seed 幂等。生产按下列执行。

- [ ] **生产用 `prisma migrate deploy`**（`pnpm --filter @ai-call/api exec prisma migrate deploy`）——**绝不** `migrate dev` / `migrate reset`。
- [ ] 迁移后核对回填（可复用 CALL-11 的校验 DO 块，见 `scripts/call-11-migration-dryrun.ps1`）：
  - [ ] 15 张业务表 `tenant_id` NOT NULL + 默认 `tenant_demo` + 索引 + **无 NULL 残留**。
  - [ ] `outbound_tasks.owner_id` / `campaigns.owner_id`（可空 uuid）+ `campaigns_owner_id_idx`。
  - [ ] `resource_grants` 表 + 复合索引存在。
  - [ ] `_prisma_migrations` 无未完成 / 已回滚行。
- [ ] **真实旧数据回填语义确认**：迁移前存量任务 `owner_id=NULL` → 按「对租户内 `task:read` 持有者公开」处理（保持迁移前可见性，只有新建任务收紧到创建者）。若此语义不符合上线预期，先在迁移窗口内补 `owner_id`。
- [ ] seed 幂等（如需重放）：`prisma:seed` 可安全重跑（permissions/roles/scenarios 行数不变）。

---

## 3. 上线后验证

### 3.1 启动自检
- [ ] ai-call 启动无 `KNOWLEDGE_SERVICE_BASE_URL is set but ... token is empty` 类拒绝；日志确认已进外部知识库模式。

### 3.2 跨租户隔离实测（§6.1 最高优先级安全点）—— 用 CALL-10 脚本打生产
- [ ] 按 `docs/testing/call-10-cross-tenant-retrieval.md` 播种两租户各一篇 COMPANY 文档（含共享词 + 各自标记），设置脚本 env 指向**生产** ai-call/ai-knowledge。
- [ ] `node scripts/call-10-cross-tenant-retrieval.mjs`：**全部【必过】断言通过**——租户 A 检索不含 B 标记、id 集合不相交、缺 `X-Tenant-Id`/`X-User-Id`/`X-Service-Token` → 401。
  - 生产两侧配了同值 service token 后，dev 里 skip 的 `2.1`/`2.2`（缺/错 token → 401）应转为**通过**。
- [ ] 验证完**清理生产测试 fixtures**（脚本文档附一事务删除 SQL：chunks→documents→users→tenants）。

---

## 4. CALL-12 激活「按库过滤」（配置对齐，零代码）

> ai-knowledge 已实现 `knowledgeBaseId → folder` 过滤（优雅兜底：id 不对应真实 folder 则退回租户级、不返回空）。默认因 kb id 与 folder id 未对齐，表现为租户级全库。

- [ ] 把 ai-call scenario 的 `knowledgeBaseId`（voice-agent `scenario.knowledge_base_id` / ai-call `OutboundScenario` 配置）**填成 ai-knowledge 中目标 folder 的真实 id**。
- [ ] 用 CALL-10 脚本场景 4 验证：`KB_ID` / `KB_ID_OTHER` 设为两个真实且文档不同的 folder id，断言 `4.1` 由 WARN 转为通过（按库过滤生效）。
- [ ] 已知限制知悉：精确 folder 匹配、不含子文件夹（v1 可接受，需子树语义再改 `folder_id IN (子树)`）。

---

## 5. 回滚预案

- [ ] 备份/快照可用（见 §0）。迁移含 NOT NULL 收紧，回滚优先走**恢复快照**而非反向迁移。
- [ ] 若仅想临时降级 RAG：清空 ai-call `KNOWLEDGE_SERVICE_BASE_URL` → 回落 mock 知识库，权限/租户逻辑不受影响。
- [ ] 令牌泄露应急：轮换 §1.1 三令牌（同步改两侧，保持两跳相等）。

---

## 附：状态速览（2026-07-10）

| 工单 | 内容 | 状态 |
|---|---|---|
| CALL-01~04, 07 | authz 包替换 / tenant_id / CLS 过滤 / 权限码 / CSRF | ✅ 代码完成 |
| CALL-05, 09 | ResourceGrant ACL（task / campaign） | ✅ 代码完成 |
| CALL-06 | 检索带租户身份（跨仓链路） | ✅ 代码完成 + 实测通过 |
| CALL-08 | 部门(DEPT)级 ACL | ⏸️ ai-call 侧暂缓（能力落 ai-knowledge） |
| CALL-10 | 跨仓真隔离实测 | ✅ 真环境 14/14（并修 retrieve 401 bug） |
| CALL-11 | 迁移真库演练 | ✅ 一次性可弃库演练通过 |
| CALL-12 | 激活按库过滤 | 🟢 方案定：配置对齐（本清单 §4 执行） |
