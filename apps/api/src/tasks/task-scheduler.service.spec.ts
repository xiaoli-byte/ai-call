import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MetricsService } from '../metrics/metrics.service.js';
import { TaskSchedulerService } from './task-scheduler.service.js';

describe('TaskSchedulerService', () => {
  it('records tick, scanned, dispatched and duration metrics', async () => {
    const metrics = new MetricsService();
    const scheduler = new TaskSchedulerService({
      dispatchDuePending: async () => ({ scanned: 3, dispatched: 2 }),
    } as never, metrics);

    await scheduler.processDueTasks();

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.counters['scheduler.tick'], 1);
    assert.equal(snapshot.counters['scheduler.scanned'], 3);
    assert.equal(snapshot.counters['scheduler.dispatched'], 2);
    assert.equal(snapshot.gauges['scheduler.last_scanned'], 3);
    assert.equal(snapshot.gauges['scheduler.last_dispatched'], 2);
    assert.equal(snapshot.durations['scheduler.tick.duration_ms'].count, 1);
  });

  it('records scheduler failures without keeping the processing lock', async () => {
    const metrics = new MetricsService();
    let attempts = 0;
    const scheduler = new TaskSchedulerService({
      dispatchDuePending: async () => {
        attempts += 1;
        throw new Error('database unavailable');
      },
    } as never, metrics);

    await scheduler.processDueTasks();
    await scheduler.processDueTasks();

    const snapshot = metrics.snapshot();
    assert.equal(attempts, 2);
    assert.equal(snapshot.counters['scheduler.tick'], 2);
    assert.equal(snapshot.counters['scheduler.failure'], 2);
    assert.equal(snapshot.durations['scheduler.tick.duration_ms'].count, 2);
  });
});
