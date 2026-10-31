import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi posting penyusutan (uji akuntansi gelombang 2, R4): penyusutan bulan
 * berjalan tidak boleh diposting sebelum bulannya berakhir (WIB) — bulan
 * itu baru selesai di hari terakhirnya, dan pelepasan aset di sisa bulan itu
 * membuat penyusutannya salah. Cron sudah memposting bulan lalu. Penulisnya
 * dipalsukan.
 */

const sesi = vi.hoisted(() => ({ permissions: ["journals:manage"] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "aktor", permissions: sesi.permissions } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const panggil = vi.hoisted(() => ({ daftar: [] as unknown[] }));
vi.mock("@/lib/finance/aset/penyusutan", () => ({
  postingPenyusutan: vi.fn(async (isi: unknown) => {
    panggil.daftar.push(isi);
    return { sampai: "x", diposting: 0, totalNilai: 0, nol: 0, periodeDitutup: 0, gagal: [] };
  }),
}));
vi.mock("@/lib/finance/aset/writer", () => ({}));

const aksi = await import("./finance-aset");

beforeEach(() => {
  panggil.daftar = [];
  sesi.permissions = ["journals:manage"];
  // 8 Oktober 2026, 10:00 WIB.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("postingPenyusutanAction", () => {
  it("bulan berjalan ditolak BULAN_BELUM_BERAKHIR; bulan depan BULAN_TIDAK_SAH; penulis tidak dipanggil", async () => {
    expect(await aksi.postingPenyusutanAction({ bulan: "2026-10" })).toEqual({ ok: false, kode: "BULAN_BELUM_BERAKHIR" });
    expect(await aksi.postingPenyusutanAction({ bulan: "2026-11" })).toEqual({ ok: false, kode: "BULAN_TIDAK_SAH" });
    expect(panggil.daftar).toEqual([]);
  });

  it("hari terakhir bulan pun belum berakhir; sesudah tengah malam WIB boleh", async () => {
    vi.setSystemTime(new Date("2026-10-31T16:59:00.000Z")); // 31 Okt 23:59 WIB
    expect(await aksi.postingPenyusutanAction({ bulan: "2026-10" })).toEqual({ ok: false, kode: "BULAN_BELUM_BERAKHIR" });
    vi.setSystemTime(new Date("2026-10-31T17:00:00.000Z")); // 1 Nov 00:00 WIB
    expect(await aksi.postingPenyusutanAction({ bulan: "2026-10" })).toMatchObject({ ok: true });
    expect(panggil.daftar).toEqual([{ sampai: { tahun: 2026, bulan: 10 }, olehUserId: "aktor" }]);
  });

  it("bulan lalu diposting", async () => {
    expect(await aksi.postingPenyusutanAction({ bulan: "2026-09", asetIds: ["a1"] })).toMatchObject({ ok: true });
    expect(panggil.daftar).toEqual([{ sampai: { tahun: 2026, bulan: 9 }, olehUserId: "aktor", asetIds: ["a1"] }]);
  });
});
