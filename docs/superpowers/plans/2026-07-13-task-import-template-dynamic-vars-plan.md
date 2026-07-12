# Task Import Template Dynamic Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/tasks/new` 页面的「下载模板」按钮根据当前选中的话术流程动态生成 CSV 模板的变量列,固定列 `phone`、`name`、`company` 始终保留,其余列从流程节点文本中按节点顺序去重提取。

**Architecture:** 在 `@ai-call/shared` 的 `utils.ts` 新增 `extractFlowVariables(flow)` 工具函数(复用已有 `extractTemplateVars`),前端 `/tasks/new` 页面在下载模板时根据当前 `flowId` 取出流程,调用该函数得到动态变量键,拼接 `['company', ...动态键]` 后传给现有 `buildTemplate(variableKeys)`。`buildTemplate` / `import-parser.ts` / 后端 / CSS 均无改动。

**Tech Stack:** TypeScript, pnpm workspace, turbo, vitest, Next.js 14 (App Router), `@ai-call/shared` 包(预构建,dist 通过 `pnpm --filter @ai-call/shared build` 生成)。

**Spec:** [docs/superpowers/specs/2026-07-13-task-import-template-dynamic-vars-design.md](../specs/2026-07-13-task-import-template-dynamic-vars-design.md)

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `packages/shared/src/utils.ts` | 模板变量工具(`fillTemplate`、`extractTemplateVars`) | 新增 `FLOW_SYSTEM_VARIABLE_KEYS` 常量、`FlowLike` 接口、`extractFlowVariables` 函数 |
| `apps/dashboard/__tests__/extract-flow-variables.test.ts` | `extractFlowVariables` 单元测试 | 新建 |
| `apps/dashboard/app/tasks/new/page.tsx` | 新建外呼任务页 | `handleDownloadTemplate` 改造 + 新增 import |
| `apps/dashboard/__tests__/new-task-page.test.tsx` | NewTaskPage 集成测试 | 扩展下载模板测试 |

**关键约束:**
- `@ai-call/shared` 是预构建包(`main: "./dist/index.js"`),改了 `src/utils.ts` 后必须运行 `pnpm --filter @ai-call/shared build`,否则 dashboard 拿不到新导出。
- shared 包无 vitest(`package.json` 的 `test` 脚本只是 `tsc --noEmit`),所以 `extractFlowVariables` 的单元测试放在 dashboard 的 `__tests__/` 下。
- dashboard 测试命令:`pnpm --filter @ai-call/dashboard test:unit`(等价 `vitest run`)。
- dashboard 类型检查命令:`pnpm --filter @ai-call/dashboard test:typecheck`(等价 `tsc --noEmit`)。

---

## Task 1: shared 层新增 `extractFlowVariables`

**Files:**
- Modify: `packages/shared/src/utils.ts`
- Test: `apps/dashboard/__tests__/extract-flow-variables.test.ts` (新建)

- [ ] **Step 1: 在 dashboard 新建失败测试**

