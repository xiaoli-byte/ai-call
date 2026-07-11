# 意图识别 embedding 相似度层（Phase 2）

日期：2026-07-11 · 状态：待实施 · 前置：P0 意图级联已完成（commit 8bcd073 + 21c9560，真机验证过）

## 目标

在 keyword 与 LLM 之间插入 embedding 相似度层：编辑器按意图配置例句 → 发布快照携带 →
运行时对用户话术做向量相似度匹配，命中即路由（~20ms），未命中落到 LLM（~800ms）。
意图是租户自定义的动态标签，例句由运营配置，引擎保持零样本无需训练。

级联最终形态：`keyword（精确/最长优先）→ embedding（例句相似度）→ LLM（带"其他"逃生口）→ fallback`

## 硬约束

- **默认关闭**（`INTENT_EMBED_PROVIDER=off`）：不配置时行为与现状逐行为等价，CI/mock 环境不需要任何模型。
- **fail-open**：embedding 层任何错误/超时（HTTP 失败、模型未加载、维度不符）→ warning 日志 + 落到 LLM 层，绝不影响通话。
- **模型宿主在 funasr-server**：它已有 torch+CUDA+modelscope；voice-agent 不新增 torch 依赖。
- 流程快照不可变契约不变：例句随 node.data 进快照，任务锁版本执行。

## 1. 数据模型（fast-worker）

### packages/shared/src/task-flows.ts

```ts
export interface DecisionNodeData {
  mode: DecisionMode;
  expression?: string;
  intents?: string[];
  /** intent 模式：每个意图的例句（键=意图名，值=例句数组），供 embedding 相似度层使用 */
  intentExamples?: Record<string, string[]>;
}
```

发布校验**不新增**硬性规则（例句可选）。运行时忽略键不在 intents 里的例句。
如 contracts/*.schema.json 有 decision node data 的 schema，同步补可选字段。

### apps/dashboard decision-form.tsx

每个意图输入框下方加可折叠的「例句」编辑（TextArea，每行一句），写入
`intentExamples[意图名]`。注意三个同步点：
- 意图文本被编辑（rename）→ 例句键跟着迁移；
- 意图被删除 → 对应例句键删除；
- 空行/首尾空白过滤后再 emit。

测试（vitest，现有 flow-validation.test.ts 风格）：intentExamples 在 validateFlowDefinition
下不产生 issue；编辑器逻辑如可测（纯函数抽出 rename/delete 迁移 helper）补 2-3 例。

## 2. funasr-server `/embed` 端点（fast-worker）

- `POST /embed` body `{"texts": ["...", ...]}` → `{"embeddings": [[float,...]], "dim": N, "model": "..."}`；
  空数组回 `{"embeddings": [], ...}`；单批上限 64 条，超限 400。
- 模型：`FUNASR_EMBED_MODEL`（默认 `iic/nlp_gte_sentence-embedding_chinese-small`，
  modelscope pipeline `sentence-embedding`；实现时如该 id 不可用，选 modelscope 上可用的
  中文小型 embedding 模型并在 .env 注释注明）。输出 **L2 归一化**后返回（客户端 cosine=dot）。
- **懒加载**：首个请求时在 executor 线程加载（跟 models.py 现有 AutoModel 模式一致），
  加载失败缓存错误并对后续请求快速 503（不反复重载）。
- health 端点的 models 字典加 `embed` 字段（未加载=false，不影响整体 status=ok）。
- mock 模型模式（现有 pytest/CI 用的 mock 开关）下返回确定性伪向量
  （如 hash(text) 播种的固定维度向量，归一化），保证测试无模型可跑。
- 测试（pytest，httpx TestClient）：正常批量、空数组、超限 400、mock 向量确定性。

## 3. voice-agent 运行时（deep-reasoner）

### flow_types.py

`DecisionNodeData` 加 `intent_examples: dict[str, list[str]] = field(default_factory=dict)`，
解析 `raw.get("intentExamples")`，防御非 dict/非 list/非 str（脏数据静默丢弃）。

### 新模块 intent_embed.py（provider 抽象）

```python
class IntentEmbedProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

# provider 选择（环境变量，安全解析，坏值按 off 处理 + warning）：
# INTENT_EMBED_PROVIDER = off | mock | funasr   （默认 off）
# INTENT_EMBED_URL      = http://localhost:10095/embed
# INTENT_EMBED_THRESHOLD = 0.72   INTENT_EMBED_MARGIN = 0.05
# INTENT_EMBED_TIMEOUT_MS = 500
```

- `funasr` provider：httpx POST，超时 INTENT_EMBED_TIMEOUT_MS，任何异常上抛给调用方
  统一 fail-open。
- `mock` provider：确定性伪向量（与 funasr-server mock 同思路），仅供 CLI 开发；
  单元测试直接注入 fake provider，不依赖 mock 的语义质量。
- **例句向量缓存**：模块级 dict，键 = tuple(例句文本)，值 = 向量；上限 256 条 FIFO 淘汰。
  流程快照不可变 → 同一版本例句永不变，缓存天然安全。

### flow_executor.py 级联插入

`_exec_decision` 中 keyword 未命中且 `data.intent_examples` 非空且 provider 非 off 时：

```python
intent = await self._classify_intent_embedding(call_id, node, data, last_response)
if intent:
    self._log_intent(call_id, node.id, "embed", last_response, intent)
    return intent
# 未命中/失败 → 现有 LLM 层，逻辑零改动
```

判定：用户话术向量 vs 每个意图的例句向量取 max 为该意图得分；
`top >= THRESHOLD and (top - second) >= MARGIN` 才命中（单意图时 second=0）。
只做正向命中，**不**由 embedding 判"其他"（远离所有意图仍落 LLM 裁决）。
未命中时打探针日志（对齐 RMS 调参模式）：
`[Intent/Embed] call_id=... node=... top=%.3f(意图) second=%.3f(意图) below_threshold`

`[Intent]` 命中日志带分数：`tier=embed ... -> intent=同意 (top=0.81 margin=0.12)`。

### 测试（pytest，现有 fake 风格）

注入 fake provider（返回手工构造向量）：
1. 命中：top/second 分数满足阈值 → 返回意图，不调 LLM（fake callbacks 断言 generate_llm_text 未被调）；
2. margin 不足 → 落 LLM；
3. threshold 不足 → 落 LLM；
4. provider 抛异常 → fail-open 落 LLM，通话不断；
5. intent_examples 为空/provider=off → 完全跳过（generate_llm_text 被调，行为同现状）;
6. 例句缓存：同一例句集第二次调用不再 embed 例句（fake provider 记录调用参数断言）。

## 验收

- `pnpm check` 全绿（shared build + typecheck + TS/Python 全部测试）。
- 默认配置（provider=off）下现有 119 pytest 逐一不变。
- 真机（后续单独做）：funasr-server 起 embed 模型，`.env` 配 provider=funasr + 电商回访模板
  decision_3 配例句，「拿到了/还没到」等间接表达走 tier=embed 命中，日志出分数。

## 明确不做（本次）

- A+（意图分类合并进主回复 LLM 调用）：decision 分类发生在路由前、下一节点 prompt
  依赖分类结果，流程模式下无合并空间——重新界定为仅适用于 scenario 兼容模式，暂缓。
- 编辑器例句的批量导入/从转写一键采集（好点子，进 backlog）。
- embedding 判「其他」（负向判定风险高，LLM 层已有逃生口）。
