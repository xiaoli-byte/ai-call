/**
 * 意图例句编辑的纯函数 helper —— 从 decision-form.tsx 抽出，便于单测。
 *
 * 三个同步点：
 * - 意图文本被编辑（rename）→ 例句键（以及草稿键）跟着迁移；
 * - 意图被删除 → 对应键删除；
 * - 例句文本框内容 → 每行一句，空行/首尾空白过滤后才写入 intentExamples。
 */

/**
 * 意图 rename 时迁移一个以意图名为键的 map（intentExamples 或草稿 map 都适用）。
 * newKey 为空/纯空白视为该意图被清空，直接丢弃旧键对应的值。
 */
export function migrateMapKeyOnRename<T>(
  map: Record<string, T>,
  oldKey: string,
  newKey: string,
): Record<string, T> {
  if (oldKey === newKey || !(oldKey in map)) return map;
  const { [oldKey]: moved, ...rest } = map;
  if (!newKey.trim()) return rest;
  return { ...rest, [newKey]: moved };
}

/** 意图被删除时，从 map 中移除对应键（intentExamples 或草稿 map 都适用）。 */
export function removeMapKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const { [key]: _removed, ...rest } = map;
  return rest;
}

/** 例句文本框内容 → 例句数组：按行切分，过滤空行/首尾空白。 */
export function parseExampleLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
