'use client';

import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_WAIT_MS = 800;

/**
 * Leading-edge 节流 Hook。
 *
 * 首次调用立即执行传入的函数；此后 wait 毫秒的冷却期内的调用一律丢弃
 * （不会延迟到冷却结束后补执行），冷却期结束后才能再次触发。
 * 用于防止用户手快连点“点击即发起网络请求”的按钮导致重复提交。
 *
 * @param fn 实际要执行的函数（支持同步或返回 Promise 的异步函数）
 * @param wait 节流窗口，单位毫秒，默认 800ms
 */
export function useThrottleFn<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  wait: number = DEFAULT_WAIT_MS,
): (...args: Args) => void {
  // 用 ref 保存最新的 fn / wait，避免每次渲染都返回新的函数引用，
  // 同时保证冷却期内引用的始终是最新一次渲染传入的回调。
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const waitRef = useRef(wait);
  waitRef.current = wait;

  const cooldownRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理尚未触发的冷却定时器，避免残留定时器。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return useCallback((...args: Args) => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    fnRef.current(...args);
    timerRef.current = setTimeout(() => {
      cooldownRef.current = false;
      timerRef.current = null;
    }, waitRef.current);
  }, []);
}
