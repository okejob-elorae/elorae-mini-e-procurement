import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockLoadActor = vi.fn();
const mockFindWriteTool = vi.fn();
const mockRevalidatePath = vi.fn();
const mockLogAudit = vi.fn();

vi.mock("@/lib/vira/akses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vira/akses")>();
  return { ...actual, loadActor: (...args: unknown[]) => mockLoadActor(...args) };
});

vi.mock("@/lib/vira/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vira/tools")>();
  return { ...actual, findWriteTool: (...args: unknown[]) => mockFindWriteTool(...args) };
});

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

import { __resetConfirmJtisForTests, signConfirmToken } from "@/lib/vira/confirm-token";
import { VIRA_SERVICE_KEY_HEADER } from "@/lib/vira/config";
import { defineWriteTool, type ViraPrepared, type ViraWriteTool } from "@/lib/vira/tools/types";
import { signViraToken } from "@/lib/vira/token";
import { DELETE, GET, POST } from "./route";

const SECRET = "test-vira-token-secret-0123456789abcdefg";
const SERVICE_KEY = "test-vira-service-key-0123456789abcdef";
const ASAL = "http://localhost:3000";

let nomor = 0;
function penggunaBaru(): string {
  nomor += 1;
  return `u-confirm-${nomor}-${Math.random().toString(36).slice(2, 8)}`;
}

const WRITE_ARGS = { orderId: "ord-1" };

function fakeWrite(options?: {
  execute?: ViraWriteTool["execute"];
  afterSuccess?: ViraWriteTool["afterSuccess"];
  gateCode?: string;
}): { tool: ViraWriteTool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(
    options?.execute ??
      (async () => ({
        ok: true as const,
        message: "Disetujui",
        url: `${ASAL}/backoffice/field-sales/ord-1`,
        entityType: "FieldSalesOrder",
        entityId: "ord-1",
      })),
  );
  const tool = defineWriteTool({
    kind: "write",
    name: "approve_fake_order",
    title: "Approve",
    description: "Approve.",
    gate: { kind: "code", code: options?.gateCode ?? "field_sales_orders:approve" },
    destructive: false,
    inputShape: { orderId: z.string() },
    argsSchema: z.object({ orderId: z.string() }),
    prepare: async (): Promise<ViraPrepared<typeof WRITE_ARGS>> => ({
      preview: {
        title: "Setujui",
        summary: "OK",
        details: [],
        confirmLabel: "Setujui",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "FieldSalesOrder", id: "ord-1", url: `${ASAL}/o/ord-1` },
      },
      args: WRITE_ARGS,
    }),
    execute: execute as ViraWriteTool["execute"],
    revalidate: () => ["/backoffice/field-sales", "/backoffice/field-sales/ord-1"],
    afterSuccess: options?.afterSuccess,
  });
  return { tool, execute };
}

async function accessTokenFor(userId: string): Promise<string> {
  const { token } = await signViraToken({ userId, passwordHash: "hash" });
  return token;
}

async function confirmTokenFor(userId: string, tool = "approve_fake_order", args: unknown = WRITE_ARGS) {
  return signConfirmToken({ userId, tool, args });
}

