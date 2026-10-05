import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  class SettlementGandaError extends Error {
    readonly code = "SETTLEMENT_GANDA" as const;
    constructor(readonly pertama: { id: string; fileName: string; uploadedAt: Date; uploadedByName: string | null; status: string }) {
      super("ganda");
    }
  }
  return { SettlementGandaError, persist: vi.fn(), hapus: vi.fn(), auth: vi.fn() };
});

vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/finance/settlement/parser", () => ({
  isSupportedMarketplace: (x: string) => x === "SHOPEE" || x === "TIKTOK",
  parseSettlement: () => ({ ok: true, data: { seller: "toko" } }),
}));
vi.mock("@/lib/finance/settlement/persist", () => ({
  persistSettlement: m.persist,
  hapusSettlementBelumDijurnal: m.hapus,
  SettlementGandaError: m.SettlementGandaError,
}));

import { PERMISSIONS } from "@/lib/rbac";
import { DELETE, POST } from "./route";

const keuangan = { user: { id: "u-keu", permissions: [PERMISSIONS.SETTLEMENTS_MANAGE] } };

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
  vi.clearAllMocks();
});

describe("POST unggah settlement", () => {
  it("unggahan kembar → 409 yang menyebut unggahan pertama", async () => {
    m.auth.mockResolvedValue(keuangan);
    m.persist.mockRejectedValue(
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
    m.auth.mockResolvedValue(keuangan);
    m.persist.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(unggahan());
    expect(res.status).toBe(500);
  });
});

describe("DELETE batalkan unggahan settlement", () => {
  it("tanpa izin settlement → 403 dan tidak menghapus apa pun", async () => {
    m.auth.mockResolvedValue({ user: { id: "u-gudang", permissions: ["inventory:view"] } });
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "salah unggah" }));
    expect(res.status).toBe(403);
    expect(m.hapus).not.toHaveBeenCalled();
  });

  it("tanpa sesi → 401", async () => {
    m.auth.mockResolvedValue(null);
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "x" }));
    expect(res.status).toBe(401);
    expect(m.hapus).not.toHaveBeenCalled();
  });

  it("pelaku diambil dari sesi, bukan dari isian", async () => {
    m.auth.mockResolvedValue(keuangan);
    m.hapus.mockResolvedValue({ ok: true });
    const res = await DELETE(hapus({ settlementId: "stl-1", alasan: "kembar", userId: "orang-lain" }));
    expect(res.status).toBe(200);
    expect(m.hapus).toHaveBeenCalledWith({ settlementId: "stl-1", userId: "u-keu", alasan: "kembar" });
  });

  it("yang sudah dijurnal → 409, yang tidak ada → 404, alasan kosong → 400", async () => {
    m.auth.mockResolvedValue(keuangan);
    m.hapus.mockResolvedValueOnce({ ok: false, code: "SUDAH_DIJURNAL" });
    expect((await DELETE(hapus({ settlementId: "a", alasan: "x" }))).status).toBe(409);
    m.hapus.mockResolvedValueOnce({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect((await DELETE(hapus({ settlementId: "b", alasan: "x" }))).status).toBe(404);
    m.hapus.mockResolvedValueOnce({ ok: false, code: "ALASAN_WAJIB" });
    const r = await DELETE(hapus({ settlementId: "c", alasan: " " }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, code: "ALASAN_WAJIB" });
  });

  it("isian rusak → 400 tanpa memanggil penulis", async () => {
    m.auth.mockResolvedValue(keuangan);
    expect((await DELETE(hapus({ settlementId: 5 }))).status).toBe(400);
    expect(m.hapus).not.toHaveBeenCalled();
  });
});
