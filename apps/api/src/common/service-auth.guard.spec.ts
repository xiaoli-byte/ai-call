import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard.js';

const ORIGINAL_ENV = { ...process.env };

describe('ServiceAuthGuard', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('fails closed in production when the service token is not configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SERVICE_API_TOKEN;

    assert.throws(
      () => new ServiceAuthGuard().canActivate(context()),
      UnauthorizedException,
    );
  });

  it('allows local development without a configured service token', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SERVICE_API_TOKEN;

    assert.equal(new ServiceAuthGuard().canActivate(context()), true);
  });

  it('accepts matching service tokens', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';

    assert.equal(new ServiceAuthGuard().canActivate(context('secret')), true);
  });

  it('keeps accepting matching service tokens when signature enforcement is disabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'false';

    assert.equal(new ServiceAuthGuard().canActivate(context('secret')), true);
  });

  it('rejects requests missing a service timestamp when signature enforcement is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    assert.throws(
      () =>
        new ServiceAuthGuard().canActivate(
          context(undefined, {
            'x-service-token': 'secret',
            'x-service-signature': signature(String(Date.now()), 'secret'),
          }),
        ),
      UnauthorizedException,
    );
  });

  it('rejects requests missing a service signature when signature enforcement is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    assert.throws(
      () =>
        new ServiceAuthGuard().canActivate(
          context(undefined, {
            'x-service-token': 'secret',
            'x-service-timestamp': String(Date.now()),
          }),
        ),
      UnauthorizedException,
    );
  });

  it('rejects requests with timestamps outside the allowed signature tolerance', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    const timestamp = String(Date.now() - 300_001);

    assert.throws(
      () =>
        new ServiceAuthGuard().canActivate(
          context(undefined, {
            'x-service-token': 'secret',
            'x-service-timestamp': timestamp,
            'x-service-signature': signature(timestamp, 'secret'),
          }),
        ),
      UnauthorizedException,
    );
  });

  it('accepts correctly signed service requests when signature enforcement is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    const timestamp = String(Date.now());

    assert.equal(
      new ServiceAuthGuard().canActivate(
        context(undefined, {
          'x-service-token': 'secret',
          'x-service-timestamp': timestamp,
          'x-service-signature': signature(timestamp, 'secret'),
        }),
      ),
      true,
    );
  });

  it('rejects incorrectly signed service requests when signature enforcement is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    assert.throws(
      () =>
        new ServiceAuthGuard().canActivate(
          context(undefined, {
            'x-service-token': 'secret',
            'x-service-timestamp': String(Date.now()),
            'x-service-signature': 'bad-signature',
          }),
        ),
      UnauthorizedException,
    );
  });

  it('uses the signing secret override when signature enforcement is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_SIGNING_SECRET = 'signing-secret';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    const timestamp = String(Date.now());

    assert.throws(
      () =>
        new ServiceAuthGuard().canActivate(
          context(undefined, {
            'x-service-token': 'secret',
            'x-service-timestamp': timestamp,
            'x-service-signature': signature(timestamp, 'secret', 'secret'),
          }),
        ),
      UnauthorizedException,
    );
    assert.equal(
      new ServiceAuthGuard().canActivate(
        context(undefined, {
          'x-service-token': 'secret',
          'x-service-timestamp': timestamp,
          'x-service-signature': signature(timestamp, 'secret', 'signing-secret'),
        }),
      ),
      true,
    );
  });

  it('falls back to the service token when the signing secret override is empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVICE_API_TOKEN = 'secret';
    process.env.SERVICE_API_SIGNING_SECRET = '';
    process.env.SERVICE_API_REQUIRE_SIGNATURE = 'true';

    const timestamp = String(Date.now());

    assert.equal(
      new ServiceAuthGuard().canActivate(
        context(undefined, {
          'x-service-token': 'secret',
          'x-service-timestamp': timestamp,
          'x-service-signature': signature(timestamp, 'secret', 'secret'),
        }),
      ),
      true,
    );
  });
});

function context(
  token?: string,
  headers?: Record<string, string | string[] | undefined>,
): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: headers ?? (token ? { 'x-service-token': token } : {}),
      }),
    }),
  };
}

function signature(
  timestamp: string,
  token: string,
  secret = process.env.SERVICE_API_SIGNING_SECRET || process.env.SERVICE_API_TOKEN,
): string {
  return createHmac('sha256', secret ?? '')
    .update(`${timestamp}.${token}`)
    .digest('hex');
}
