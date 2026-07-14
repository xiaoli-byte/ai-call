/**
 * useThrottleFn Hook 单元测试
 *
 * 覆盖：首次调用立即执行 / 冷却期内的重复调用被丢弃 / 冷却期结束后可再次触发 /
 * 默认节流窗口为 800ms / 卸载时清理未触发的冷却定时器。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThrottleFn } from '@/hooks/use-throttle-fn';

describe('useThrottleFn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次调用立即执行', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottleFn(fn, 800));

    act(() => result.current('a'));

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('冷却期内的重复调用被丢弃', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottleFn(fn, 800));

    act(() => result.current());
    act(() => result.current());
    act(() => vi.advanceTimersByTime(799));
    act(() => result.current());

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('冷却期结束后可以再次触发', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottleFn(fn, 800));

    act(() => result.current());
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current());

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('不传 wait 时默认节流窗口为 800ms', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottleFn(fn));

    act(() => result.current());
    act(() => vi.advanceTimersByTime(799));
    act(() => result.current());
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1));
    act(() => result.current());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('卸载时清理未触发的冷却定时器', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useThrottleFn(fn, 800));

    act(() => result.current());
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
