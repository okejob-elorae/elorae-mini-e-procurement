import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";
import { loadActor, requireViraUse, type ViraActor } from "@/lib/vira/akses";
import { VIRA_RATE_LIMIT_MCP_PER_MIN, VIRA_SERVICE_KEY_HEADER } from "@/lib/vira/config";
import { ViraAuthError } from "@/lib/vira/errors";
import { getBaseUrl } from "@/lib/vira/output";
import { buildViraServer } from "@/lib/vira/server";
import { checkServiceKey } from "@/lib/vira/service-key";
import { verifyViraToken, type ViraTokenClaims } from "@/lib/vira/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/vira/mcp — the MCP endpoint the VIRA runtime calls, server to server. Outside the
 * NextAuth session (allow-listed in proxy.ts): the service key proves the caller is the VIRA
 * runtime, and the Bearer token says which Elorae user it acts as. Stateless: a new MCP server and
 * transport per POST. The token and service key are never echoed or logged.
 */

const JENDELA_MCP_MS = 60_000;

/** One per process, its own state (same structure as the token route's limiter). */
const pembatasMcpVira = buatPembatasJendela(VIRA_RATE_LIMIT_MCP_PER_MIN, JENDELA_MCP_MS);

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

  const token = bearerDari(request);
  if (!token) return tokenTidakSah();
  let claims: ViraTokenClaims;
  try {
    claims = await verifyViraToken(token);
  } catch (err) {
    if (err instanceof ViraAuthError && err.reason === "missing_secret") {
      return jawab(503, { error: "not_configured" });
    }
    return tokenTidakSah();
  }

  let actor: ViraActor;
  try {
    actor = await loadActor(claims);
  } catch (err) {
    if (err instanceof ViraAuthError) return tokenTidakSah();
    throw err;
  }

  try {
    requireViraUse(actor);
  } catch {
    return jawab(403, { error: "forbidden" });
  }

  if (!pembatasMcpVira.coba(actor.id)) {
    return jawab(429, { error: "rate_limited" }, { "Retry-After": String(JENDELA_MCP_MS / 1000) });
  }

  const server = buildViraServer({ actor, baseUrl: getBaseUrl(request) });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export async function GET(): Promise<Response> {
  return tolak("POST");
}

export async function DELETE(): Promise<Response> {
  return tolak("POST");
}
