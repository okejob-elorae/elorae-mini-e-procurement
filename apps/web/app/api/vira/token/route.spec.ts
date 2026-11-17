import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return { ...actual, prisma: { user: { findUnique: vi.fn() } } };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { verifyViraToken } from "@/lib/vira/token";
import { GET, POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

const SECRET = "test-vira-token-secret-0123456789abcdefg";
const ASAL = "http://localhost:3000";

let nomor = 0;
/** A fresh user id per test, so the in-memory limiter never carries over between tests. */
function penggunaBaru(): string {
  nomor += 1;
  return `u-vira-${nomor}-${Math.random().toString(36).slice(2, 8)}`;
}

function sesi(id: string, permissions: string[]) {
  return { user: { id, permissions } };
}

function minta(headers: Record<string, string> = { origin: ASAL }): Request {
  return new Request(`${ASAL}/api/vira/token`, { method: "POST", headers });
}

describe("POST /api/vira/token", () => {
  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
    vi.stubEnv("VIRA_APP_URL", "");
    mockAuth.mockReset();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue({ passwordHash: "hash" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no session → 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(minta());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("missing Origin → 403 bad_origin", async () => {
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["*"]));
    const res = await POST(minta({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });

  it("foreign Origin → 403 bad_origin", async () => {
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["*"]));
    const res = await POST(minta({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });

  it("Origin is compared with VIRA_APP_URL when it is set", async () => {
    vi.stubEnv("VIRA_APP_URL", "https://elorae.test");
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["*"]));
    expect((await POST(minta({ origin: ASAL }))).status).toBe(403);
    expect((await POST(minta({ origin: "https://elorae.test" }))).status).toBe(200);
  });

  it("session without vira:use → 403 forbidden", async () => {
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["items:view"]));
    const res = await POST(minta());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it('session with ["*"] → 200', async () => {
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["*"]));
    expect((await POST(minta())).status).toBe(200);
  });

  it("secret unset → 503 not_configured", async () => {
    vi.stubEnv("VIRA_TOKEN_SECRET", "");
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["vira:use"]));
    const res = await POST(minta());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("user gone from the DB → 401 unauthenticated", async () => {
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["vira:use"]));
    mockFindUnique.mockResolvedValue(null);
    const res = await POST(minta());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("the 11th call within a minute for the same user → 429 with Retry-After", async () => {
    const id = penggunaBaru();
    mockAuth.mockResolvedValue(sesi(id, ["vira:use"]));
    for (let i = 0; i < 10; i++) expect((await POST(minta())).status).toBe(200);
    const res = await POST(minta());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Another user is not affected.
    mockAuth.mockResolvedValue(sesi(penggunaBaru(), ["vira:use"]));
    expect((await POST(minta())).status).toBe(200);
  });

  it("success → a token that verifies, sub = the user id, Cache-Control: no-store", async () => {
    const id = penggunaBaru();
    mockAuth.mockResolvedValue(sesi(id, ["vira:use"]));
    const sebelum = Date.now();
    const res = await POST(minta());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
    const claims = await verifyViraToken(body.token);
    expect(claims.sub).toBe(id);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id }, select: { passwordHash: true } });
    const kedaluwarsa = new Date(body.expiresAt).getTime();
    expect(body.expiresAt).toBe(new Date(kedaluwarsa).toISOString());
    expect(kedaluwarsa).toBeGreaterThanOrEqual(Math.floor(sebelum / 1000) * 1000 + 600_000);
  });
});

describe("GET /api/vira/token", () => {
  it("→ 405 with Allow: POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
