import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Next.js 16: avoid next-auth's auth() wrapper here (it can throw .replace on undefined
// when the request is handled by the proxy). Do a minimal session check with getToken instead.
const rolePermissions: Record<string, string[]> = {
  ADMIN: ['*'],
  PURCHASER: ['/backoffice/dashboard', '/backoffice/purchase-orders', '/backoffice/suppliers', '/api/suppliers', '/api/purchase-orders'],
  WAREHOUSE: ['/backoffice/dashboard', '/backoffice/inventory', '/backoffice/work-orders', '/backoffice/vendor-returns', '/api/inventory', '/api/grn', '/api/work-orders'],
  PRODUCTION: ['/backoffice/dashboard', '/backoffice/work-orders', '/backoffice/vendor-returns', '/api/work-orders', '/api/vendors'],
  USER: ['/backoffice/dashboard'],
};

function hasPermission(role: string | undefined, pathname: string): boolean {
  const permissions = rolePermissions[role ?? 'USER'] ?? [];
  if (permissions.includes('*')) return true;
  return permissions.some((path) => pathname.startsWith(path));
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl?.pathname ?? '/';

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Auth.js v5 uses AUTH_SECRET (NEXTAUTH_SECRET still supported in some setups).
  // If middleware uses the wrong secret, getToken() returns null and everything redirects to /login
  // even though /api/auth/session works.
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

  const token = await getToken({
    req,
    secret,
    // On Vercel/HTTPS, the cookie name is typically "__Secure-authjs.session-token"
    // while on local dev it's usually "authjs.session-token". Let next-auth pick
    // the right one based on environment.
    secureCookie: process.env.NODE_ENV === 'production',
  });

  // If already logged in and visiting /login, redirect to backoffice
  if (pathname === '/login') {
    if (token) {
      return NextResponse.redirect(new URL('/backoffice', req.url));
    }
    return NextResponse.next();
  }

  if (!token) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Exact /backoffice: let app redirect to /backoffice/dashboard (avoid redirect loop)
  if (pathname === '/backoffice') {
    return NextResponse.next();
  }

  const role = token.role as string | undefined;
  if (!hasPermission(role, pathname)) {
    return NextResponse.redirect(new URL('/backoffice/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest|sw|workbox|icons).*)'],
};
