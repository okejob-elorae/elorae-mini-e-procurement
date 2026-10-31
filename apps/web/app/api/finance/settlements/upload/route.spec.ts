import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  class SettlementGandaError extends Error {
    readonly code = "SETTLEMENT_GANDA" as const;
    constructor(readonly pertama: { id: string; fileName: string; uploadedAt: Date; uploadedByName: string | null; status: string }) {
      super("ganda");
    }
  }
  return { SettlementGandaError };
});

vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: {
      settlement: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/finance/settlement/parser", () => ({
  parseSettlement: vi.fn(),
  isSupportedMarketplace: (m: string) => m === "SHOPEE" || m === "TIKTOK",
}));
vi.mock("@/lib/finance/settlement/persist", () => ({
  persistSettlement: vi.fn(),
  hapusSettlementBelumDijurnal: vi.fn(),
  SettlementGandaError: m.SettlementGandaError,
}));
vi.mock("@/lib/finance/settlement/match", () => ({ matchSettlement: vi.fn() }));
vi.mock("@/lib/finance/settlement/start-resync", () => ({ startSettlementResync: vi.fn() }));

import { prisma, Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { parseSettlement } from "@/lib/finance/settlement/parser";
import { hapusSettlementBelumDijurnal, persistSettlement } from "@/lib/finance/settlement/persist";
import { matchSettlement } from "@/lib/finance/settlement/match";
import { startSettlementResync } from "@/lib/finance/settlement/start-resync";
import { PERMISSIONS } from "@/lib/rbac";
import { DELETE, POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.settlement.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockParse = parseSettlement as unknown as ReturnType<typeof vi.fn>;
const mockPersist = persistSettlement as unknown as ReturnType<typeof vi.fn>;
const mockMatch = matchSettlement as unknown as ReturnType<typeof vi.fn>;
const mockResync = startSettlementResync as unknown as ReturnType<typeof vi.fn>;
const mockHapus = hapusSettlementBelumDijurnal as unknown as ReturnType<typeof vi.fn>;

const keuangan = { user: { id: "u-keu", permissions: [PERMISSIONS.SETTLEMENTS_MANAGE] } };

const FILE_BYTES = Buffer.from("settlement-file-bytes");
const FILE_SHA = createHash("sha256").update(FILE_BYTES).digest("hex");

/* The route only calls request.formData(), so a plain Request stands in for NextRequest. */
function buildRequest(): Parameters<typeof POST>[0] {
  const formData = new FormData();
  formData.append("file", new File([FILE_BYTES], "report.xlsx"));
  formData.append("marketplace", "SHOPEE");
  return new Request("http://localhost/api/finance/settlements/upload", {
    method: "POST",
    body: formData,
  }) as unknown as Parameters<typeof POST>[0];
}

function unggahan() {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "Income.sudah dilepas.xlsx"));
  fd.append("marketplace", "SHOPEE");
  return new NextRequest("http://localhost/api/finance/settlements/upload", { method: "POST", body: fd });
}

function hapus(body: unknown) {
  return new NextRequest("http://localhost/api/finance/settlements/upload", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["*"] } });
  mockParse.mockReturnValue({ ok: true, data: { incomeLines: [] } });
  mockMatch.mockResolvedValue({ matched: 0, unmatched: 0 });
  mockResync.mockResolvedValue({ ok: false, code: "NO_TARGETS" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/finance/settlements/upload dedupe", () => {
  it("returns 409 with the existing id for an already-uploaded file, without parsing or persisting", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing-1" });

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "existing-1" });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { marketplace: "SHOPEE", fileSha256: FILE_SHA },
      select: { id: true },
    });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("persists a new file with its SHA-256 hex", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPersist.mockResolvedValue({
      settlementId: "new-1",
      checksumOk: true,
      checksumVariance: 0,
      lineCount: 0,
    });

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ fileSha256: FILE_SHA, marketplace: "SHOPEE" }),
    );
  });

  it("returns 409 with the winner's id when a racing upload trips the unique on create", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-1" });
    mockPersist.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "winner-1" });
  });

  it("returns 409 with the winner's id when the loser's transaction expires waiting on the winner (P2028)", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-1" });
    mockPersist.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Transaction already closed", {
        code: "P2028",
        clientVersion: "test",
      }),
    );

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "winner-1" });
  });

  it("does not turn any other persist error into a 409", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPersist.mockRejectedValue(new Error("db down"));

    const res = await POST(buildRequest());

    expect(res.status).toBe(500);
  });
});

