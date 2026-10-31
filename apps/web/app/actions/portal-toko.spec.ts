import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: sesi, Prisma, dan modul portal ditirukan. Yang dipasak di sini
 * adalah PENJAGA aksi — siapa boleh memanggil apa — bukan aturan tautan atau
 * penulis pesanan (itu diuji terhadap basis data di lib/field-sales).
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  storeFind: vi.fn(),
  linkFind: vi.fn(),
  buka: vi.fn(),
  buat: vi.fn(),
  cabut: vi.fn(),
  daftar: vi.fn(),
  aturan: vi.fn(),
  kirim: vi.fn(),
  pratinjau: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({
  prisma: { store: { findUnique: h.storeFind }, storePortalLink: { findUnique: h.linkFind } },
}));
vi.mock("@/lib/field-sales/portal-toko", () => ({
  bukaTautanPortal: h.buka,
  buatTautanPortal: h.buat,
  cabutTautanPortal: h.cabut,
  daftarTautanPortal: h.daftar,
  muatAturanPortalToko: h.aturan,
}));
vi.mock("@/lib/field-sales/portal-writer", async () => {
  const { z } = await import("zod");
  return {
    kirimPesananPortal: h.kirim,
    pratinjauPortal: h.pratinjau,
    skemaBarisPortal: z.array(z.object({ itemId: z.string(), variantSku: z.string(), qty: z.number().int().min(1) })).min(1),
  };
});

import { MAKS_PERIKSA_PORTAL_PER_MENIT, pembatasPeriksaPortal } from "@/lib/field-sales/portal-toko-batas";
import {
  buatTautanPortalAksi,
  cabutTautanPortalAksi,
  daftarTautanPortalAksi,
  kirimPesananPortalAksi,
  pratinjauPesananPortalAksi,
} from "./portal-toko";

const TOKEN = "a".repeat(43);
const akses = { linkId: "l1", toko: { id: "toko-dari-tautan", name: "T", termsType: "PUTUS", salesmanId: "s1", namaSalesman: "S" }, aturan: {} };
const sesi = (id: string, permissions: string[]) => ({ user: { id, permissions } });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  pembatasPeriksaPortal.kosongkan();
  h.storeFind.mockResolvedValue({ id: "t1", salesmanId: "s1", isActive: true });
  h.aturan.mockResolvedValue({ aktif: true, masaBerlakuHari: 90, maksPesananPerHari: 5 });
  h.daftar.mockResolvedValue([]);
  h.buat.mockResolvedValue({ ok: true, token: "TOKEN-MENTAH", linkId: "l9", expiresAt: new Date("2026-12-30T00:00:00Z") });
  h.cabut.mockResolvedValue({ ok: true, sudahDicabut: false });
});

describe("aksi publik — token dibuka ulang di setiap panggilan", () => {
  it("a dead link gets one code and never reaches the writer", async () => {
    h.buka.mockResolvedValue({ ok: false, code: "DICABUT" });
    expect(await kirimPesananPortalAksi(TOKEN, { lines: [] })).toEqual({ ok: false, code: "TAUTAN_TIDAK_BERLAKU" });
    expect(await pratinjauPesananPortalAksi(TOKEN, [])).toEqual({ ok: false, code: "TAUTAN_TIDAK_BERLAKU" });
    expect(h.kirim).not.toHaveBeenCalled();
    expect(h.pratinjau).not.toHaveBeenCalled();
  });

  it("needs no session, and passes the link's own access — not anything from the payload", async () => {
    h.buka.mockResolvedValue({ ok: true, akses });
    h.kirim.mockResolvedValue({ ok: true, jenis: "PUTUS", orderNo: "PUTUS/1", total: 1, ulang: false });
    const input = { storeId: "toko-lain", lines: [{ itemId: "i", variantSku: "", qty: 1 }], idempotencyKey: "kunci-123" };
    await kirimPesananPortalAksi(TOKEN, input);
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.buka).toHaveBeenCalledWith(TOKEN);
    expect(h.kirim).toHaveBeenCalledWith(akses, input);
  });

  it("preview validates the lines before computing anything", async () => {
    h.buka.mockResolvedValue({ ok: true, akses });
    expect(await pratinjauPesananPortalAksi(TOKEN, [{ itemId: "i", variantSku: "", qty: 0 }])).toEqual({ ok: false, code: "TIDAK_SAH" });
    expect(h.pratinjau).not.toHaveBeenCalled();
  });

  it("pratinjau dan kiriman dibatasi per tautan per menit — penebak stok tidak bisa mencoba tanpa henti", async () => {
    h.buka.mockResolvedValue({ ok: true, akses });
    h.pratinjau.mockResolvedValue({ ok: true, jenis: "KONSI" });
    h.kirim.mockResolvedValue({ ok: false, code: "BARIS", masalah: { code: "STOK_KURANG", nama: [], barang: [] } });
    const baris = [{ itemId: "i", variantSku: "", qty: 1 }];
    for (let i = 0; i < MAKS_PERIKSA_PORTAL_PER_MENIT - 1; i++) await pratinjauPesananPortalAksi(TOKEN, baris);
    // Jatahnya bersama: kiriman ikut dihitung (penolakan stok kurang juga bisa dipakai menebak).
    await kirimPesananPortalAksi(TOKEN, { lines: baris, idempotencyKey: "kunci-123" });
    expect(await pratinjauPesananPortalAksi(TOKEN, baris)).toEqual({ ok: false, code: "TERLALU_SERING" });
    expect(await kirimPesananPortalAksi(TOKEN, { lines: baris, idempotencyKey: "kunci-456" })).toEqual({ ok: false, code: "TERLALU_SERING" });
    expect(h.pratinjau).toHaveBeenCalledTimes(MAKS_PERIKSA_PORTAL_PER_MENIT - 1);
    expect(h.kirim).toHaveBeenCalledTimes(1);
    // Tautan lain punya jatahnya sendiri.
    h.buka.mockResolvedValue({ ok: true, akses: { ...akses, linkId: "l2" } });
    expect(await pratinjauPesananPortalAksi(TOKEN, baris)).toEqual({ ok: true, jenis: "KONSI" });
  });

  it("tautan mati tidak memakan jatah siapa pun", async () => {
    h.buka.mockResolvedValue({ ok: false, code: "DICABUT" });
    for (let i = 0; i < MAKS_PERIKSA_PORTAL_PER_MENIT + 5; i++) await pratinjauPesananPortalAksi(TOKEN, []);
    expect(pembatasPeriksaPortal.ukuran()).toBe(0);
  });
});

