import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";
import { hasPermission } from "@/lib/rbac";
import { gateAllows, loadActor, requireViraUse, type ViraActor } from "@/lib/vira/akses";
import {
  consumeConfirmJti,
  verifyConfirmToken,
  type ViraConfirmClaims,
} from "@/lib/vira/confirm-token";
import { VIRA_SERVICE_KEY_HEADER, VIRA_WRITE_PERMISSION } from "@/lib/vira/config";
import { ViraAuthError } from "@/lib/vira/errors";
import { getBaseUrl } from "@/lib/vira/output";
import { checkServiceKey } from "@/lib/vira/service-key";
import { findWriteTool } from "@/lib/vira/tools";
import { verifyViraToken, type ViraTokenClaims } from "@/lib/vira/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/vira/confirm — the only place a VIRA write is applied. The VIRA runtime calls this when
 * the user presses Confirm or Cancel. Outside the NextAuth session (allow-listed in proxy.ts):
 * service key + Bearer access token + single-use confirm token. Never logs either token.
 */

const JENDELA_CONFIRM_MS = 60_000;
const VIRA_RATE_LIMIT_CONFIRM_PER_MIN = 20;

/** One per process, its own state (same structure as the MCP/token route limiters). */
const pembatasConfirmVira = buatPembatasJendela(VIRA_RATE_LIMIT_CONFIRM_PER_MIN, JENDELA_CONFIRM_MS);

const bodySchema = z.object({
  confirmToken: z.string().min(1).max(8192),
  decision: z.enum(["confirm", "cancel"]),
});

function jawab(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

const tokenTidakSah = () => jawab(401, { error: "invalid_token" }, { "WWW-Authenticate": "Bearer" });

function bearerDari(request: Request): string | null {
  const kepala = request.headers.get("authorization");
  const cocok = kepala ? /^Bearer\s+(\S+)\s*$/i.exec(kepala) : null;
  return cocok ? cocok[1] : null;
}

const tolak = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow } });

export async function POST(request: Request): Promise<Response> {
  if (request.headers.has("origin")) return jawab(403, { error: "bad_origin" });

  if (!checkServiceKey(request.headers.get(VIRA_SERVICE_KEY_HEADER))) {
    return jawab(401, { error: "bad_service_key" });
  }

  const accessToken = bearerDari(request);
  if (!accessToken) return tokenTidakSah();
  let accessClaims: ViraTokenClaims;
  try {
    accessClaims = await verifyViraToken(accessToken);
  } catch (err) {
    if (err instanceof ViraAuthError && err.reason === "missing_secret") {
      return jawab(503, { error: "not_configured" });
    }
    return tokenTidakSah();
  }

  let actor: ViraActor;
  try {
    actor = await loadActor(accessClaims);
  } catch (err) {
    if (err instanceof ViraAuthError) return tokenTidakSah();
    throw err;
  }

  try {
    requireViraUse(actor);
  } catch {
    return jawab(403, { error: "forbidden" });
  }
  if (!hasPermission(actor.permissions, VIRA_WRITE_PERMISSION)) {
    return jawab(403, { error: "forbidden" });
  }

  if (!pembatasConfirmVira.coba(actor.id)) {
    return jawab(429, { error: "rate_limited" }, { "Retry-After": String(JENDELA_CONFIRM_MS / 1000) });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return jawab(400, { error: "invalid_request" });
  }
  const parsedBody = bodySchema.safeParse(bodyJson);
  if (!parsedBody.success) return jawab(400, { error: "invalid_request" });

  let confirmClaims: ViraConfirmClaims;
  try {
    confirmClaims = await verifyConfirmToken(parsedBody.data.confirmToken);
  } catch (err) {
    if (err instanceof ViraAuthError && err.reason === "expired") {
      return jawab(410, { error: "confirmation_expired" });
    }
    return jawab(400, { error: "invalid_confirmation" });
  }

  if (confirmClaims.sub !== actor.id) return jawab(403, { error: "forbidden" });

  if (!consumeConfirmJti(confirmClaims.jti, confirmClaims.exp)) {
    return jawab(409, { error: "already_used" });
  }

  if (parsedBody.data.decision === "cancel") {
    return jawab(200, { status: "cancelled" });
  }

  const tool = findWriteTool(confirmClaims.tool);
  if (!tool) return jawab(400, { error: "invalid_confirmation" });

  if (!gateAllows(tool.gate, actor.permissions)) {
    return jawab(403, { error: "forbidden" });
  }

  const args = tool.argsSchema.safeParse(confirmClaims.args);
  if (!args.success) return jawab(400, { error: "invalid_confirmation" });

  const ctx = { actor, baseUrl: getBaseUrl(request) };
  let result;
  try {
    result = await tool.execute(args.data, ctx);
  } catch (err) {
    console.error("[vira] confirm failed", tool.name, err);
    return jawab(500, {
      status: "failed",
      code: "INTERNAL",
      message: "Terjadi kesalahan. Coba lagi.",
    });
  }

  if (!result.ok) {
    return jawab(200, {
      status: "refused",
      code: result.code,
      message: result.message,
      ...(result.url ? { url: result.url } : {}),
    });
  }

  for (const p of tool.revalidate(args.data, result)) {
    revalidatePath(p);
  }

  await logAudit({
    userId: actor.id,
    action: `VIRA:${tool.name}`,
    entityType: result.entityType,
    entityId: result.entityId,
    metadata: { via: "vira", jti: confirmClaims.jti },
  });

  try {
    await tool.afterSuccess?.(args.data, result, ctx);
  } catch (err) {
    console.error("[vira] confirm afterSuccess failed", tool.name, err);
  }

  return jawab(200, { status: "done", message: result.message, url: result.url });
}

export async function GET(): Promise<Response> {
  return tolak("POST");
}

export async function DELETE(): Promise<Response> {
  return tolak("POST");
}