describe("POST unggah settlement", () => {
  it("unggahan kembar → 409 yang menyebut unggahan pertama", async () => {
    mockAuth.mockResolvedValue(keuangan);
    mockPersist.mockRejectedValue(
      new m.SettlementGandaError({
        id: "stl-1",
        fileName: "juni.xlsx",
        uploadedAt: new Date("2026-07-02T03:04:05.000Z"),
        uploadedByName: "Rina",
        status: "MATCHED",
      }),
    );

    const res = await POST(unggahan());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "SETTLEMENT_GANDA",
      pertama: {
        id: "stl-1",
        fileName: "juni.xlsx",
        uploadedAt: "2026-07-02T03:04:05.000Z",
        uploadedByName: "Rina",
        status: "MATCHED",
      },
    });
  });

  it("galat lain tetap 500", async () => {
    mockAuth.mockResolvedValue(keuangan);
    mockPersist.mockRejectedValue(new Error("boom"));
    const res = await POST(unggahan());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/finance/settlements/upload size pre-check", () => {
  function requestWithLength(length: number): Parameters<typeof POST>[0] {
    return new Request("http://localhost/api/finance/settlements/upload", {
      method: "POST",
      headers: { "content-length": String(length) },
      body: "x",
    }) as unknown as Parameters<typeof POST>[0];
  }

  it("refuses an oversize declared body with 413 before parsing the multipart", async () => {
    const formDataSpy = vi.spyOn(Request.prototype, "formData");

    try {
      const res = await POST(requestWithLength(10 * 1024 * 1024 + 64 * 1024 + 1));

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "File exceeds the 10 MB limit" });
      expect(formDataSpy).not.toHaveBeenCalled();
    } finally {
      formDataSpy.mockRestore();
    }
  });

  it("lets a max-size file plus multipart overhead through to the parser", async () => {
    const res = await POST(requestWithLength(10 * 1024 * 1024 + 64 * 1024));

    expect(res.status).not.toBe(413);
  });
});

describe("DELETE batalkan unggahan settlement", () => {
  it("tanpa izin settlement → 403 dan tidak menghapus apa pun", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-gudang", permissions: ["inventory:view"] } });
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "salah unggah" }));
    expect(res.status).toBe(403);
    expect(mockHapus).not.toHaveBeenCalled();
  });

  it("tanpa sesi → 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "x" }));
    expect(res.status).toBe(401);
    expect(mockHapus).not.toHaveBeenCalled();
  });

  it("pelaku diambil dari sesi, bukan dari isian", async () => {
    mockAuth.mockResolvedValue(keuangan);
    mockHapus.mockResolvedValue({ ok: true });
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "kembar", userId: "orang-lain" }));
    expect(res.status).toBe(200);
    expect(mockHapus).toHaveBeenCalledWith({ settlementId: "stl-1", userId: "u-keu", alasan: "kembar" });
  });

  it("yang sudah dijurnal → 409, yang tidak ada → 404, alasan kosong → 400", async () => {
    mockAuth.mockResolvedValue(keuangan);
    mockHapus.mockResolvedValueOnce({ ok: false, code: "SUDAH_DIJURNAL" });
    expect((await DELETE(hapus({ settlementId: "a", alasan: "x" }))).status).toBe(409);
    mockHapus.mockResolvedValueOnce({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect((await DELETE(hapus({ settlementId: "b", alasan: "x" }))).status).toBe(404);
    mockHapus.mockResolvedValueOnce({ ok: false, code: "ALASAN_WAJIB" });
    const r = await DELETE(hapus({ settlementId: "c", alasan: " " }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, code: "ALASAN_WAJIB" });
  });

  it("isian rusak → 400 tanpa memanggil penulis", async () => {
    mockAuth.mockResolvedValue(keuangan);
    expect((await DELETE(hapus({ settlementId: 5 }))).status).toBe(400);
    expect(mockHapus).not.toHaveBeenCalled();
  });
});
