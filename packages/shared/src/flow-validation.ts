import type {
  FlowDefinition,
  FlowValidationIssue,
} from './task-flows.js';

const DEFAULT_BRANCH_LABELS = new Set(['default', 'else', '默认', '其他']);

/**
 * 发布前的结构校验。编辑器可以保存不完整草稿，但只有合法图才能发布。
 */
export function validateFlowDefinition(
  flow: FlowDefinition,
): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const nodeIds = new Set<string>();

  for (const node of flow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ code: 'duplicate_node', message: `节点 ID 重复: ${node.id}`, nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  const starts = flow.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) {
    issues.push({ code: 'start_count', message: `流程必须且只能有一个开始节点，当前为 ${starts.length} 个` });
  }
  if (!flow.nodes.some((node) => node.type === 'end')) {
    issues.push({ code: 'missing_end', message: '流程至少需要一个结束节点' });
  }

  const outgoing = new Map<string, typeof flow.edges>();
  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ code: 'dangling_edge', message: `边 ${edge.id} 指向不存在的节点`, edgeId: edge.id });
      continue;
    }
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  for (const node of flow.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (node.type !== 'end' && edges.length === 0) {
      issues.push({ code: 'dead_end', message: `非结束节点 ${node.id} 没有出口`, nodeId: node.id });
    }
    if (node.type !== 'decision' && edges.length > 1) {
      const fallbackEdges = edges.filter((edge) => {
        const label = edge.label?.trim();
        return !label || DEFAULT_BRANCH_LABELS.has(label.toLowerCase());
      });
      const intentEdges = edges.filter((edge) => !fallbackEdges.includes(edge));

      if (intentEdges.length === 0) {
        issues.push({
          code: 'missing_intent_branch',
          message: `节点 ${node.id} 有多个出口，请至少配置一个意图分支`,
          nodeId: node.id,
        });
      }
      if (fallbackEdges.length === 0) {
        issues.push({
          code: 'missing_intent_fallback',
          message: `节点 ${node.id} 缺少默认分支，请将一条出边的分支名称留空`,
          nodeId: node.id,
        });
      }
      if (fallbackEdges.length > 1) {
        issues.push({
          code: 'multiple_intent_fallbacks',
          message: `节点 ${node.id} 只能有一条默认分支`,
          nodeId: node.id,
        });
      }
    }

    for (const edge of edges) {
      if ((edge.intentExamples?.length ?? 0) > 0 && !edge.label?.trim()) {
        issues.push({
          code: 'intent_examples_without_name',
          message: `连线 ${edge.id} 配置了用户问法，但缺少分支名称`,
          nodeId: node.id,
          edgeId: edge.id,
        });
      }
    }
    if (node.type === 'decision') {
      if (edges.length < 2) {
        issues.push({ code: 'decision_branches', message: `判断节点 ${node.id} 至少需要两个分支`, nodeId: node.id });
      }
      const labels = edges.map((edge) => edge.label?.trim()).filter(Boolean) as string[];
      if (labels.length !== edges.length) {
        issues.push({ code: 'branch_label', message: `判断节点 ${node.id} 的每个出口都需要标签`, nodeId: node.id });
      }
      const branchTokens = labels.flatMap((label) => label.split(/[\/|,，]/).map((item) => item.trim()));
      const nodeData = node.data as { mode?: string; intents?: string[] };
      if (nodeData.mode === 'intent') {
        const uncoveredIntents = (nodeData.intents ?? []).filter((intent) => !branchTokens.includes(intent));
        if (uncoveredIntents.length > 0) {
          issues.push({
            code: 'missing_intent_branch',
            message: `判断节点 ${node.id} 缺少意图分支: ${uncoveredIntents.join('、')}`,
            nodeId: node.id,
          });
        }
        // intent 模式必须有 fallback 出边（运行时用它承接分类为"其他"的用户意图，
        // 判定口径与 flow_executor._select_decision_edge 保持一致：
        // 未设置 label 的边，或 label 归一化后属于默认关键词集合）
        const hasFallback = edges.some((edge) => {
          const label = edge.label?.trim();
          return !label || DEFAULT_BRANCH_LABELS.has(label.toLowerCase());
        });
        if (!hasFallback) {
          issues.push({
            code: 'missing_intent_fallback',
            message: `判断节点 ${node.id} (意图模式) 缺少默认分支：请添加一条标签为"其他"或"默认"的出边，用于承接无法识别的用户意图`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  if (starts.length === 1) {
    const visited = new Set<string>();
    const queue = [starts[0].id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of outgoing.get(id) ?? []) queue.push(edge.target);
    }
    for (const node of flow.nodes) {
      if (!visited.has(node.id)) {
        issues.push({ code: 'unreachable_node', message: `节点 ${node.id} 从开始节点不可达`, nodeId: node.id });
      }
    }
  }

  return issues;
}
