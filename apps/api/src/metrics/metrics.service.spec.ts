import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('captures counters, gauges and duration summaries in a snapshot', () => {
    const metrics = new MetricsService();

    metrics.incrementCounter('outbox.processed');
    metrics.incrementCounter('outbox.processed', 2);
    metrics.setGauge('outbox.backlog', 7);
    metrics.observeDuration('outbox.batch.duration_ms', 10);
    metrics.observeDuration('outbox.batch.duration_ms', 30);

    const snapshot = metrics.snapshot();

    assert.equal(snapshot.counters['outbox.processed'], 3);
    assert.equal(snapshot.gauges['outbox.backlog'], 7);
    assert.deepEqual(snapshot.durations['outbox.batch.duration_ms'], {
      count: 2,
      totalMs: 40,
      minMs: 10,
      maxMs: 30,
      avgMs: 20,
      lastMs: 30,
    });
    assert.match(snapshot.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});