describe("aksi pengelola tautan", () => {
  it("no session → UNAUTHORIZED, nothing looked up", async () => {
    h.auth.mockResolvedValue(null);
    expect(await buatTautanPortalAksi({ storeId: "t1" })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await daftarTautanPortalAksi("t1")).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await cabutTautanPortalAksi("l1")).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(h.storeFind).not.toHaveBeenCalled();
    expect(h.linkFind).not.toHaveBeenCalled();
    expect(h.buat).not.toHaveBeenCalled();
  });

  it("a salesperson who does not hold the store is refused", async () => {
    h.auth.mockResolvedValue(sesi("s2", ["pwa:access"]));
    expect(await buatTautanPortalAksi({ storeId: "t1" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await daftarTautanPortalAksi("t1")).toEqual({ ok: false, code: "FORBIDDEN" });
    h.linkFind.mockResolvedValue({ storeId: "t1" });
    expect(await cabutTautanPortalAksi("l1")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.buat).not.toHaveBeenCalled();
    expect(h.cabut).not.toHaveBeenCalled();
  });

  it("holding the store without pwa:access is not enough", async () => {
    h.auth.mockResolvedValue(sesi("s1", ["stores:view"]));
    expect(await buatTautanPortalAksi({ storeId: "t1" })).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("the holder may create from the phone; the raw token comes back once, created by the session user", async () => {
    h.auth.mockResolvedValue(sesi("s1", ["pwa:access"]));
    const r = await buatTautanPortalAksi({ storeId: "t1", label: "Bu Ani", hari: "30" });
    expect(r).toMatchObject({ ok: true, token: "TOKEN-MENTAH" });
    expect(h.buat).toHaveBeenCalledWith({ storeId: "t1", createdById: "s1", label: "Bu Ani", hari: 30 });
  });

  it("stores:manage may manage any store; a non-integer expiry is refused", async () => {
    h.auth.mockResolvedValue(sesi("kantor", ["stores:manage"]));
    h.storeFind.mockResolvedValue({ id: "t1", salesmanId: "s1", isActive: true });
    expect(await buatTautanPortalAksi({ storeId: "t1", hari: 2.5 })).toEqual({ ok: false, code: "TIDAK_SAH" });
    expect((await buatTautanPortalAksi({ storeId: "t1" })).ok).toBe(true);
    expect(h.buat).toHaveBeenLastCalledWith({ storeId: "t1", createdById: "kantor", label: null, hari: null });
  });

  it("revoke is judged on the LINK's store, not on anything the browser sends", async () => {
    h.auth.mockResolvedValue(sesi("s1", ["pwa:access"]));
    h.linkFind.mockResolvedValue({ storeId: "t-lain" });
    h.storeFind.mockResolvedValue({ id: "t-lain", salesmanId: "s9", isActive: true });
    expect(await cabutTautanPortalAksi("l1")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.storeFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-lain" } }));
  });

  it("the list never carries a token", async () => {
    h.auth.mockResolvedValue(sesi("s1", ["pwa:access"]));
    h.daftar.mockResolvedValue([
      { id: "l1", label: null, keadaan: "AKTIF", createdAt: new Date(), expiresAt: null, revokedAt: null, lastUsedAt: null, pembuat: "S" },
    ]);
    const r = await daftarTautanPortalAksi("t1");
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/token/i);
  });
});
