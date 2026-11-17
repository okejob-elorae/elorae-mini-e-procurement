import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  daftarReturPembeliKantor: vi.fn(),
  rincianReturPembeliKantor: vi.fn(),
  setujuiReturPembeli: vi.fn(),
  tolakReturPembeli: vi.fn(),
  resolveStore: vi.fn(),
}));

vi.mock("@/lib/spg/retur-pembeli-queries", () => ({
  daftarReturPembeliKantor: m.daftarReturPembeliKantor,
  rincianReturPembeliKantor: m.rincianReturPembeliKantor,
}));
vi.mock("@/lib/spg/retur-pembeli", () => ({
  setujuiReturPembeli: m.setujuiReturPembeli,
  tolakReturPembeli: m.tolakReturPembeli,
}));
vi.mock("./_resolve-store", () => ({
  resolveStore: m.resolveStore,
}));

import { __sampleInput, parityCases, tools, writeTools } from "./retur-spg";

const list = tools.find((t) => t.name === "list_spg_buyer_returns")!;
const approve = writeTools.find((t) => t.name === "approve_spg_buyer_return")!;
const reject = writeTools.find((t) => t.name === "reject_spg_buyer_return")!;
const listSchema = z.object(list.inputShape);
const approveSchema = z.object(approve.inputShape);
const rejectSchema = z.object(reject.inputShape);

const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["spg_sales:view"] },
  baseUrl: "https://e.test",
};
const writeCtx: ViraToolContext = {
  actor: { id: "u-admin", name: "Admin", permissions: ["spg_returns:approve", "vira:write"] },
  baseUrl: "https://e.test",
};

function detail(extra: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    status: "MENUNGGU",
    dilaporkanPada: new Date("2026-11-10T02:00:00Z"),
    pelapor: { id: "u-spg", nama: "Sari" },
    toko: { id: "s1", nama: "Toko Melati", termsType: "KONSI" },
    nota: { id: "sale-1", docNo: "NT-001", waktu: new Date("2026-11-09T02:00:00Z"), total: 100_000 },
    alasan: "ukuran salah",
    diputuskan: { olehId: null, oleh: null, pada: null, alasanTolak: null },
    uang: { keadaan: "MENUNGGU_BELUM", pada: null, olehKantor: null },
    foto: { barang: null, struk: null },
    strukTidakTercatat: [],
    bebanJikaDitolak: 50_000,
    beban: null,
    baris: [
      {
        id: "l1",
        saleLineId: "sl1",
        productName: "Kaos",
        variantSku: "KAOS-01",
        kondisi: "LAYAK",
        qty: 2,
        terjual: 5,
        sudahKembali: 0,
        menungguLain: 0,
        nilaiBersih: 50_000,
      },
    ],
    peringatan: {
      bulanKomisi: "2026-11",
      komisiDitutup: false,
      bulanLaporan: "2026-11",
      siklusKonsiTerkunci: false,
    },
    jejak: [],
    ...extra,
  };
}

function listRow() {
  return {
    id: "r-1",
    status: "MENUNGGU",
    dilaporkanPada: new Date("2026-11-10T02:00:00Z"),
    storeId: "s1",
    toko: "Toko Melati",
    pelapor: "Sari",
    spgSaleId: "sale-1",
    docNo: "NT-001",
    pcs: 2,
    ringkasBarang: "KAOS-01 × 2",
    alasan: "ukuran salah",
    diputuskanOleh: null,
    diputuskanPada: null,
    alasanTolak: null,
    uang: "MENUNGGU_BELUM",
    beban: null,
  };
}

beforeEach(() => {
  m.daftarReturPembeliKantor.mockReset().mockResolvedValue({
    baris: [listRow()],
    total: 1,
    perStatus: { MENUNGGU: 1, DISETUJUI: 0, DITOLAK: 0, DIBATALKAN: 0 },
    keputusanBarang: 0,
  });
  m.rincianReturPembeliKantor.mockReset().mockResolvedValue(detail());
  m.setujuiReturPembeli.mockReset().mockResolvedValue({
    ok: true,
    returnId: "r-1",
    spgSaleId: "sale-1",
    status: "DISETUJUI",
  });
  m.tolakReturPembeli.mockReset().mockResolvedValue({
    ok: true,
    returnId: "r-1",
    spgSaleId: "sale-1",
    status: "DITOLAK",
  });
  m.resolveStore.mockReset().mockResolvedValue({ id: "s1", code: "MLT", name: "Toko Melati" });
});

describe("list_spg_buyer_returns", () => {
  it("accepts status enums and pages via daftar", async () => {
    expect(listSchema.safeParse({ status: "MENUNGGU" }).success).toBe(true);
    expect(listSchema.safeParse({ status: "SEMUA" }).success).toBe(true);
    expect(listSchema.safeParse({ status: "PENDING" }).success).toBe(false);
    const out = serialize(await list.handler(listSchema.parse({ store: "MLT", limit: 20, offset: 0 }), ctx)) as {
      items: Record<string, unknown>[];
    };
    expect(m.resolveStore).toHaveBeenCalledWith("MLT");
    expect(m.daftarReturPembeliKantor).toHaveBeenCalledWith({
      status: "MENUNGGU",
      storeId: "s1",
      cari: "",
      halaman: 1,
      ukuran: 20,
    });
    expect(out.items[0]).toMatchObject({
      id: "r-1",
      docNo: "NT-001",
      store: { id: "s1", name: "Toko Melati" },
      spg: { name: "Sari" },
      status: "MENUNGGU",
      items: 2,
      refundMethod: "MENUNGGU_BELUM",
      url: "https://e.test/backoffice/retur-spg/r-1",
    });
  });

  it("parity pageCode", () => {
    expect(parityCases).toContainEqual({
      tool: "list_spg_buyer_returns",
      kind: "pageCode",
      pageFile: "apps/web/app/backoffice/retur-spg/page.tsx",
      codes: ["spg_sales:view"],
    });
  });
});

