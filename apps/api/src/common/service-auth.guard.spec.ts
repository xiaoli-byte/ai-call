import assert from 'node:assert/strict';
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
});

function context(token?: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token ? { 'x-service-token': token } : {},
      }),
    }),
  };
}
