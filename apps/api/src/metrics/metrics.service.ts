import { Injectable } from '@nestjs/common';

export type DurationSnapshot = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  lastMs: number;
};

export type MetricsSnapshot = {
  capturedAt: string;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  durations: Record<string, DurationSnapshot>;
};

type DurationState = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
};

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations = new Map<string, DurationState>();

  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observeDuration(name: string, durationMs: number): void {
    const safeDuration = Math.max(0, durationMs);
    const current = this.durations.get(name);
    if (!current) {
      this.durations.set(name, {
        count: 1,
        totalMs: safeDuration,
        minMs: safeDuration,
        maxMs: safeDuration,
        lastMs: safeDuration,
      });
      return;
    }

    current.count += 1;
    current.totalMs += safeDuration;
    current.minMs = Math.min(current.minMs, safeDuration);
    current.maxMs = Math.max(current.maxMs, safeDuration);
    current.lastMs = safeDuration;
  }

  snapshot(): MetricsSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      durations: Object.fromEntries(
        [...this.durations].map(([name, value]) => [
          name,
          {
            ...value,
            avgMs: value.count === 0 ? 0 : value.totalMs / value.count,
          },
        ]),
      ),
    };
  }
}
