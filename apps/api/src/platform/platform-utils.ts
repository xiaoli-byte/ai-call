import type { PlatformQueryDto } from '@ai-call/shared';

export function buildDateRange(query: PlatformQueryDto): { gte?: Date; lte?: Date } | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    ...(query.from ? { gte: new Date(query.from) } : {}),
    ...(query.to ? { lte: new Date(query.to) } : {}),
  };
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

export function avg(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]);
}

export function rate(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

export function money(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function envProvider(key: string, fallback: string): string {
  return (process.env[key] ?? fallback).trim().toLowerCase() || fallback;
}

export function endpointHost(endpoint: unknown): string | undefined {
  if (typeof endpoint !== 'string') return undefined;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint.startsWith('mock://') ? 'mock' : undefined;
  }
}

export function normalizeScenarioKey(value: string): string {
  const key = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return /^[a-z]/.test(key) ? key : `template_${key || 'scenario'}`;
}
