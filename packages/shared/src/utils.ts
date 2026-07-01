/**
 * 公共工具函数
 */

/**
 * 模板变量填充
 *
 * 将 {varName} 占位符替换为 variables 中对应的值。
 * 未找到的变量保留原占位符（便于发现配置缺失）。
 *
 * @example
 * fillTemplate('您好{name}，订单{orderNo}', { name: '张三', orderNo: 'A001' })
 * // => '您好张三，订单A001'
 */
export function fillTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    variables[key] ?? `{${key}}`,
  );
}

/**
 * 提取模板中所有 {varName} 占位符的变量名（去重）
 *
 * @example
 * extractTemplateVars('您好{name}，订单{orderNo}，{name}')
 * // => ['name', 'orderNo']
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{(\w+)\}/g);
  const set = new Set<string>();
  for (const match of matches) {
    set.add(match[1]);
  }
  return [...set];
}
