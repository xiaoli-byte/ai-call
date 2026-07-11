import { describe, expect, it } from 'vitest';
import {
  migrateMapKeyOnRename,
  parseExampleLines,
  removeMapKey,
} from '../components/flow-builder/forms/intent-examples';

describe('migrateMapKeyOnRename', () => {
  it('moves the value from the old key to the new key on rename', () => {
    const result = migrateMapKeyOnRename({ 感兴趣: ['好的', '可以'] }, '感兴趣', '同意');
    expect(result).toEqual({ 同意: ['好的', '可以'] });
  });

  it('drops the key entirely when renamed to an empty/blank string', () => {
    const result = migrateMapKeyOnRename({ 感兴趣: ['好的'] }, '感兴趣', '   ');
    expect(result).toEqual({});
  });

  it('returns the same map unchanged when the old key has no entry', () => {
    const map = { 拒绝: ['不需要'] };
    const result = migrateMapKeyOnRename(map, '感兴趣', '同意');
    expect(result).toBe(map);
  });

  it('is a no-op when the name did not actually change', () => {
    const map = { 感兴趣: ['好的'] };
    const result = migrateMapKeyOnRename(map, '感兴趣', '感兴趣');
    expect(result).toBe(map);
  });
});

describe('removeMapKey', () => {
  it('deletes the entry for the given key', () => {
    const result = removeMapKey({ 感兴趣: ['好的'], 拒绝: ['不要'] }, '拒绝');
    expect(result).toEqual({ 感兴趣: ['好的'] });
  });

  it('returns the same map unchanged when the key is absent', () => {
    const map = { 感兴趣: ['好的'] };
    const result = removeMapKey(map, '拒绝');
    expect(result).toBe(map);
  });
});

describe('parseExampleLines', () => {
  it('splits by newline and trims each line', () => {
    expect(parseExampleLines('好的\n  可以  \n没问题')).toEqual(['好的', '可以', '没问题']);
  });

  it('filters out blank lines', () => {
    expect(parseExampleLines('好的\n\n   \n可以')).toEqual(['好的', '可以']);
  });

  it('returns an empty array for empty/whitespace-only input', () => {
    expect(parseExampleLines('')).toEqual([]);
    expect(parseExampleLines('   \n  ')).toEqual([]);
  });
});
