import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthController } from './auth.controller.js';

/**
 * CALL-07：回归锁定 auth cookie 的 CSRF 属性。
 *
 * 该修复实际由 CALL-01（采用 @xiaoli-byte/authz/jwt 的 buildAccessCookieOptions/
 * buildRefreshCookieOptions）顺带完成——两者在 dev/prod 下均默认 sameSite="lax"、
 * httpOnly=true（详见该包 cookies 模块的文档注释：此前 ai-call 生产环境用的是
 * SameSite=None 且无 CSRF 防护）。本测试防止未来改动无意中把 sameSite 放宽回
 * "none" 或去掉 httpOnly。
 */

type CookieCall = [string, string, Record<string, unknown>];

function fakeResponse() {
  const cookies: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies.push([name, value, options]);
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      cleared.push([name, '', options]);
    },
  };
  return { res: res as never, cookies, cleared };
}

function assertCsrfSafeCookie(options: Record<string, unknown>) {
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.httpOnly, true);
}

describe('AuthController CALL-07 cookie CSRF hardening', () => {
  it('login sets both access and refresh cookies as SameSite=Lax + HttpOnly', async () => {
    const authService = {
      login: async () => ({
        user: { id: 'u1', email: 'a@b.com', name: 'A', status: 'active', roles: [], permissions: [] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      }),
    };
    const controller = new AuthController(authService as never);
    const { res, cookies } = fakeResponse();

    await controller.login({ email: 'a@b.com', password: 'pw' }, res);

    assert.equal(cookies.length, 2);
    for (const [, , options] of cookies) assertCsrfSafeCookie(options);
  });

  it('refresh re-sets both cookies as SameSite=Lax + HttpOnly', async () => {
    // decodeAccessTokenUnsafe needs a structurally valid (unverified) JWT to read `sub` from.
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url') +
      '.sig';
    const authService = {
      refreshTokens: async () => ({ accessToken: fakeJwt, refreshToken: 'new-refresh' }),
      buildUserProfile: async () => ({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        status: 'active',
        roles: [],
        permissions: [],
      }),
    };
    const controller = new AuthController(authService as never);
    const { res, cookies } = fakeResponse();

    const req = { cookies: { refresh_token: 'old-refresh' } };
    await controller.refresh(req as never, res);

    assert.equal(cookies.length, 2);
    for (const [, , options] of cookies) assertCsrfSafeCookie(options);
  });

  it('logout clears both cookies with matching SameSite=Lax attributes', async () => {
    const authService = { logout: async () => undefined };
    const controller = new AuthController(authService as never);
    const { res, cleared } = fakeResponse();

    await controller.logout({ cookies: {} } as never, res);

    assert.equal(cleared.length, 2);
    for (const [, , options] of cleared) {
      assert.equal(options.sameSite, 'lax');
    }
  });
});
