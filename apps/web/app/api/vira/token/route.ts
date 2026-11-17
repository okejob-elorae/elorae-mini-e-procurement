import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";
import { hasPermission } from "@/lib/rbac";
import { getViraEnv, VIRA_RATE_LIMIT_TOKEN_PER_MIN, VIRA_USE_PERMISSION } from "@/lib/vira/config";
import { getBaseUrl } from "@/lib/vira/output";
import { signViraToken } from "@/lib/vira/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/vira/token — the chat widget asks for a short-lived VIRA token for the logged-in user.
 * Stays behind the NextAuth session in proxy.ts. The token is never logged.
 */

const JENDELA_TOKEN_MS = 60_000;

/** One per process, its own state (same structure as `pembatasBacaLangganan`). */
const pembatasTokenVira = buatPembatasJendela(VIRA_RATE_LIMIT_TOKEN_PER_MIN, JENDELA_TOKEN_MS);

function jawab(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function originSama(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(getBaseUrl(request)).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jawab(401, { error: "unauthenticated" });

  if (!originSama(request)) return jawab(403, { error: "bad_origin" });

  if (!hasPermission(session.user.permissions ?? [], VIRA_USE_PERMISSION)) {
    return jawab(403, { error: "forbidden" });
  }

  if (!pembatasTokenVira.coba(userId)) {
    return jawab(429, { error: "rate_limited" }, { "Retry-After": String(JENDELA_TOKEN_MS / 1000) });
  }

  if (!getViraEnv().tokenSecret) return jawab(503, { error: "not_configured" });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return jawab(401, { error: "unauthenticated" });

  const { token, expiresAt } = await signViraToken({ userId, passwordHash: user.passwordHash });
  return jawab(200, { token, expiresAt: expiresAt.toISOString() });
}

export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
