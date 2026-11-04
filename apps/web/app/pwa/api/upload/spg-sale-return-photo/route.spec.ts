import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: { spgSaleReturn: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({ isConfigured: vi.fn(), uploadToR2: vi.fn() }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(), spgBerhentiPada: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { isConfigured, uploadToR2 } from "@/lib/r2";
import { ambilTokoTetap, spgBerhentiPada } from "@/lib/pwa/peran";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockToko = ambilTokoTetap as unknown as ReturnType<typeof vi.fn>;
const mockBerhenti = spgBerhentiPada as unknown as ReturnType<typeof vi.fn>;
const mockFind = prisma.spgSaleReturn.findUnique as unknown as ReturnType<typeof vi.fn>;

const USER = "spg1";
const TOKO = "toko1";
const KUNCI = "local-1730000000000-abc";

function permintaan(isi: { jenis?: string; kunci?: string; returnId?: string; file?: File | null }): Request {
  const fd = new FormData();
  if (isi.file !== null) fd.set("file", isi.file ?? new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
  if (isi.jenis !== undefined) fd.set("jenis", isi.jenis);
  if (isi.kunci !== undefined) fd.set("kunci", isi.kunci);
  if (isi.returnId !== undefined) fd.set("returnId", isi.returnId);
  return new Request("http://localhost/pwa/api/upload/spg-sale-return-photo", { method: "POST", body: fd });
}

const kirim = async (isi: Parameters<typeof permintaan>[0]) => {
  const res = await POST(permintaan(isi) as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER, permissions: ["spg_sales:record"] } });
  mockToko.mockResolvedValue(TOKO);
  mockBerhenti.mockResolvedValue(null);
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockFind.mockResolvedValue(null);
});

