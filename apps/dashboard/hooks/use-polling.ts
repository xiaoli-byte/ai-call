'use client';

import { useEffect, useRef } from 'react';

type PollCallback = () => void | Promise<void>;

export type UsePollingOptions = {
  enabled?: boolean;
  pauseWhenHidden?: boolean;
};

export function usePolling(
  callback: PollCallback,
  intervalMs: number,
  options: UsePollingOptions = {},
) {
  const callbackRef = useRef(callback);
  const runningRef = useRef(false);
  const { enabled = true, pauseWhenHidden = true } = options;

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const poll = async () => {
      if (runningRef.current) return;
      if (pauseWhenHidden && document.visibilityState === 'hidden') return;

      runningRef.current = true;
      try {
        await callbackRef.current();
      } finally {
        runningRef.current = false;
      }
    };

    const timer = window.setInterval(poll, intervalMs);
    return () => {
      window.clearInterval(timer);
      runningRef.current = false;
    };
  }, [enabled, intervalMs, pauseWhenHidden]);
}
