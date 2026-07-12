# Task Import Template Dynamic Variables Design

## Goal

让 `/tasks/new` 页面的「下载模板」按钮根据当前选中的话术流程动态生成 CSV 模板的变量列。固定列 `phone`、`name`、`company` 始终保留;其余列从选中流程的节点文本中提取业务变量(`${var}` / `{{var}}` / `{var}` 形式),按节点顺序去重追加,排除与系统列重复的变量键。

## Background

- 当前 `handleDownloadTemplate` 在 `apps/dashboard/app/tasks/new/page.tsx` 中调用 `buildTemplate()`,默认只生成 `phone,name,company` 三列,无法反映流程实际使用的变量。
- `@ai-call/shared` 的 `extractTemplateVars(template)` 已能从字符串提取变量名(支持三种占位符语法)。
- 流程节点中可能含变量的字段(参考 `services/voice-agent/src/voice_agent/flow_executor.py` 中 `render_template` 的调用位置):
  - `DialogNodeData.text`(script 模式固定话术)
  - `DialogNodeData.prompt`(question/ai 模式提示语)
  - `DialogNodeData.systemPrompt`(ai 模式系统提示词)
  - `EndNodeData.farewell`(告别话术)
- `apps/dashboard/lib/outbound/import-parser.ts` 的 `parseImportText` 在解析时会把 `name` 列的值映射为 `variables.customerName`,因此 `customerName` 等同于系统变量,不应作为动态列出现。
- `buildTemplate(variableKeys)` 已经支持传入变量键数组,签名与实现无需改动。

## Design

### shared 层新增

在 `packages/shared/src/utils.ts` 现有 `extractTemplateVars` 旁新增两个导出:

```typescript
/** 流程变量提取时需要排除的系统变量键(与 import-parser 系统列对应) */
export const FLOW_SYSTEM_VARIABLE_KEYS = [
  'phone', 'to', 'mobile', 'number',
  'name', 'customer', 'customerName',
  'scheduledAt', 'scheduled_at', 'calltime',
  'priority',
] as const;

/** extractFlowVariables 接受的结构类型,避免与 TaskFlow 强耦合 */
interface FlowLike {
  nodes?: Array<{
    data?: {
      text?: string;
      prompt?: string;
      systemPrompt?: string;
      farewell?: string;
    };
  }>;
}

/**
 * 从话术流程节点中提取业务变量键,按节点顺序去重,排除系统变量与 company。
 * 覆盖字段:DialogNodeData.text/prompt/systemPrompt、EndNodeData.farewell。
 */
export function extractFlowVariables(flow: FlowLike | null | undefined): string[] {
  if (!flow?.nodes) return [];
  const excluded = new Set<string>([...FLOW_SYSTEM_VARIABLE_KEYS, 'company']);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const node of flow.nodes) {
    const data = node?.data;
    if (!data) continue;
    const fields = [data.text, data.prompt, data.systemPrompt, data.farewell];
    for (const field of fields) {
      if (typeof field !== 'string' || !field) continue;
      for (const key of extractTemplateVars(field)) {
        if (excluded.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(key);
      }
    }
  }
  return result;
}
```

**为什么用结构类型 `FlowLike` 而非 `TaskFlow`**:`utils.ts` 目前无任何 import,保持其独立;`TaskFlow` 的 `nodes` 结构兼容 `FlowLike`,调用方传 `TaskFlow` 自动适配,且后端 / Voice Agent 后续若复用此函数不必强引前端类型。

### 前端改造

`apps/dashboard/app/tasks/new/page.tsx` 的 `handleDownloadTemplate`:

```typescript
function handleDownloadTemplate() {
  const flow = flows.find((f) => f.id === flowId);
  const dynamicKeys = extractFlowVariables(flow); // 已排除系统变量和 company
  const variableKeys = ['company', ...dynamicKeys]; // company 始终保留且在最前
  const blob = new Blob([buildTemplate(variableKeys)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'outbound-tasks-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
```

