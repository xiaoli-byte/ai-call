import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg).*)'],
};

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1])) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicHome = pathname === '/' || pathname === '/home';
  const isLoginPage = pathname === '/login';
  const accessToken = request.cookies.get('access_token')?.value;
  const hasValidToken = !!accessToken && !isTokenExpired(accessToken);

  if (isPublicHome) {
    return NextResponse.next();
  }

  if (isLoginPage) {
    if (hasValidToken) {
      return NextResponse.redirect(new URL('/campaigns', request.url));
    }
    return NextResponse.next();
  }

  if (!hasValidToken) {
    const url = new URL('/login', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