describe("approve / reject spg buyer return", () => {
  it("__sampleInput and writeAction parity", () => {
    expect(__sampleInput).toEqual({
      approve_spg_buyer_return: { returnId: "r-1" },
      reject_spg_buyer_return: { returnId: "r-1", reason: "x" },
    });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "approve_spg_buyer_return",
          kind: "writeAction",
          args: [{ returnId: "r-1" }],
        }),
        expect.objectContaining({
          tool: "reject_spg_buyer_return",
          kind: "writeAction",
          args: [{ returnId: "r-1", alasan: "x" }],
        }),
      ]),
    );
  });

  it("prepare approve preview; revalidate includes spgSaleId paths; writer not called", async () => {
    const prepared = await approve.prepare(approveSchema.parse({ returnId: "r-1" }), writeCtx);
    expect(m.setujuiReturPembeli).not.toHaveBeenCalled();
    expect(prepared.args).toEqual({ returnId: "r-1", spgSaleId: "sale-1" });
    expect(prepared.preview.title).toBe("Setujui retur NT-001");
    expect(prepared.preview.details.find((d) => d.label === "Barang")?.value).toBe("KAOS-01 × 2");
    expect(prepared.preview.details.find((d) => d.label === "Uang")?.value).toBe("MENUNGGU_BELUM");
    expect(approve.revalidate(prepared.args, { ok: true, message: "", url: "", entityType: "", entityId: "" })).toEqual(
      expect.arrayContaining([
        "/backoffice/retur-spg",
        "/backoffice/retur-spg/r-1",
        "/backoffice/spg-sales/sale-1",
        "/pwa/spg/sale-1/nota",
      ]),
    );
  });

  it("wrong status / missing / self → prepare refuses", async () => {
    m.rincianReturPembeliKantor.mockResolvedValue(detail({ status: "DISETUJUI" }));
    await expect(approve.prepare(approveSchema.parse({ returnId: "r-1" }), writeCtx)).rejects.toEqual(
      new ViraInputError("Retur berstatus DISETUJUI, tidak bisa diputuskan."),
    );
    m.rincianReturPembeliKantor.mockResolvedValue(null);
    await expect(approve.prepare(approveSchema.parse({ returnId: "x" }), writeCtx)).rejects.toEqual(
      new ViraNotFoundError("Retur tidak ditemukan"),
    );
    m.rincianReturPembeliKantor.mockResolvedValue(detail({ pelapor: { id: "u-admin", nama: "Admin" } }));
    await expect(approve.prepare(approveSchema.parse({ returnId: "r-1" }), writeCtx)).rejects.toEqual(
      new ViraInputError("Anda tidak bisa memutuskan laporan yang Anda buat sendiri."),
    );
  });

  it("execute approve never passes spgSaleId to the writer", async () => {
    m.rincianReturPembeliKantor.mockResolvedValue(detail({ status: "DISETUJUI" }));
    const res = await approve.execute({ returnId: "r-1", spgSaleId: "sale-1" }, writeCtx);
    expect(m.setujuiReturPembeli).toHaveBeenCalledWith({ returnId: "r-1", olehUserId: "u-admin" });
    const call = m.setujuiReturPembeli.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("spgSaleId");
    expect(res).toMatchObject({ ok: true, message: "Retur NT-001 disetujui.", entityType: "SpgBuyerReturn" });
  });

  it("execute reject maps alasan and never passes spgSaleId", async () => {
    const res = await reject.execute({ returnId: "r-1", spgSaleId: "sale-1", reason: "tidak cocok" }, writeCtx);
    expect(m.tolakReturPembeli).toHaveBeenCalledWith({
      returnId: "r-1",
      olehUserId: "u-admin",
      alasan: "tidak cocok",
      uangTernyataDikembalikan: false,
      alasanUangKembali: null,
      besarBeban: null,
      alasanBesarBeban: null,
    });
    const call = m.tolakReturPembeli.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("spgSaleId");
    expect(res).toMatchObject({ ok: true, message: "Retur NT-001 ditolak." });

    m.tolakReturPembeli.mockResolvedValueOnce({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect(await reject.execute({ returnId: "r-1", spgSaleId: "sale-1", reason: "x" }, writeCtx)).toEqual({
      ok: false,
      code: "SUDAH_DIPUTUSKAN",
      message: "Laporan ini sudah diputuskan atau ditarik. Muat ulang halaman.",
      url: "https://e.test/backoffice/retur-spg/r-1",
    });
  });

  it("reject reason blank fails schema", () => {
    expect(rejectSchema.safeParse({ returnId: "r-1", reason: "  " }).success).toBe(false);
  });

  it("reject prepare surfaces SPG beban when uang already returned", async () => {
    m.rincianReturPembeliKantor.mockResolvedValue(
      detail({
        uang: { keadaan: "MENUNGGU_SUDAH", pada: new Date("2026-11-10T03:00:00Z"), olehKantor: null },
        bebanJikaDitolak: 50_000,
      }),
    );
    const prepared = await reject.prepare(
      rejectSchema.parse({ returnId: "r-1", reason: "tidak cocok" }),
      writeCtx,
    );
    expect(prepared.preview.details.find((d) => d.label === "Beban SPG jika ditolak")?.value).toBe(
      "Rp 50.000",
    );
    expect(prepared.preview.summary).toContain("beban");
  });
});
