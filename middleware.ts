import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRequiredPermission } from './lib/rbac';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow auth routes, cron, and static files
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/sw') ||
    pathname.startsWith('/workbox') ||
    pathname.startsWith('/icons')
  ) {
    return NextResponse.next();
  }

  // Handle login page
  if (pathname === '/login') {
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    const token = await getToken({
      req: request,
      secret,
      secureCookie: process.env.NODE_ENV === 'production',
    });
    // If already logged in, redirect to backoffice
    if (token) {
      return NextResponse.redirect(new URL('/backoffice', request.url));
    }
    return NextResponse.next();
  }

  // Get JWT token
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const token = await getToken({
    req: request,
    secret,
    secureCookie: process.env.NODE_ENV === 'production',
  });

  // Require authentication for protected routes
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Allow exact /backoffice (will redirect to dashboard in app)
  if (pathname === '/backoffice') {
    return NextResponse.next();
  }

  // Get required permission for this route
  const requiredPermission = getRequiredPermission(pathname);

  // If no permission required for this route, allow access
  if (!requiredPermission) {
    return NextResponse.next();
  }

  // Check if user has permission
  const permissions = (token.permissions as string[]) || [];
  const hasAccess =
    permissions.includes('*') || permissions.includes(requiredPermission);

  if (!hasAccess) {
    // For API routes, return 403
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // For pages, redirect to backoffice root (avoid redirect loop when user lacks dashboard:view)
    return NextResponse.redirect(new URL('/backoffice', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
