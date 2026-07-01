import type { Prisma } from '../generated/prisma/client.js';

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizeJson(value);
  return (sanitized ?? {}) as Prisma.InputJsonValue;
}

function sanitizeJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item) ?? null);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeJson(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
