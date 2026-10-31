import { describe, expect, it } from "vitest";
import {
  BATAS_NILAI_BIAYA,
  bacaBulan,
  bolehMelihatBiaya,
  bolehMembayarBiaya,
  bolehMengajukanBiaya,
  bolehMenyetujuiBiaya,
  labelBulan,
  bacaPengaturanBiaya,
  daftarBulanTerakhir,
  periksaBiaya,
  periksaPengaturanBiaya,
  periksaPindahBiaya,
  PENGATURAN_BIAYA_BAWAAN,
  rentangBulanWib,
  ringkasPerStatus,
  urlFotoSah,
  type IsiBiaya,
  type PengaturanBiaya,
} from "./biaya";

// 30 Sep 2026 10.00 WIB.
const SEKARANG = new Date("2026-09-30T03:00:00Z");
const atur = (x: Partial<PengaturanBiaya> = {}): PengaturanBiaya => ({ ...PENGATURAN_BIAYA_BAWAAN, ...x });
const isi = (x: Partial<IsiBiaya> = {}): IsiBiaya => ({
  tanggal: "2026-09-29",
  kategori: "BENSIN",
  nilai: 50_000,
  catatan: null,
  fotoUrl: "/api/foto/ckabc123",
  ...x,
});

describe("bacaPengaturanBiaya", () => {
  it("kosong atau rusak → bawaan (aktif, 30 hari, foto wajib)", () => {
    expect(bacaPengaturanBiaya(null)).toEqual({ aktif: true, batasHari: 30, fotoWajib: true });
    expect(bacaPengaturanBiaya("bukan json")).toEqual(PENGATURAN_BIAYA_BAWAAN);
    expect(bacaPengaturanBiaya("[1,2]")).toEqual(PENGATURAN_BIAYA_BAWAAN);
  });

  it("kolom yang rusak jatuh ke bawaan per kolom, bukan seluruhnya", () => {
    expect(bacaPengaturanBiaya(JSON.stringify({ aktif: false, batasHari: -3, fotoWajib: "ya" }))).toEqual({
      aktif: false,
      batasHari: 30,
      fotoWajib: true,
    });
    expect(bacaPengaturanBiaya(JSON.stringify({ batasHari: 7, fotoWajib: false }))).toEqual({
      aktif: true,
      batasHari: 7,
      fotoWajib: false,
    });
  });

  it("periksaPengaturanBiaya menolak nilai di luar batas — yang disimpan harus terbaca kembali sama", () => {
    expect(periksaPengaturanBiaya({ aktif: true, batasHari: 14, fotoWajib: false })).toEqual({
      aktif: true,
      batasHari: 14,
      fotoWajib: false,
    });
    expect(periksaPengaturanBiaya({ aktif: true, batasHari: 0, fotoWajib: true })).toBeNull();
    expect(periksaPengaturanBiaya({ aktif: true, batasHari: 366, fotoWajib: true })).toBeNull();
    expect(periksaPengaturanBiaya({ aktif: true, batasHari: 2.5, fotoWajib: true })).toBeNull();
    expect(periksaPengaturanBiaya({ aktif: "ya", batasHari: 30, fotoWajib: true })).toBeNull();
    expect(periksaPengaturanBiaya(null)).toBeNull();
    for (const p of [atur(), atur({ aktif: false, batasHari: 1 }), atur({ batasHari: 365, fotoWajib: false })]) {
      expect(bacaPengaturanBiaya(JSON.stringify(periksaPengaturanBiaya(p)))).toEqual(p);
    }
  });
});

