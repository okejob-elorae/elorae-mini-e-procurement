import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { prisma, seededId } from "@elorae/db";
import { gateAllows } from "@/lib/vira/akses";
import { VIRA_SERVICE_KEY_HEADER, VIRA_TOKEN_AUDIENCE, VIRA_TOKEN_ISSUER } from "@/lib/vira/config";
import { hasPermission } from "@/lib/rbac";
import { VIRA_WRITE_PERMISSION } from "@/lib/vira/config";
import { VIRA_TOOLS, VIRA_WRITE_TOOLS } from "@/lib/vira/tools";
import { passwordFingerprint, signViraToken } from "@/lib/vira/token";
import { DELETE, GET, POST } from "./route";

/**
 * POST /api/vira/mcp against the real test bed: seeds its own permissions, roles and users,
 * signs real tokens and speaks JSON-RPC through the real MCP transport.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const SECRET = "test-vira-token-secret-0123456789abcdefg";
const SERVICE_KEY = "test-vira-service-key-0123456789abcdef";
const tag = `VIRA-MCP-${Math.random().toString(36).slice(2, 8)}`;
const HASH = `hash-${tag}`;

type JsonRpc = { jsonrpc: "2.0"; id: number; result?: Record<string, unknown>; error?: unknown };

let rpcId = 0;
function rpc(method: string, params: Record<string, unknown> = {}) {
  rpcId += 1;
  return { jsonrpc: "2.0", id: rpcId, method, params };
}

const INIT = rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "vira-test", version: "1.0.0" },
});

function minta(
  body: unknown,
  opsi: { token?: string | null; serviceKey?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...opsi.headers,
  };
  const serviceKey = opsi.serviceKey === undefined ? SERVICE_KEY : opsi.serviceKey;
  if (serviceKey !== null) headers[VIRA_SERVICE_KEY_HEADER] = serviceKey;
  if (opsi.token) headers.authorization = `Bearer ${opsi.token}`;
  return new Request("http://localhost:3000/api/vira/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

async function kirim(token: string, body: unknown): Promise<JsonRpc> {
  const res = await POST(minta(body, { token }));
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpc;
}

d("POST /api/vira/mcp (test bed only)", () => {
  let izinVira = "";
  let izinViraDibuat = false;
  let izinItems = "";
  let izinItemsDibuat = false;
  let peranA = "";
  let peranB = "";
  let peranC = "";
  let a = "";
  let b = "";
  let c = "";
  let dLimit = "";
  let tokenD = "";
  let tokenA = "";
  let tokenB = "";
  let tokenC = "";

  async function izin(code: string, module: string, action: string): Promise<{ id: string; dibuat: boolean }> {
    const ada = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
    if (ada) return { id: ada.id, dibuat: false };
    const baru = await prisma.permission.create({ data: { code, module, action }, select: { id: true } });
    return { id: baru.id, dibuat: true };
  }

  beforeAll(async () => {
    izinVira = "";
    izinItems = "";
    peranA = "";
    peranB = "";
    peranC = "";
    a = "";
    b = "";
    c = "";
    dLimit = "";
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
    const v = await izin("vira:use", "vira", "use");
    izinVira = v.id;
    izinViraDibuat = v.dibuat;
    const it = await izin("items:view", "items", "view");
    izinItems = it.id;
    izinItemsDibuat = it.dibuat;
    peranA = (
      await prisma.roleDefinition.create({
        data: {
          name: `${tag}-A`,
          permissions: { create: [{ permissionId: izinVira }, { permissionId: izinItems }] },
        },
      })
    ).id;
    peranB = (
      await prisma.roleDefinition.create({
        data: { name: `${tag}-B`, permissions: { create: [{ permissionId: izinItems }] } },
      })
    ).id;
    peranC = (await prisma.roleDefinition.create({ data: { name: `${tag}-C`, isSystem: true } })).id;
    const buat = async (suffix: string, roleId: string) =>
      (
        await prisma.user.create({
          data: { email: `${tag}-${suffix}@uji.local`, name: `${tag} ${suffix}`, roleId, passwordHash: HASH },
        })
      ).id;
    a = await buat("a", peranA);
    b = await buat("b", peranB);
    c = await buat("c", peranC);
    dLimit = await buat("d", peranC);
    tokenA = (await signViraToken({ userId: a, passwordHash: HASH })).token;
    tokenB = (await signViraToken({ userId: b, passwordHash: HASH })).token;
    tokenC = (await signViraToken({ userId: c, passwordHash: HASH })).token;
    tokenD = (await signViraToken({ userId: dLimit, passwordHash: HASH })).token;
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (a) await prisma.user.delete({ where: { id: seededId(a) } });
    if (b) await prisma.user.delete({ where: { id: seededId(b) } });
    if (c) await prisma.user.delete({ where: { id: seededId(c) } });
    if (dLimit) await prisma.user.delete({ where: { id: seededId(dLimit) } });
    if (peranA) await prisma.roleDefinition.delete({ where: { id: seededId(peranA) } });
    if (peranB) await prisma.roleDefinition.delete({ where: { id: seededId(peranB) } });
    if (peranC) await prisma.roleDefinition.delete({ where: { id: seededId(peranC) } });
    if (izinViraDibuat) await prisma.permission.delete({ where: { id: seededId(izinVira) } });
    if (izinItemsDibuat) await prisma.permission.delete({ where: { id: seededId(izinItems) } });
  });

  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
    vi.stubEnv("VIRA_SERVICE_KEY", SERVICE_KEY);
    vi.stubEnv("VIRA_APP_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("an Origin header → 403 bad_origin", async () => {
    const res = await POST(minta(INIT, { token: tokenA, headers: { origin: "http://localhost:3000" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });

  it("missing or wrong service key → 401 bad_service_key", async () => {
    for (const serviceKey of [null, "wrong-service-key-wrong-service-key-xx"]) {
      const res = await POST(minta(INIT, { token: tokenA, serviceKey }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "bad_service_key" });
    }
  });

  it("missing Bearer, bad signature or expired token → 401 invalid_token with WWW-Authenticate", async () => {
    const asing = await new SignJWT({ pwf: passwordFingerprint(HASH) })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(VIRA_TOKEN_ISSUER)
      .setAudience(VIRA_TOKEN_AUDIENCE)
      .setSubject(a)
      .setIssuedAt()
      .setExpirationTime("10m")
      .setJti("x")
      .sign(new TextEncoder().encode("another-secret-0123456789abcdefghijklmn"));
    const kedaluwarsa = (
      await signViraToken({ userId: a, passwordHash: HASH, now: new Date(Date.now() - 3_600_000) })
    ).token;
    for (const token of [null, asing, kedaluwarsa]) {
      const res = await POST(minta(INIT, { token }));
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
      const teks = await res.text();
      expect(JSON.parse(teks)).toEqual({ error: "invalid_token" });
      if (token) expect(teks).not.toContain(token);
    }
  });

  it("token secret unset → 503 not_configured", async () => {
    vi.stubEnv("VIRA_TOKEN_SECRET", "");
    const res = await POST(minta(INIT, { token: tokenA }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("unknown user or wrong pwf → 401 invalid_token", async () => {
    const tanpaPengguna = (await signViraToken({ userId: `${tag}-tidak-ada`, passwordHash: HASH })).token;
    const pwfSalah = (await signViraToken({ userId: a, passwordHash: "another-hash" })).token;
    for (const token of [tanpaPengguna, pwfSalah]) {
      const res = await POST(minta(INIT, { token }));
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
  });

  it("user B (no vira:use) → 403 forbidden", async () => {
    const res = await POST(minta(INIT, { token: tokenB }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("initialize, then tools/list as user A = the tools A's gates allow (computed)", async () => {
    const init = await kirim(tokenA, INIT);
    expect(init.result?.serverInfo).toMatchObject({ name: "elorae" });
    const list = await kirim(tokenA, rpc("tools/list"));
    const nama = (list.result?.tools as Array<{ name: string }>).map((t) => t.name);
    const izinA = ["vira:use", "items:view"];
    expect(nama).toEqual(VIRA_TOOLS.filter((t) => gateAllows(t.gate, izinA)).map((t) => t.name));
  });

  it("a system-role user (\"*\") sees every read and write tool", async () => {
    const list = await kirim(tokenC, rpc("tools/list"));
    const nama = (list.result?.tools as Array<{ name: string }>).map((t) => t.name);
    const perms = ["*"];
    expect(nama).toEqual([
      ...VIRA_TOOLS.filter((t) => gateAllows(t.gate, perms)).map((t) => t.name),
      ...VIRA_WRITE_TOOLS.filter(
        (t) => gateAllows(t.gate, perms) && hasPermission(perms, VIRA_WRITE_PERMISSION),
      ).map((t) => t.name),
    ]);
  });

  it("final tool count: a system-role user (\"*\") lists 17 reads then 9 writes in registry order", async () => {
    const list = await kirim(tokenC, rpc("tools/list"));
    const nama = (list.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(nama).toEqual([
      // VIRA_TOOLS (MODULES order)
      "whoami",
      "search_items",
      "get_item_stock",
      "get_store_stock",
      "list_store_stocktakes",
      "list_marketplace_orders",
      "get_marketplace_order",
      "list_field_sales_orders",
      "get_field_sales_order",
      "list_purchase_orders",
      "list_work_orders",
      "list_receivables",
      "list_consignment_cycles",
      "list_tax_invoices",
      "list_marketplace_settlements",
      "list_leave_requests",
      "list_spg_buyer_returns",
      // VIRA_WRITE_TOOLS (MODULES order)
      "approve_field_sales_order",
      "reject_field_sales_order",
      "close_purchase_order",
      "record_consignment_document_number",
      "mark_tax_invoice_sent_to_store",
      "approve_leave_request",
      "reject_leave_request",
      "approve_spg_buyer_return",
      "reject_spg_buyer_return",
    ]);
  });

  it("tools/call whoami as user A → A's id", async () => {
    const res = await kirim(tokenA, rpc("tools/call", { name: "whoami", arguments: {} }));
    expect(res.result?.isError).toBeFalsy();
    expect(res.result?.structuredContent).toMatchObject({ id: a, name: `${tag} a` });
  });

  it("items:view removed from role A in the DB → the same token no longer lists items:view tools", async () => {
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: seededId(peranA), permissionId: seededId(izinItems) } },
    });
    const list = await kirim(tokenA, rpc("tools/list"));
    const nama = (list.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(nama).toEqual(VIRA_TOOLS.filter((t) => gateAllows(t.gate, ["vira:use"])).map((t) => t.name));
    const who = await kirim(tokenA, rpc("tools/call", { name: "whoami", arguments: {} }));
    expect(who.result?.structuredContent).toMatchObject({ permissions: ["vira:use"] });
  });

  it("the 61st call within a minute for the same user → 429 with Retry-After", async () => {
    // User D is used only here, so its window starts empty.
    for (let i = 0; i < 60; i++) {
      expect((await POST(minta(rpc("tools/list"), { token: tokenD }))).status).toBe(200);
    }
    const res = await POST(minta(rpc("tools/list"), { token: tokenD }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Another user is not affected.
    expect((await POST(minta(rpc("tools/list"), { token: tokenC }))).status).toBe(200);
  });

  it("GET and DELETE → 405 with Allow: POST", async () => {
    for (const res of [await GET(), await DELETE()]) {
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });
});
