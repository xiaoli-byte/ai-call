import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const validToken = [
  'eyJhbGciOiJub25lIn0',
  'eyJleHAiOjQxMDI0NDQ4MDB9',
  'signature',
].join('.');

function request(pathname: string, accessToken?: string) {
  return new NextRequest(new URL(`http://localhost${pathname}`), {
    headers: accessToken ? { cookie: `access_token=${accessToken}` } : undefined,
  });
}

describe('public homepage middleware behavior', () => {
  it('allows the public root page without an access token', () => {
    const response = middleware(request('/'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('allows the enterprise homepage without an access token', () => {
    const response = middleware(request('/home'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects logged-out console routes to login with the original path', () => {
    const response = middleware(request('/campaigns'));

    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fcampaigns');
  });

  it('sends authenticated login visits to the console entry', () => {
    const response = middleware(request('/login', validToken));

    expect(response.headers.get('location')).toBe('http://localhost/campaigns');
  });
});