创建 `apps/dashboard/__tests__/extract-flow-variables.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  FLOW_SYSTEM_VARIABLE_KEYS,
  extractFlowVariables,
} from '@ai-call/shared';

describe('extractFlowVariables', () => {
  it('returns empty array for null / undefined / empty flow', () => {
    expect(extractFlowVariables(null)).toEqual([]);
    expect(extractFlowVariables(undefined)).toEqual([]);
    expect(extractFlowVariables({ nodes: [] })).toEqual([]);
    expect(extractFlowVariables({})).toEqual([]);
  });

  it('extracts vars from dialog node text, prompt, systemPrompt', () => {
    const flow = {
      nodes: [
        {
          data: {
            text: '您好${name},我是${company}的${agentName}',
            prompt: '请确认${orderNo}',
            systemPrompt: '当前业务:${business}',
          },
        },
      ],
    };
    // name / company 是系统/固定列,被排除
    expect(extractFlowVariables(flow)).toEqual(['agentName', 'orderNo', 'business']);
  });

  it('extracts vars from end node farewell', () => {
    const flow = {
      nodes: [
        { data: { farewell: '感谢${customerName}参与${activity}' } },
      ],
    };
    // customerName 是系统变量,被排除
    expect(extractFlowVariables(flow)).toEqual(['activity']);
  });

  it('excludes all FLOW_SYSTEM_VARIABLE_KEYS entries', () => {
    const flow = {
      nodes: [
        {
          data: {
            text: '${phone}${to}${mobile}${number}${name}${customer}${customerName}${scheduledAt}${scheduled_at}${calltime}${priority}',
          },
        },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual([]);
    // 同时验证常量本身内容
    expect([...FLOW_SYSTEM_VARIABLE_KEYS]).toEqual([
      'phone', 'to', 'mobile', 'number',
      'name', 'customer', 'customerName',
      'scheduledAt', 'scheduled_at', 'calltime',
      'priority',
    ]);
  });

  it('excludes company variable (fixed column)', () => {
    const flow = {
      nodes: [{ data: { text: '${company}的${product}' } }],
    };
    expect(extractFlowVariables(flow)).toEqual(['product']);
  });

  it('deduplicates vars across nodes and fields', () => {
    const flow = {
      nodes: [
        { data: { text: '${product}', prompt: '${product}' } },
        { data: { text: '${product}与${orderNo}' } },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual(['product', 'orderNo']);
  });

  it('preserves node order, then field order (text→prompt→systemPrompt→farewell)', () => {
    const flow = {
      nodes: [
        { data: { text: '${b}${a}' } },
        { data: { prompt: '${c}', farewell: '${d}' } },
        { data: { systemPrompt: '${e}' } },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('supports all three placeholder syntaxes', () => {
    const flow = {
      nodes: [
        { data: { text: '${dollarVar} {{doubleVar}} {singleVar}' } },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual(['dollarVar', 'doubleVar', 'singleVar']);
  });

  it('skips non-string fields and missing data without throwing', () => {
    const flow = {
      nodes: [
        { data: { text: 123 as any, prompt: undefined, systemPrompt: null as any } },
        { data: undefined as any },
        { data: { text: '${valid}' } },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual(['valid']);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败(因为 `extractFlowVariables` 未导出)**

Run:
```
pnpm --filter @ai-call/dashboard test:unit -- extract-flow-variables
```

Expected: FAIL,报错类似 `extractFlowVariables is not a function` 或 import 失败。

- [ ] **Step 3: 在 shared/utils.ts 实现函数**

打开 `packages/shared/src/utils.ts`,在文件末尾(现有 `extractTemplateVars` 之后)追加:

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

- [ ] **Step 4: 构建 shared 包(让 dashboard 能 import 到新导出)**

Run:
```
pnpm --filter @ai-call/shared build
```

Expected: 命令成功退出,`packages/shared/dist/utils.js` 与 `packages/shared/dist/utils.d.ts` 包含 `extractFlowVariables` 导出。

- [ ] **Step 5: 运行测试,确认通过**

Run:
```
pnpm --filter @ai-call/dashboard test:unit -- extract-flow-variables
```

Expected: PASS,所有 9 个测试用例通过。

- [ ] **Step 6: shared 包类型检查**

Run:
```
pnpm --filter @ai-call/shared lint
```

Expected: 无错误(`tsc --noEmit` 退出码 0)。

- [ ] **Step 7: 提交**

```
git add packages/shared/src/utils.ts apps/dashboard/__tests__/extract-flow-variables.test.ts
git commit -m "feat(shared): add extractFlowVariables to derive flow variables for import template"
```

---

## Task 2: 前端 `handleDownloadTemplate` 改造

**Files:**
- Modify: `apps/dashboard/app/tasks/new/page.tsx`

- [ ] **Step 1: 在 page.tsx 顶部新增 import**

打开 `apps/dashboard/app/tasks/new/page.tsx`,找到第 7 行的 import:

```typescript
import { FlowStatus, ScenarioStatus, TaskPriority, type TaskFlow } from '@ai-call/shared';
```

在它下面追加一行:

```typescript
import { extractFlowVariables } from '@ai-call/shared';
```

(保持与现有 `@ai-call/shared` import 分开,符合该文件已有的"按用途分行"风格。)

- [ ] **Step 2: 改造 `handleDownloadTemplate` 函数**

找到 `page.tsx` 第 68-76 行的 `handleDownloadTemplate` 函数:

```typescript
function handleDownloadTemplate() {
  const blob = new Blob([buildTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'outbound-tasks-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
```

替换为:

```typescript
function handleDownloadTemplate() {
  const flow = flows.find((item) => item.id === flowId);
  const dynamicKeys = extractFlowVariables(flow);
  const variableKeys = ['company', ...dynamicKeys];
  const blob = new Blob([buildTemplate(variableKeys)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'outbound-tasks-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: 类型检查**

Run:
```
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: 无错误。`flows` 与 `flowId` 已在组件作用域内(`page.tsx` 第 26、33-35 行),无需新增 state 或 props。

- [ ] **Step 4: 运行已有测试,确保未破坏**

Run:
```
pnpm --filter @ai-call/dashboard test:unit -- new-task-page
```

Expected: 现有 1 个测试用例 PASS(下载模板按钮未被该测试触发,改造不影响)。

- [ ] **Step 5: 提交**

```
git add apps/dashboard/app/tasks/new/page.tsx
git commit -m "feat(dashboard): generate import template columns from selected flow variables"
```

---

## Task 3: 扩展 `new-task-page.test.tsx` 下载模板测试

**Files:**
- Modify: `apps/dashboard/__tests__/new-task-page.test.tsx`

- [ ] **Step 1: 让 `useTaskFlows` mock 可动态控制 flows 数据**

打开 `apps/dashboard/__tests__/new-task-page.test.tsx`,找到第 6-11 行的 `vi.hoisted`:

```typescript
const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
}));
```

替换为(新增 `flows` 数组):

```typescript
const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  flows: [] as Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    version: number;
    nodes: Array<{ data: Record<string, unknown> }>;
    edges: unknown[];
    createdAt: string;
    updatedAt: string;
  }>,
}));
```

找到第 34-36 行的 `useTaskFlows` mock:

```typescript
vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: () => ({ data: [] }),
}));
```

替换为:

```typescript
vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: () => ({ data: mocks.flows }),
}));
```

找到 `beforeEach`(第 49-52 行):

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBatch.mockResolvedValue({ createdCount: 1, tasks: [] });
});
```

