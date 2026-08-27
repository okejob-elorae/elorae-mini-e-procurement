import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getRequiredPermission } from "./lib/rbac";

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

function clearSessionCookies(response: NextResponse) {
  for (const name of SESSION_COOKIE_NAMES) {
    response.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  return response;
}

function isAuthenticatedToken(token: Record<string, unknown> | null): boolean {
  if (!token) return false;
  if (token.sessionInvalid) return false;
  return typeof token.id === "string" && token.id.length > 0;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow auth routes, cron, health probe, and static files
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/sw") ||
    pathname.startsWith("/workbox") ||
    pathname === "/pwa/sw.js" ||
    pathname.startsWith("/pwa/swe-worker") ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const token = (await getToken({
    req: request,
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  })) as Record<string, unknown> | null;

  const authed = isAuthenticatedToken(token);

  // Handle login page
  if (pathname === "/login") {
    if (authed) {
      return NextResponse.redirect(new URL("/backoffice", request.url));
    }
    // Stale/invalid session cookie — clear so login stays reachable.
    if (token) {
      return clearSessionCookies(NextResponse.next());
    }
    return NextResponse.next();
  }

  // Require authentication for protected routes
  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    if (token) clearSessionCookies(response);
    return response;
  }

  // Allow exact /backoffice (will redirect to dashboard in app)
  if (pathname === "/backoffice") {
    return NextResponse.next();
  }

  // Get required permission for this route
  const requiredPermission = getRequiredPermission(pathname);

  // If no permission required for this route, allow access
  if (!requiredPermission) {
    return NextResponse.next();
  }

  // Check if user has permission
  const permissions = (token?.permissions as string[]) || [];
  const hasAccess =
    permissions.includes("*") || permissions.includes(requiredPermission);

  if (!hasAccess) {
    // For API routes, return 403
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // For pages, redirect to backoffice root (avoid redirect loop when user lacks dashboard:view)
    return NextResponse.redirect(new URL("/backoffice", request.url));
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
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