新增 import:`import { extractFlowVariables } from '@ai-call/shared';`。

`buildTemplate` 签名与实现不变(已支持 `variableKeys` 数组,且对未知变量返回空字符串,符合"动态列示例值留空"的需求)。

### 数据流

```
点击「下载模板」
  → 根据 flowId 从 flows 查找当前流程
  → flow 存在:extractFlowVariables(flow) → 动态变量键(已排除系统变量与 company)
  → flow 不存在:动态变量键 = []
  → variableKeys = ['company', ...动态键]
  → buildTemplate(variableKeys) → CSV 字符串(phone,name,company,...动态键)
  → Blob → 下载 outbound-tasks-template.csv
```

### 边界处理

| 场景 | 行为 |
|---|---|
| flowId 为空(选了"使用场景默认对话") | 动态键为空,模板只有 phone/name/company |
| 流程无任何变量 | 同上,只有 phone/name/company |
| 流程含 `${customerName}` / `${phone}` 等系统变量 | 被 `FLOW_SYSTEM_VARIABLE_KEYS` 排除,不出现在动态列 |
| 流程含 `${company}` | 被 `extractFlowVariables` 排除,不会与固定 company 列重复 |
| 同一变量在多个节点出现 | 去重,只首次出现位置计入 |
| 节点 data 缺失或字段非字符串 | 跳过该字段,不报错 |
| flows 数据未加载 | flows 为空,退化固定三列 |
| 动态列示例值 | 留空(`buildTemplate` 默认行为) |
| 文件名 | 保持 `outbound-tasks-template.csv` 不变 |

## Testing

### 新增 `apps/dashboard/__tests__/extract-flow-variables.test.ts`

- dialog 节点 text/prompt/systemPrompt 三个字段都能提取变量
- end 节点 farewell 字段能提取变量
- `FLOW_SYSTEM_VARIABLE_KEYS` 中所有键被排除
- `company` 被排除
- 重复变量去重(跨节点、跨字段)
- 节点顺序保持(按 nodes 数组顺序,同节点内按 text→prompt→systemPrompt→farewell 顺序)
- 空流程 / null / undefined 返回空数组
- 字段非字符串 / data 缺失不报错

### 扩展 `apps/dashboard/__tests__/new-task-page.test.tsx`

- 选中含变量的流程时,点击下载模板生成的 CSV 包含动态列
- 未选流程时,CSV 只有 phone/name/company 三列

下载行为通过 mock `URL.createObjectURL` / `HTMLAnchorElement.prototype.click` 验证,并捕获 `Blob` 内容断言 CSV 表头。

## Files Changed

| 文件 | 改动 |
|---|---|
| `packages/shared/src/utils.ts` | 新增 `FLOW_SYSTEM_VARIABLE_KEYS`、`FlowLike`、`extractFlowVariables` |
| `apps/dashboard/app/tasks/new/page.tsx` | `handleDownloadTemplate` 改造 + 新增 `extractFlowVariables` import |
| `apps/dashboard/__tests__/extract-flow-variables.test.ts` | 新增单测 |
| `apps/dashboard/__tests__/new-task-page.test.tsx` | 扩展下载模板测试 |

`buildTemplate`、`import-parser.ts`、后端、CSS 均无改动。

## Out of Scope

- 后端 NestJS 不新增端点(数据已在 `flows` 中,前端直接提取)。
- `buildTemplate` 函数签名与默认行为不变(已在 `import-parser.ts` 中支持 `variableKeys` 数组)。
- 不增加全局变量(globalVariables)作为候选来源——本期只从流程节点文本提取,符合"根据话术流程动态生成"的字面需求。如后续需要合并全局变量,可在 `extractFlowVariables` 调用方拼接。
- 文件名不变。
- 不修改 `parseImportText` 解析逻辑(导入侧已支持任意变量列)。