替换为(新增 `mocks.flows = []` 重置):

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBatch.mockResolvedValue({ createdCount: 1, tasks: [] });
  mocks.flows = [];
});
```

- [ ] **Step 2: 在文件末尾(`describe` 块结束前)新增下载模板测试用例**

找到现有测试用例结束的位置(第 77 行 `});` 之后、`describe` 块结束的 `});` 之前),追加两个测试用例:

```typescript
  it('download template falls back to phone,name,company when no flow is selected', async () => {
    const blobText = await captureDownloadTemplateCsv();
    const lines = blobText.split('\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('\ufeffphone,name,company');
  });

  it('download template includes dynamic columns from selected flow variables', async () => {
    mocks.flows = [{
      id: 'flow-1',
      name: '试驾邀约',
      description: '',
      status: 'published',
      version: 1,
      nodes: [
        { data: { text: '您好${name},我是${company}的${agentName}' } },
        { data: { text: '请确认${orderNo}', prompt: '${product}' } },
        { data: { farewell: '感谢${customerName}参与${activity}' } },
      ],
      edges: [],
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    }];

    render(<NewTaskPage />);

    // 用户手动选择该流程(默认 flowId 为空,因为场景无 defaultFlowId)
    const flowSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(flowSelect, { target: { value: 'flow-1' } });

    const csv = await captureDownloadTemplateCsv();
    const lines = csv.split('\n').filter((line) => line.length > 0);
    // 期望表头:phone,name,company,agentName,orderNo,product,activity
    // (name/customerName/company 被排除;按节点顺序:agentName→orderNo→product→activity)
    expect(lines[0]).toBe('\ufeffphone,name,company,agentName,orderNo,product,activity');
    // 第二行示例:phone=1001, name=张三, company=示例公司, 动态列留空
    expect(lines[1]).toBe('1001,张三,示例公司,,,,' );
  });
```

并在文件顶部(其它 `import` 之后,`import NewTaskPage` 之前)新增辅助函数:

```typescript
async function captureDownloadTemplateCsv(): Promise<string> {
  const blobCtor = vi.spyOn(globalThis, 'Blob').mockImplementation((parts: BlobPart[]) => {
    return { text: () => Promise.resolve(parts.map((p) => String(p)).join('')) } as unknown as Blob;
  });
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const clickSpy = vi.fn();
  const anchorSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);

  const button = screen.getByRole('button', { name: /下载模板/ });
  fireEvent.click(button);

  // 等待 click 触发(Blob 构造是同步的,但用 waitFor 保险)
  await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

  const parts = (blobCtor.mock.calls[0]?.[0] ?? []) as BlobPart[];
  const csv = parts.map((p) => String(p)).join('');

  blobCtor.mockRestore();
  createUrl.mockRestore();
  revokeUrl.mockRestore();
  anchorSpy.mockRestore();
  return csv;
}
```

- [ ] **Step 3: 运行测试,确认通过**

Run:
```
pnpm --filter @ai-call/dashboard test:unit -- new-task-page
```

Expected: PASS,3 个测试用例全通过(原有 1 个 + 新增 2 个)。

如果第一个新增测试失败(未选流程时表头不是 `phone,name,company`),检查:`flows.find((item) => item.id === flowId)` 在 `flowId === ''` 时返回 `undefined`,`extractFlowVariables(undefined)` 返回 `[]`,`variableKeys = ['company']`,`buildTemplate(['company'])` 生成 `\ufeffphone,name,company\n1001,张三,示例公司\n`。表头应为 `\ufeffphone,name,company`。

如果第二个新增测试失败,检查表头顺序:节点 1 的 `text` 提供 `agentName`(name/company 被排除);节点 2 的 `text` 提供 `orderNo`,然后 `prompt` 提供 `product`;节点 3 的 `farewell` 提供 `activity`(customerName 被排除)。所以期望顺序是 `agentName,orderNo,product,activity`。

- [ ] **Step 4: 类型检查**

Run:
```
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```
git add apps/dashboard/__tests__/new-task-page.test.tsx
git commit -m "test(dashboard): cover dynamic template columns in new-task-page"
```

