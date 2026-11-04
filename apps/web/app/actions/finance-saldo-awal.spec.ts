import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi Saldo awal & templat bagan akun — tanpa basis data: sesi dan
 * penulis ditiru. Yang dijaga: izin per aksi, aktor dari sesi (bukan isian),
 * dan isian klien TIDAK bisa membawa `uji` (ruang nama & tanggal tes) ke penulis.
 */

const sesi = vi.hoisted(() => ({ id: "user-1", izin: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.id ? { user: { id: sesi.id, permissions: sesi.izin } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const penulis = vi.hoisted(() => ({
  postingSaldoAwal: vi.fn(async () => ({ ok: true, importId: "imp", journalId: "j", jurnalBalikId: null, ekuitas: 0 })),
  simpanDrafSaldoAwal: vi.fn(async () => ({ ok: true, importId: "imp" })),
  hapusDrafSaldoAwal: vi.fn(async () => ({ ok: true, dihapus: 1 })),
}));
vi.mock("@/lib/finance/saldo-awal/writer", () => penulis);
const templat = vi.hoisted(() => ({
  pasangTemplatAkun: vi.fn(async () => ({ rencana: { akunBaru: [], pemetaanBaru: [], akunSudahAda: 0, peranSudahDipetakan: [], konflik: [] }, akunDibuat: 3, peranDipetakan: 2 })),
  pratinjauTemplatAkun: vi.fn(async () => ({ akunBaru: [], pemetaanBaru: [], akunSudahAda: 0, peranSudahDipetakan: [], konflik: [] })),
}));
vi.mock("@/lib/finance/templat-akun/pasang", () => templat);
vi.mock("@/lib/finance/saldo-awal/hitung-queries", () => ({ bacaStokSaldoAwal: vi.fn(async () => []) }));

import {
  hapusDrafSaldoAwalAction,
  pasangTemplatAkunAction,
  postingSaldoAwalAction,
  pratinjauPersediaanAwalAction,
  pratinjauTemplatAkunAction,
  simpanDrafSaldoAwalAction,
} from "./finance-saldo-awal";

beforeEach(() => {
  sesi.id = "user-1";
  sesi.izin = [];
  vi.clearAllMocks();
});

describe("aksi saldo awal", () => {
  it("tanpa journals:manage → TANPA_AKSES, penulis tidak dipanggil", async () => {
    sesi.izin = ["journals:view"];
    expect(await postingSaldoAwalAction({ jenis: "ACCOUNTS", baris: [] })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await simpanDrafSaldoAwalAction({ jenis: "ACCOUNTS", baris: [] })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await hapusDrafSaldoAwalAction({ jenis: "ACCOUNTS" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await pratinjauPersediaanAwalAction({ berkas: [] })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis.postingSaldoAwal).not.toHaveBeenCalled();
  });

  it("tanpa sesi → TANPA_AKSES", async () => {
    sesi.id = "";
    expect(await postingSaldoAwalAction({ jenis: "ACCOUNTS", baris: [] })).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });

  it("aktor dari sesi; `uji` dan isian lain dari klien dibuang sebelum sampai ke penulis", async () => {
    sesi.izin = ["journals:manage"];
    const isian = {
      jenis: "ACCOUNTS",
      baris: [{ akunId: "a", debit: 1, kredit: 0 }],
      catatan: "c",
      olehUserId: "penyusup",
      uji: { ruang: "x", tanggalMulai: new Date("2001-01-01") },
    } as unknown as Parameters<typeof postingSaldoAwalAction>[0];
    expect(await postingSaldoAwalAction(isian)).toEqual({ ok: true, journalId: "j" });
    expect(penulis.postingSaldoAwal).toHaveBeenCalledWith({
      jenis: "ACCOUNTS",
      baris: [{ akunId: "a", debit: 1, kredit: 0 }],
      catatan: "c",
      namaBerkas: null,
      olehUserId: "user-1",
    });
    await simpanDrafSaldoAwalAction(isian);
    expect(penulis.simpanDrafSaldoAwal).toHaveBeenCalledWith(expect.not.objectContaining({ uji: expect.anything() }));
  });

  it("jenis yang tidak dikenal ditolak", async () => {
    sesi.izin = ["journals:manage"];
    expect(await postingSaldoAwalAction({ jenis: "LAIN" as never, baris: [] })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
  });

  it("pratinjau persediaan menolak HPP yang tidak sah", async () => {
    sesi.izin = ["journals:manage"];
    expect(await pratinjauPersediaanAwalAction({ berkas: [{ baris: 2, sku: "A", hpp: -1 }] })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
  });
});

describe("aksi templat bagan akun", () => {
  it("butuh coa:manage DAN journals:manage", async () => {
    sesi.izin = ["coa:manage"];
    expect(await pasangTemplatAkunAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await pratinjauTemplatAkunAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.izin = ["journals:manage"];
    expect(await pasangTemplatAkunAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(templat.pasangTemplatAkun).not.toHaveBeenCalled();
    sesi.izin = ["coa:manage", "journals:manage"];
    expect(await pasangTemplatAkunAction()).toEqual({ ok: true, akunDibuat: 3, peranDipetakan: 2, konflik: 0 });
    expect(templat.pasangTemplatAkun).toHaveBeenCalledWith({ olehUserId: "user-1" });
  });
});