function minta(opts: {
  userId: string;
  accessToken: string;
  body?: unknown;
  origin?: string;
  serviceKey?: string | null;
  omitAuth?: boolean;
}): Request {
  const headers = new Headers();
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.serviceKey !== null) {
    headers.set(VIRA_SERVICE_KEY_HEADER, opts.serviceKey ?? SERVICE_KEY);
  }
  if (!opts.omitAuth) headers.set("authorization", `Bearer ${opts.accessToken}`);
  headers.set("content-type", "application/json");
  return new Request(`${ASAL}/api/vira/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      opts.body ?? { confirmToken: "placeholder", decision: "confirm" },
    ),
  });
}

describe("POST /api/vira/confirm", () => {
  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
    vi.stubEnv("VIRA_SERVICE_KEY", SERVICE_KEY);
    mockLoadActor.mockReset();
    mockFindWriteTool.mockReset();
    mockRevalidatePath.mockReset();
    mockLogAudit.mockReset();
    __resetConfirmJtisForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Origin present → 403 bad_origin", async () => {
    const id = penggunaBaru();
    const res = await POST(
      minta({ userId: id, accessToken: await accessTokenFor(id), origin: ASAL }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });

  it("bad service key → 401 bad_service_key", async () => {
    const id = penggunaBaru();
    const res = await POST(
      minta({ userId: id, accessToken: await accessTokenFor(id), serviceKey: "wrong-key-xxxxxxxxxxxxxxxxxxxxxxxx" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "bad_service_key" });
  });

  it("missing bearer → 401 invalid_token", async () => {
    const id = penggunaBaru();
    const res = await POST(minta({ userId: id, accessToken: "x", omitAuth: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("missing vira:use → 403 forbidden", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:write", "field_sales_orders:approve"],
    });
    const res = await POST(minta({ userId: id, accessToken: await accessTokenFor(id) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("missing vira:write → 403 forbidden", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "field_sales_orders:approve"],
    });
    const res = await POST(minta({ userId: id, accessToken: await accessTokenFor(id) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("bad body → 400 invalid_request", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"],
    });
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: "", decision: "maybe" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("expired confirm token → 410 confirmation_expired", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"],
    });
    const past = new Date("2020-01-01T00:00:00.000Z");
    const { token } = await signConfirmToken({
      userId: id,
      tool: "approve_fake_order",
      args: WRITE_ARGS,
      now: past,
    });
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "confirmation_expired" });
  });

  it("tampered confirm token → 400 invalid_confirmation", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"],
    });
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: "not.a.jwt", decision: "confirm" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_confirmation" });
  });

  it("confirm token of another user → 403 forbidden", async () => {
    const id = penggunaBaru();
    const other = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"],
    });
    const { token } = await confirmTokenFor(other);
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("reused jti → 409 already_used", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write", "field_sales_orders:approve"],
    });
    const { tool, execute } = fakeWrite();
    mockFindWriteTool.mockReturnValue(tool);
    const { token } = await confirmTokenFor(id);
    const first = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "cancel" },
      }),
    );
    expect(first.status).toBe(200);
    const second = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_used" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancel → 200 cancelled, execute not called", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write", "field_sales_orders:approve"],
    });
    const { tool, execute } = fakeWrite();
    mockFindWriteTool.mockReturnValue(tool);
    const { token } = await confirmTokenFor(id);
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "cancel" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
    expect(mockFindWriteTool).not.toHaveBeenCalled();
  });

  it("gate removed between prepare and confirm → 403, execute not called", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"], // no field_sales_orders:approve
    });
    const { tool, execute } = fakeWrite();
    mockFindWriteTool.mockReturnValue(tool);
    const { token } = await confirmTokenFor(id);
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("execute refusal → 200 refused, no revalidatePath, no logAudit", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write", "field_sales_orders:approve"],
    });
    const { tool, execute } = fakeWrite({
      execute: async () => ({
        ok: false,
        code: "CREDIT_LIMIT",
        message: "Kredit penuh",
        url: `${ASAL}/o/ord-1`,
      }),
    });
    mockFindWriteTool.mockReturnValue(tool);
    const { token } = await confirmTokenFor(id);
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "refused",
      code: "CREDIT_LIMIT",
      message: "Kredit penuh",
      url: `${ASAL}/o/ord-1`,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("success → 200 done, revalidatePath + logAudit + afterSuccess; afterSuccess throw still done", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write", "field_sales_orders:approve"],
    });
    const afterSuccess = vi.fn(async () => {
      throw new Error("notify failed");
    });
    const { tool, execute } = fakeWrite({ afterSuccess });
    mockFindWriteTool.mockReturnValue(tool);
    const { token, jti } = await confirmTokenFor(id);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    logged.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "done",
      message: "Disetujui",
      url: `${ASAL}/backoffice/field-sales/ord-1`,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/backoffice/field-sales",
      "/backoffice/field-sales/ord-1",
    ]);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit.mock.calls[0][0]).toMatchObject({
      userId: id,
      action: "VIRA:approve_fake_order",
      entityType: "FieldSalesOrder",
      entityId: "ord-1",
      metadata: { via: "vira", jti },
    });
    expect(afterSuccess).toHaveBeenCalledTimes(1);
  });

  it("unknown write tool → 400 invalid_confirmation", async () => {
    const id = penggunaBaru();
    mockLoadActor.mockResolvedValue({
      id,
      name: "Uji",
      permissions: ["vira:use", "vira:write"],
    });
    mockFindWriteTool.mockReturnValue(undefined);
    const { token } = await confirmTokenFor(id, "missing_tool");
    const res = await POST(
      minta({
        userId: id,
        accessToken: await accessTokenFor(id),
        body: { confirmToken: token, decision: "confirm" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_confirmation" });
  });
});

describe("GET/DELETE /api/vira/confirm", () => {
  it("GET and DELETE → 405", async () => {
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });
});
