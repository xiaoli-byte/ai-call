import type {
  DecisionNodeData,
  DialogNodeData,
  FlowEdge,
  FlowNode,
} from '@ai-call/shared';

/**
 * 把历史编辑器数据收敛为当前三类可编辑节点。
 *
 * - question 对话迁移为“固定话术 + 等待响应”；
 * - decision 节点被折叠，其出边意图下沉到上游连线；
 * - decision 上的意图例句随对应出边迁移。
 */
export function normalizeFlowForEditor(
  initialNodes: FlowNode[],
  initialEdges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let nodes = initialNodes.map(normalizeDialogNode);
  let edges = initialEdges.map(normalizeFallbackEdge);
  const decisions = nodes.filter((node) => node.type === 'decision');

  for (const decision of decisions) {
    const incoming = edges.filter((edge) => edge.target === decision.id);
    const outgoing = edges.filter((edge) => edge.source === decision.id);
    const data = decision.data as DecisionNodeData;
    const occupiedIds = new Set(edges.map((edge) => edge.id));

    edges = edges.filter(
      (edge) => edge.source !== decision.id && edge.target !== decision.id,
    );

    for (const before of incoming) {
      for (const after of outgoing) {
        let id = `migrated_${before.id}_${after.id}`;
        let suffix = 1;
        while (occupiedIds.has(id)) {
          id = `migrated_${before.id}_${after.id}_${suffix}`;
          suffix += 1;
        }
        occupiedIds.add(id);

        const label = normalizeIntentLabel(after.label);
        const examples = after.intentExamples?.length
          ? after.intentExamples
          : examplesForLabel(label, data.intentExamples);

        edges.push({
          id,
          source: before.source,
          target: after.target,
          ...(label !== undefined ? { label } : {}),
          ...(label !== undefined && examples.length > 0
            ? { intentExamples: examples }
            : {}),
          ...(before.sourceHandle !== undefined
            ? { sourceHandle: before.sourceHandle }
            : {}),
          ...(after.targetHandle !== undefined
            ? { targetHandle: after.targetHandle }
            : {}),
        });
      }
    }

    nodes = nodes.filter((node) => node.id !== decision.id);
  }

  return { nodes, edges };
}

function normalizeFallbackEdge(edge: FlowEdge): FlowEdge {
  const label = normalizeIntentLabel(edge.label);
  if (label === undefined && edge.label?.trim()) {
    const normalized = { ...edge };
    delete normalized.label;
    delete normalized.intentExamples;
    return normalized;
  }
  return { ...edge };
}

function normalizeIntentLabel(label: string | undefined): string | undefined {
  const normalized = label?.trim().toLowerCase();
  if (normalized && ['default', 'else', '默认', '其他'].includes(normalized)) {
    return undefined;
  }
  return label;
}

function normalizeDialogNode(node: FlowNode): FlowNode {
  if (node.type !== 'dialog') return { ...node };
  const data = node.data as DialogNodeData;
  if (data.mode !== 'question') return { ...node, data: { ...data } };

  return {
    ...node,
    data: {
      ...data,
      mode: 'script',
      text: data.text ?? data.prompt ?? '',
      waitForResponse: true,
    },
  };
}

function examplesForLabel(
  label: string | undefined,
  intentExamples: Record<string, string[]> | undefined,
): string[] {
  if (!label || !intentExamples) return [];
  const tokens = label
    .split(/[\/|,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens.flatMap((token) => intentExamples[token] ?? [])));
}
