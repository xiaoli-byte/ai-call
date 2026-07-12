/**
 * 公共工具函数
 */

/**
 * 模板变量填充
 *
 * 将 ${varName} 占位符替换为 variables 中对应的值。
 * 兼容历史 {varName} / {{varName}} 占位符。
 * 未找到的变量保留原占位符（便于发现配置缺失）。
 *
 * @example
 * fillTemplate('您好${name}，订单${orderNo}', { name: '张三', orderNo: 'A001' })
 * // => '您好张三，订单A001'
 */
export function fillTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(TEMPLATE_VARIABLE_PATTERN, (
    token: string,
    dollarKey: string | undefined,
    doubleBraceKey: string | undefined,
    braceKey: string | undefined,
  ) => {
    const key = dollarKey ?? doubleBraceKey ?? braceKey;
    return key ? variables[key] ?? token : token;
  });
}

/**
 * 提取模板中所有变量占位符的变量名（去重）
 *
 * @example
 * extractTemplateVars('您好${name}，订单{{orderNo}}，{name}')
 * // => ['name', 'orderNo']
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(TEMPLATE_VARIABLE_PATTERN);
  const set = new Set<string>();
  for (const match of matches) {
    const key = match[1] ?? match[2] ?? match[3];
    if (key) set.add(key);
  }
  return [...set];
}

const TEMPLATE_VARIABLE_PATTERN = /\$\{(\w+)\}|\{\{(\w+)\}\}|\{(\w+)\}/g;

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
    data?: unknown;
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
    const data = node?.data as
      | { text?: unknown; prompt?: unknown; systemPrompt?: unknown; farewell?: unknown }
      | null
      | undefined;
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
