import { describe, expect, it } from "vitest";
import { alamatPerforma, bacaParamPerforma, polaCari, RUTE_PERFORMA, statusVideo, type ParamPerforma } from "./performa";

/*
 * Kreatif → Performa video: alamat halaman (saringan & urutan tinggal di URL,
 * supaya tautannya bisa dibagikan), pola cari yang aman untuk LIKE, dan status
 * per video dari tugas pantaunya.
 */

const BAWAAN: ParamPerforma = { cari: "", jenis: "semua", dari: null, sampai: null, urut: "views", halaman: 1 };

describe("bacaParamPerforma / alamatPerforma", () => {
  it("alamat kosong = bawaan: semua orang, views terbanyak, halaman 1", () => {
    expect(bacaParamPerforma({})).toEqual(BAWAAN);
    expect(alamatPerforma(BAWAAN)).toBe(RUTE_PERFORMA);
  });

  it("membaca dan menulis setiap saringan; nilai bawaan tidak ditulis", () => {
    const p = bacaParamPerforma({ cari: "  lystia ", jenis: "afiliasi", dari: "2026-09-01", sampai: "2026-09-30", urut: "er", halaman: "3" });
    expect(p).toEqual({ cari: "lystia", jenis: "afiliasi", dari: "2026-09-01", sampai: "2026-09-30", urut: "er", halaman: 3 });
    expect(alamatPerforma(p)).toBe(`${RUTE_PERFORMA}?cari=lystia&jenis=afiliasi&dari=2026-09-01&sampai=2026-09-30&urut=er&halaman=3`);
    expect(bacaParamPerforma(Object.fromEntries(new URL(`http://x${alamatPerforma(p)}`).searchParams))).toEqual(p);
  });

  it("nilai yang salah jatuh ke bawaan; rentang terbalik dirapikan", () => {
    expect(bacaParamPerforma({ jenis: "x", urut: "acak", halaman: "-2", dari: "2026-13-01", cari: "a".repeat(300) })).toEqual({
      ...BAWAAN,
      cari: "a".repeat(100),
    });
    expect(bacaParamPerforma({ dari: "2026-09-30", sampai: "2026-09-01" })).toMatchObject({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(bacaParamPerforma({ sampai: "2026-09-30" })).toMatchObject({ dari: null, sampai: "2026-09-30" });
  });
});

describe("polaCari", () => {
  it("huruf kecil, dibungkus %, tanda %, _ dan \\ dilepas dari arti LIKE-nya", () => {
    expect(polaCari("  Lystia ")).toBe("%lystia%");
    expect(polaCari("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(polaCari("   ")).toBeNull();
  });
});

describe("statusVideo", () => {
  const jam = (n: number) => new Date(Date.UTC(2003, 2, 10, n));

  it("tugas yang masih antre atau sedang dicek → menunggu cek", () => {
    expect(statusVideo({ tugas: [{ status: "ANTRE", galatTerakhir: null, selesaiAt: null }], dicekAt: jam(1) })).toEqual({ status: "MENUNGGU", alasan: null });
    expect(statusVideo({ tugas: [{ status: "DIPINJAM", galatTerakhir: null, selesaiAt: null }], dicekAt: null }).status).toBe("MENUNGGU");
  });

  it("cek terakhir gagal sesudah bacaan terakhir → gagal, dengan alasannya", () => {
    const r = statusVideo({
      tugas: [
        { status: "SELESAI", galatTerakhir: null, selesaiAt: jam(1) },
        { status: "GAGAL", galatTerakhir: "TIDAK_DITEMUKAN", selesaiAt: jam(5) },
      ],
      dicekAt: jam(1),
    });
    expect(r).toEqual({ status: "GAGAL", alasan: "TIDAK_DITEMUKAN" });
  });

  it("bacaan sesudah kegagalan → terbaca; tanpa tugas tapi ada angka (diisi tangan) → terbaca", () => {
    expect(statusVideo({ tugas: [{ status: "GAGAL", galatTerakhir: "GAGAL_MUAT", selesaiAt: jam(1) }], dicekAt: jam(2) }).status).toBe("TERBACA");
    expect(statusVideo({ tugas: [], dicekAt: jam(2) }).status).toBe("TERBACA");
  });

  it("tanpa tugas dan tanpa angka → belum dicek; tugas yang dilewati diabaikan", () => {
    expect(statusVideo({ tugas: [], dicekAt: null })).toEqual({ status: "BELUM", alasan: null });
    expect(statusVideo({ tugas: [{ status: "DILEWATI", galatTerakhir: "TITIK_BARU", selesaiAt: jam(1) }], dicekAt: null }).status).toBe("BELUM");
    expect(statusVideo({ tugas: [{ status: "GAGAL", galatTerakhir: null, selesaiAt: jam(1) }], dicekAt: null })).toEqual({ status: "GAGAL", alasan: null });
  });
});
