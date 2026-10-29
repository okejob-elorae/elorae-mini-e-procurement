import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getRequiredPermission } from './lib/rbac';
import { jawabTanpaSesiDenganJson } from './lib/auth/tanpa-sesi';

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow auth routes, cron, health probe, and static files
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/manifest') ||
    pathname.startsWith('/sw') ||
    pathname.startsWith('/workbox') ||
    pathname === '/pwa/sw.js' ||
    pathname.startsWith('/pwa/swe-worker') ||
    pathname.startsWith('/icons') ||
    // Aset pihak ketiga yang disajikan sendiri (mis. mesin WASM pemindai barcode).
    pathname.startsWith('/vendor/') ||
    // Portal pesan mandiri toko: tanpa masuk; token tautannya diperiksa ulang di setiap halaman dan aksi.
    pathname.startsWith('/toko/') ||
    // Formulir data KOL (link dari WhatsApp): tanpa masuk; token linknya diperiksa ulang di halaman dan aksinya.
    pathname.startsWith('/data-kol/') ||
    // API ekstensi Chrome pantau KOL: tanpa sesi; setiap handler memeriksa token perangkatnya sendiri.
    pathname.startsWith('/api/kreatif/ekstensi/') ||
    // Langganan Kalender Kreatif (Google/Apple Calendar): dibaca server kalender tanpa sesi; rutenya memeriksa token dan izin pemiliknya.
    pathname.startsWith('/api/kreatif/kalender/')
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
    // Already signed in: let the post-login redirect pick the area (and honour
    // a safe callbackUrl), instead of sending phone users to /backoffice.
    if (token) {
      const tujuan = new URL('/login/redirect', request.url);
      const kembali = request.nextUrl.searchParams.get('callbackUrl');
      if (kembali) tujuan.searchParams.set('callbackUrl', kembali);
      return NextResponse.redirect(tujuan);
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
    if (jawabTanpaSesiDenganJson(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    // Remember the page so sign-in can return to it (validated after login).
    if (request.method === 'GET') {
      loginUrl.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
    }
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
