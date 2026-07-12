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
    expect(extractFlowVariables(flow)).toEqual(['agentName', 'orderNo', 'business']);
  });

  it('extracts vars from end node farewell', () => {
    const flow = {
      nodes: [
        { data: { farewell: '感谢${customerName}参与${activity}' } },
      ],
    };
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
        { data: { text: 123 as unknown as string, prompt: undefined, systemPrompt: null as unknown as string } },
        { data: undefined as unknown as { text?: string } },
        { data: { text: '${valid}' } },
      ],
    };
    expect(extractFlowVariables(flow)).toEqual(['valid']);
  });
});
