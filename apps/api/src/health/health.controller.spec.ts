import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HealthController } from './health.controller.js';

function fakeResponse() {
  let statusCode: number | undefined;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
  };
  return { res: res as never, getStatus: () => statusCode };
}

describe('HealthController', () => {
  it('D8 returns 200 + db:up when the DB ping succeeds', async () => {
    const prisma = { $queryRaw: async () => [{ '?column?': 1 }] };
    const controller = new HealthController(prisma as never);
    const { res, getStatus } = fakeResponse();

    const body = await controller.check(res);

    assert.equal(getStatus(), 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'up');
    assert.equal(typeof body.uptime_s, 'number');
    assert.ok(body.uptime_s >= 0);
  });

  it('D8 returns 503 + db:down when the DB ping throws', async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error('connection refused');
      },
    };
    const controller = new HealthController(prisma as never);
    const { res, getStatus } = fakeResponse();

    const body = await controller.check(res);

    assert.equal(getStatus(), 503);
    assert.equal(body.status, 'error');
    assert.equal(body.db, 'down');
  });
});