---

## Task 4: 全量验证与收尾

- [ ] **Step 1: 全量类型检查**

Run:
```
pnpm --filter @ai-call/shared lint
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: 两条命令均无错误退出。

- [ ] **Step 2: 全量单元测试**

Run:
```
pnpm --filter @ai-call/dashboard test:unit
```

Expected: 所有 dashboard 测试通过(包含本次新增的 `extract-flow-variables.test.ts` 9 个用例和 `new-task-page.test.tsx` 3 个用例,以及其它既有测试)。

- [ ] **Step 3: 手动验证(可选,需要本地起 dev server)**

1. 启动 dashboard dev: `pnpm dev:dashboard`
2. 访问 `http://localhost:3000/tasks/new`
3. 在「执行流程」下拉中选择一个包含 `${var}` 变量的已发布流程
4. 点击「下载模板」,用文本编辑器打开下载的 CSV
5. 确认表头为 `phone,name,company,<流程中出现的业务变量...>`
6. 切换「执行流程」为「使用场景默认对话」,再次下载,确认表头退化为 `phone,name,company`

- [ ] **Step 4: 最终提交(若有未提交的改动)**

如果前面任务都已按步提交,本步可跳过。否则:

```
git status
git add -A
git commit -m "chore: finalize task import template dynamic variables feature"
```

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | 实现任务 |
|---|---|
| shared 层新增 `FLOW_SYSTEM_VARIABLE_KEYS`、`extractFlowVariables` | Task 1 Step 3 |
| 前端 `handleDownloadTemplate` 改造,传入 `['company', ...动态键]` | Task 2 Step 2 |
| 固定列 phone/name/company 始终保留 | Task 2 Step 2(`variableKeys` 始终以 'company' 开头;phone/name 由 `buildTemplate` 内部固定) |
| 系统变量键排除 | Task 1 Step 3(`FLOW_SYSTEM_VARIABLE_KEYS` + `excluded` Set) |
| company 排除(避免与固定列重复) | Task 1 Step 3(`excluded` Set 含 'company') |
| 节点顺序去重 | Task 1 Step 3(按 `flow.nodes` 顺序遍历 + `seen` Set 去重) |
| 动态列示例值留空 | Task 2 Step 2(`buildTemplate` 对未知变量默认返回 `''`,无需改动) |
| 未选流程时退化为三列 | Task 2 Step 2(`flow` 为 undefined → `dynamicKeys = []` → `variableKeys = ['company']`) |
| 文件名不变 | Task 2 Step 2(`anchor.download = 'outbound-tasks-template.csv'` 保留) |
| 单测覆盖 9 类场景 | Task 1 Step 1 |
| 集成测试覆盖未选/已选两种场景 | Task 3 Step 2 |

无遗漏。

### 2. Placeholder scan

- 无 TBD / TODO / "implement later"。
- 每个代码步骤都提供了完整可粘贴的代码,无 "similar to Task N"。
- 测试代码均包含具体断言,无 "write tests for the above"。

### 3. Type consistency

- `extractFlowVariables` 签名:`(flow: FlowLike | null | undefined) => string[]` — Task 1 定义,Task 2 调用(`extractFlowVariables(flow)`,`flow` 类型为 `TaskFlow | undefined`,结构兼容 `FlowLike | null | undefined`)。
- `FLOW_SYSTEM_VARIABLE_KEYS` 类型:`readonly string[]`(因 `as const`)— Task 1 定义,Task 1 测试用 `[...FLOW_SYSTEM_VARIABLE_KEYS]` 展开为 `string[]` 比较。
- `buildTemplate(variableKeys)` 签名:`(variableKeys = ['company']) => string` — Task 2 调用传入 `['company', ...dynamicKeys]`(类型 `string[]`),兼容。
- `FlowLike` 接口的 `data` 字段(`text/prompt/systemPrompt/farewell`)与 `DialogNodeData` / `EndNodeData` 的对应字段名一致(已对照 `packages/shared/src/task-flows.ts` 第 40-58 行 `DialogNodeData` 和第 139-145 行 `EndNodeData`)。
- 测试 mock 的 flow 对象字段(`id/name/description/status/version/nodes/edges/createdAt/updatedAt`)与 `TaskFlow` 接口(`packages/shared/src/task-flows.ts` 第 186-197 行)一致。

类型一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-task-import-template-dynamic-vars-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