describe("periksaBiaya", () => {
  it("isian sah → dinormalkan; tanggal jadi tengah malam WIB", () => {
    const r = periksaBiaya(isi({ catatan: "  isi penuh  " }), atur(), SEKARANG);
    expect(r).toEqual({
      ok: true,
      nilai: {
        tanggal: "2026-09-29",
        spentAt: new Date("2026-09-29T00:00:00+07:00"),
        kategori: "BENSIN",
        nilai: 50_000,
        catatan: "isi penuh",
        fotoUrl: "/api/foto/ckabc123",
      },
    });
  });

  it("modul dimatikan kantor → NONAKTIF", () => {
    expect(periksaBiaya(isi(), atur({ aktif: false }), SEKARANG)).toEqual({ ok: false, kode: "NONAKTIF" });
  });

  it("kategori harus salah satu dari daftar", () => {
    expect(periksaBiaya(isi({ kategori: "HOTEL" }), atur(), SEKARANG)).toEqual({ ok: false, kode: "KATEGORI_TIDAK_DIKENAL" });
    for (const k of ["BENSIN", "PARKIR", "TOL", "MAKAN"]) {
      expect(periksaBiaya(isi({ kategori: k }), atur(), SEKARANG).ok).toBe(true);
    }
  });

  it("LAINNYA wajib bercatatan — spasi saja tidak dihitung", () => {
    expect(periksaBiaya(isi({ kategori: "LAINNYA" }), atur(), SEKARANG)).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect(periksaBiaya(isi({ kategori: "LAINNYA", catatan: "   " }), atur(), SEKARANG)).toEqual({
      ok: false,
      kode: "CATATAN_WAJIB",
    });
    expect(periksaBiaya(isi({ kategori: "LAINNYA", catatan: "Cuci mobil" }), atur(), SEKARANG).ok).toBe(true);
  });

  it("catatan dibatasi panjangnya", () => {
    expect(periksaBiaya(isi({ catatan: "x".repeat(501) }), atur(), SEKARANG)).toEqual({
      ok: false,
      kode: "CATATAN_TERLALU_PANJANG",
    });
  });

  it("nilai harus rupiah bulat > 0 dan tidak melewati batas kewajaran", () => {
    for (const n of [0, -1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(periksaBiaya(isi({ nilai: n }), atur(), SEKARANG)).toEqual({ ok: false, kode: "NILAI_TIDAK_SAH" });
    }
    expect(periksaBiaya(isi({ nilai: BATAS_NILAI_BIAYA }), atur(), SEKARANG).ok).toBe(true);
    expect(periksaBiaya(isi({ nilai: BATAS_NILAI_BIAYA + 1 }), atur(), SEKARANG)).toEqual({
      ok: false,
      kode: "NILAI_TERLALU_BESAR",
    });
  });

  it("tanggal harus hari kalender yang ada", () => {
    for (const t of ["", "29-09-2026", "2026-02-30", "2026-13-01", "kemarin"]) {
      expect(periksaBiaya(isi({ tanggal: t }), atur(), SEKARANG)).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    }
  });

  it("tanggal tidak boleh di masa depan — dihitung per hari WIB", () => {
    expect(periksaBiaya(isi({ tanggal: "2026-09-30" }), atur(), SEKARANG).ok).toBe(true);
    expect(periksaBiaya(isi({ tanggal: "2026-10-01" }), atur(), SEKARANG)).toEqual({
      ok: false,
      kode: "TANGGAL_MASA_DEPAN",
    });
    // 1 Okt 00.30 WIB = 30 Sep 17.30 UTC — menurut WIB hari ini sudah 1 Okt.
    const lewatTengahMalam = new Date("2026-09-30T17:30:00Z");
    expect(periksaBiaya(isi({ tanggal: "2026-10-01" }), atur(), lewatTengahMalam).ok).toBe(true);
  });

  it("tanggal tidak boleh lebih tua dari batas hari pengaturan", () => {
    expect(periksaBiaya(isi({ tanggal: "2026-08-31" }), atur(), SEKARANG).ok).toBe(true); // tepat 30 hari
    expect(periksaBiaya(isi({ tanggal: "2026-08-30" }), atur(), SEKARANG)).toEqual({
      ok: false,
      kode: "TANGGAL_TERLALU_LAMA",
    });
    expect(periksaBiaya(isi({ tanggal: "2026-09-22" }), atur({ batasHari: 7 }), SEKARANG)).toEqual({
      ok: false,
      kode: "TANGGAL_TERLALU_LAMA",
    });
  });

  it("foto struk wajib hanya bila pengaturannya wajib", () => {
    expect(periksaBiaya(isi({ fotoUrl: null }), atur(), SEKARANG)).toEqual({ ok: false, kode: "FOTO_WAJIB" });
    expect(periksaBiaya(isi({ fotoUrl: "  " }), atur(), SEKARANG)).toEqual({ ok: false, kode: "FOTO_WAJIB" });
    const r = periksaBiaya(isi({ fotoUrl: null }), atur({ fotoWajib: false }), SEKARANG);
    expect(r.ok && r.nilai.fotoUrl).toBeNull();
  });

  it("foto harus hasil unggahan aplikasi sendiri, bukan alamat bebas", () => {
    for (const u of ["https://contoh.com/a.jpg", "javascript:alert(1)", "/api/foto/", "/api/foto/a/../b", "blob:http://x/1"]) {
      expect(periksaBiaya(isi({ fotoUrl: u }), atur(), SEKARANG)).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    }
    expect(urlFotoSah("/api/foto/cm1x2y3z4")).toBe(true);
  });
});

describe("periksaPindahBiaya", () => {
  it("DIAJUKAN → DISETUJUI / DITOLAK; DISETUJUI → DIBAYAR", () => {
    expect(periksaPindahBiaya("DIAJUKAN", "DISETUJUI")).toEqual({ ok: true, alasan: null });
    expect(periksaPindahBiaya("DIAJUKAN", "DITOLAK", "Struk tidak terbaca")).toEqual({
      ok: true,
      alasan: "Struk tidak terbaca",
    });
    expect(periksaPindahBiaya("DISETUJUI", "DIBAYAR")).toEqual({ ok: true, alasan: null });
  });

  it("lompatan dan keadaan akhir ditolak", () => {
    expect(periksaPindahBiaya("DIAJUKAN", "DIBAYAR")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahBiaya("DISETUJUI", "DITOLAK", "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahBiaya("DITOLAK", "DISETUJUI")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahBiaya("DIBAYAR", "DIBAYAR")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahBiaya("ANEH", "DISETUJUI")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
  });

  it("menolak wajib beralasan; alasan yang tidak diminta dibuang", () => {
    expect(periksaPindahBiaya("DIAJUKAN", "DITOLAK")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaPindahBiaya("DIAJUKAN", "DITOLAK", "   ")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaPindahBiaya("DIAJUKAN", "DITOLAK", "x".repeat(501))).toEqual({
      ok: false,
      kode: "ALASAN_TERLALU_PANJANG",
    });
    expect(periksaPindahBiaya("DIAJUKAN", "DISETUJUI", "boleh")).toEqual({ ok: true, alasan: null });
  });
});

describe("bulan", () => {
  it("bacaBulan menerima YYYY-MM sah, selain itu bulan WIB sekarang", () => {
    expect(bacaBulan("2026-08", SEKARANG)).toBe("2026-08");
    expect(bacaBulan(["2026-07"], SEKARANG)).toBe("2026-07");
    for (const b of [undefined, "", "2026-13", "2026-8", "abc"]) expect(bacaBulan(b, SEKARANG)).toBe("2026-09");
    // 1 Okt 00.30 WIB sudah Oktober.
    expect(bacaBulan(undefined, new Date("2026-09-30T17:30:00Z"))).toBe("2026-10");
  });

  it("rentangBulanWib: awal bulan WIB sampai awal bulan berikutnya (eksklusif)", () => {
    expect(rentangBulanWib("2026-09")).toEqual({
      mulai: new Date("2026-09-01T00:00:00+07:00"),
      akhir: new Date("2026-10-01T00:00:00+07:00"),
    });
    expect(rentangBulanWib("2026-12").akhir).toEqual(new Date("2027-01-01T00:00:00+07:00"));
  });

  it("daftarBulanTerakhir: bulan ini lebih dulu, mundur n bulan melewati pergantian tahun", () => {
    expect(daftarBulanTerakhir(4, new Date("2026-02-10T03:00:00Z"))).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});

describe("ringkasPerStatus", () => {
  it("jumlah dan nilai per status, plus total", () => {
    const r = ringkasPerStatus([
      { status: "DIAJUKAN", nilai: 10_000 },
      { status: "DIAJUKAN", nilai: 5_000 },
      { status: "DIBAYAR", nilai: 20_000 },
      { status: "ANEH", nilai: 1 },
    ]);
    expect(r.perStatus.DIAJUKAN).toEqual({ jumlah: 2, nilai: 15_000 });
    expect(r.perStatus.DISETUJUI).toEqual({ jumlah: 0, nilai: 0 });
    expect(r.perStatus.DITOLAK).toEqual({ jumlah: 0, nilai: 0 });
    expect(r.perStatus.DIBAYAR).toEqual({ jumlah: 1, nilai: 20_000 });
    // Status tak dikenal tidak diam-diam masuk total.
    expect(r.total).toEqual({ jumlah: 3, nilai: 35_000 });
  });
});

describe("labelBulan", () => {
  it("nama bulan Indonesia + tahun", () => {
    expect(labelBulan("2026-09")).toBe("September 2026");
    expect(labelBulan("2027-01")).toBe("Januari 2027");
  });
});

describe("izin", () => {
  it("mengajukan = orang lapangan; admin berbintang tidak lewat HP", () => {
    expect(bolehMengajukanBiaya(["pwa:access"])).toBe(true);
    expect(bolehMengajukanBiaya(["*"])).toBe(false);
    expect(bolehMengajukanBiaya(undefined)).toBe(false);
  });

  it("menyetujui = atasan salesman; membayar = keuangan; keduanya terpisah", () => {
    expect(bolehMenyetujuiBiaya(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMenyetujuiBiaya(["journals:manage"])).toBe(false);
    expect(bolehMembayarBiaya(["journals:manage"])).toBe(true);
    expect(bolehMembayarBiaya(["field_sales_orders:approve"])).toBe(false);
    expect(bolehMenyetujuiBiaya(["*"]) && bolehMembayarBiaya(["*"])).toBe(true);
  });

  it("melihat = atasan salesman atau keuangan yang membayar", () => {
    expect(bolehMelihatBiaya(["field_sales_orders:view"])).toBe(true);
    expect(bolehMelihatBiaya(["journals:manage"])).toBe(true);
    expect(bolehMelihatBiaya(["journals:view"])).toBe(false);
    expect(bolehMelihatBiaya(["pwa:access"])).toBe(false);
  });
});