describe("POST /pwa/api/upload/spg-sale-return-photo — akses", () => {
  it("401 tanpa sesi, 403 tanpa izin atau tanpa toko tetap (dan tidak berhenti), 503 tanpa R2", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await kirim({ jenis: "barang", kunci: KUNCI })).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: USER, permissions: [] } });
    expect((await kirim({ jenis: "barang", kunci: KUNCI })).status).toBe(403);
    mockToko.mockResolvedValueOnce(null);
    expect((await kirim({ jenis: "barang", kunci: KUNCI })).status).toBe(403);
    mockIsConfigured.mockReturnValueOnce(false);
    expect((await kirim({ jenis: "barang", kunci: KUNCI })).status).toBe(503);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("SPG yang sudah berhenti: toko yang dilepasnya (dari server), di kedua cara", async () => {
    mockToko.mockResolvedValue(null);
    mockBerhenti.mockResolvedValue({ hariTerakhir: "2026-11-01", storeId: "toko-lepas" });
    const lapor = await kirim({ jenis: "barang", kunci: KUNCI });
    expect(lapor.body.key).toBe(`spg-sale-returns/toko-lepas/${KUNCI}/barang.jpg`);

    mockFind.mockResolvedValue({
      createdById: USER,
      storeId: "toko-lepas",
      status: "DISETUJUI",
      idempotencyKey: KUNCI,
      refundedAt: null,
      refundSlipR2Key: null,
      refundMarkedById: null,
    });
    const uang = await kirim({ jenis: "struk", returnId: "r1" });
    expect(uang.body.key).toBe(`spg-sale-returns/toko-lepas/${KUNCI}/struk.jpg`);
    // Laporan di toko lain tetap 404, juga untuk SPG yang berhenti.
    mockFind.mockResolvedValue({ createdById: USER, storeId: TOKO, status: "DISETUJUI", idempotencyKey: KUNCI, refundedAt: null, refundSlipR2Key: null, refundMarkedById: null });
    expect((await kirim({ jenis: "struk", returnId: "r1" })).status).toBe(404);
  });

  it.each([
    [{ jenis: "nota", kunci: KUNCI }],
    [{ jenis: "barang" }],
    [{ jenis: "barang", kunci: KUNCI, returnId: "r1" }],
    [{ jenis: "barang", kunci: "a/../b" }],
    [{ jenis: "barang", returnId: "r1" }],
  ])("400 untuk isian %j sebelum basis data atau R2", async (isi) => {
    const r = await kirim(isi);
    expect(r.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("400 untuk jenis berkas yang tidak diizinkan dan tanpa berkas", async () => {
    expect((await kirim({ jenis: "barang", kunci: KUNCI, file: new File(["x"], "a.gif", { type: "image/gif" }) })).body.error).toBe("JENIS_TIDAK_DIIZINKAN");
    expect((await kirim({ jenis: "barang", kunci: KUNCI, file: null })).body.error).toBe("FILE_WAJIB");
  });
});

describe("mode kunci (sebelum laporannya ada)", () => {
  it("menulis ke folder toko tetap (dari server) + kunci laporan, bernama jenisnya", async () => {
    const r = await kirim({ jenis: "barang", kunci: KUNCI });
    expect(r.status).toBe(200);
    expect(r.body.key).toBe(`spg-sale-returns/${TOKO}/${KUNCI}/barang.jpg`);
    expect(mockUpload).toHaveBeenCalledWith(`spg-sale-returns/${TOKO}/${KUNCI}/barang.jpg`, expect.anything(), "image/jpeg");
  });

  it("laporan sendiri yang sudah menyimpan foto itu: kunci tersimpan, tanpa menulis", async () => {
    mockFind.mockResolvedValue({ createdById: USER, storeId: TOKO, goodsPhotoR2Key: "spg-sale-returns/toko1/k/barang.jpg", refundSlipR2Key: null });
    const r = await kirim({ jenis: "barang", kunci: KUNCI });
    expect(r).toEqual({ status: 200, body: { key: "spg-sale-returns/toko1/k/barang.jpg" } });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("kunci milik orang lain, atau tanpa foto jenis itu: 409", async () => {
    mockFind.mockResolvedValue({ createdById: "lain", storeId: TOKO, goodsPhotoR2Key: "x", refundSlipR2Key: null });
    expect((await kirim({ jenis: "barang", kunci: KUNCI })).status).toBe(409);
    mockFind.mockResolvedValue({ createdById: USER, storeId: TOKO, goodsPhotoR2Key: "x", refundSlipR2Key: null });
    expect((await kirim({ jenis: "struk", kunci: KUNCI })).status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe("mode returnId (langkah uang dikembalikan)", () => {
  const laporan = (o: Record<string, unknown> = {}) => ({
    createdById: USER,
    storeId: TOKO,
    status: "DISETUJUI",
    idempotencyKey: KUNCI,
    refundedAt: null,
    refundSlipR2Key: null,
    refundMarkedById: null,
    ...o,
  });

  // DITOLAK: uangnya menjadi beban SPG; DIBATALKAN: laporannya dibuka lagi atau kantor diberi tahu
  // dengan foto struknya — penulisnya yang memutuskan, jadi fotonya harus bisa naik dulu.
  it.each(["MENUNGGU", "DISETUJUI", "DITOLAK", "DIBATALKAN"])("menulis struk untuk laporan %s yang uangnya belum tercatat", async (status) => {
    mockFind.mockResolvedValue(laporan({ status }));
    const r = await kirim({ jenis: "struk", returnId: "r1" });
    expect(r.status).toBe(200);
    expect(r.body.key).toBe(`spg-sale-returns/${TOKO}/${KUNCI}/struk.jpg`);
    expect(mockUpload).toHaveBeenCalledWith(`spg-sale-returns/${TOKO}/${KUNCI}/struk.jpg`, expect.anything(), "image/jpeg");
  });

  it("ditolak dengan tanda kantor (P78): struk belum ada → tulis; sudah ada → kunci tersimpan tanpa menulis", async () => {
    mockFind.mockResolvedValue(laporan({ status: "DITOLAK", refundMarkedById: "kantor" }));
    expect((await kirim({ jenis: "struk", returnId: "r1" })).body.key).toBe(`spg-sale-returns/${TOKO}/${KUNCI}/struk.jpg`);
    expect(mockUpload).toHaveBeenCalledTimes(1);

    mockUpload.mockClear();
    mockFind.mockResolvedValue(laporan({ status: "DITOLAK", refundMarkedById: "kantor", refundSlipR2Key: "spg-sale-returns/toko1/k/struk.jpg" }));
    expect(await kirim({ jenis: "struk", returnId: "r1" })).toEqual({ status: 200, body: { key: "spg-sale-returns/toko1/k/struk.jpg" } });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("laporan orang lain, toko lain, atau tidak ada: 404 yang sama", async () => {
    mockFind.mockResolvedValue(laporan({ createdById: "lain" }));
    expect((await kirim({ jenis: "struk", returnId: "r1" })).status).toBe(404);
    mockFind.mockResolvedValue(laporan({ storeId: "toko2" }));
    expect((await kirim({ jenis: "struk", returnId: "r1" })).status).toBe(404);
    mockFind.mockResolvedValue(null);
    expect((await kirim({ jenis: "struk", returnId: "r1" })).status).toBe(404);
  });

  it("uang sudah tercatat: kunci struk tersimpan; tanpa struk tersimpan: 409", async () => {
    mockFind.mockResolvedValue(laporan({ refundedAt: new Date(), refundSlipR2Key: "spg-sale-returns/toko1/k/struk.jpg" }));
    expect((await kirim({ jenis: "struk", returnId: "r1" })).body).toEqual({ key: "spg-sale-returns/toko1/k/struk.jpg" });
    mockFind.mockResolvedValue(laporan({ refundedAt: new Date(), refundSlipR2Key: null }));
    expect((await kirim({ jenis: "struk", returnId: "r1" })).status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("bertanda kantor tetapi tidak DITOLAK (mis. penolakannya dibatalkan, P82): 409, sama dengan penulisnya (SUDAH_DICATAT)", async () => {
    for (const status of ["DISETUJUI", "MENUNGGU", "DIBATALKAN"]) {
      mockFind.mockResolvedValue(laporan({ status, refundMarkedById: "kantor" }));
      expect((await kirim({ jenis: "struk", returnId: "r1" })).status, status).toBe(409);
      mockFind.mockResolvedValue(laporan({ status, refundMarkedById: "kantor", refundSlipR2Key: "spg-sale-returns/toko1/k/struk.jpg" }));
      expect((await kirim({ jenis: "struk", returnId: "r1" })).status, `${status} + struk`).toBe(409);
    }
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
