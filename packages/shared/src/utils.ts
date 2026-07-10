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
