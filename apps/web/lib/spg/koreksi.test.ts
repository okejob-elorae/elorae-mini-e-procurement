import { describe, expect, it } from "vitest";
import { putusReportKey } from "@/lib/spg-commission/payout";
import type { HasilGaji, RincianGaji } from "./gaji-pokok";
import { REF_KOMISI_SPG_PUTUS } from "./hilang";
import {
  awalJendelaKoreksi,
  barisSasaranKoreksi,
  dalamJendelaKoreksi,
  formatKoreksi,
  kalimatKoreksiKabar,
  kalimatPotongKabar,
  labelLaporanKomisi,
  rencanaBayarKomisi,
  rencanaBayarSemua,
  selisihMenunggu,
  selisihUnit,
  selisihUnitRinci,
  teksKoreksi,
  unitDitahan,
  unitTertutup,
  type BarisKomisiSpg,
  type KonteksBayar,
  type UnitKomisiSpg,
} from "./koreksi";

/**
 * Koreksi gaji & komisi SPG — bagian murni (keputusan pemilik 2026-11-02). Yang dulu dibayar
 * dikoreksi di pembayaran SPG itu berikutnya: selisih plus ditambahkan penuh, selisih minus dan
 * setiap pengurang (barang hilang, beban retur pembeli, utang) diambil dari KOMISI dulu lalu gaji
 * pokok (P5), dan yang tidak tertutup dibawa — atau, pada pembayaran terakhir SPG yang berhenti,
 * menjadi utang (P6a). Unit yang dasar gajinya belum pasti ditahan seluruhnya (P60). Contoh pemilik:
 * Ani dibayar Rp 12.500 untuk September, komisi per SPG-nya Rp 30.000 → koreksi +Rp 17.500 di
 * pembayaran Oktober.
 */

const rincian = (gajiPokok: number, lain: Partial<RincianGaji> = {}): RincianGaji => ({
  bulanKerja: "2026-10",
  gajiBulanan: gajiPokok,
  penuh: true,
  hariAwal: "2026-10-01",
  hariAkhir: "2026-10-31",
  sumberPembagi: "JADWAL",
  pembagi: 26,
  hariKerjaStandar: [1, 2, 3, 4, 5, 6],
  tarifHarian: Math.floor(gajiPokok / 26),
  hariTerjadwal: 26,
  hariIzin: 0,
  hariTidakMasuk: 0,
  tanggalTidakMasuk: [],
  hariMasukLibur: 0,
  tanggalMasukLibur: [],
  tanggalLuarRadius: [],
  hariDariCatatan: 0,
  gajiPokok,
  ...lain,
});

const gaji = (n: number): HasilGaji => ({ ok: true, rincian: rincian(n) });

const baris = (lain: Partial<BarisKomisiSpg> = {}): BarisKomisiSpg => ({
  refType: REF_KOMISI_SPG_PUTUS,
  refId: "r-okt",
  dibayar: false,
  dapatDibayar: true,
  bulanBayar: "2026-11",
  komisiTersimpan: 0,
  potongTersimpan: 0,
  gajiPokok: 0,
  potonganHilang: 0,
  ...lain,
});

const unit = (lain: Partial<UnitKomisiSpg> = {}): UnitKomisiSpg => ({
  kunci: putusReportKey("s1", "2026-10"),
  jenis: "PUTUS",
  storeId: "s1",
  namaToko: "Toko A",
  bulanJual: "2026-10",
  angka: 0,
  potong: 0,
  potongTanpaTarif: 0,
  baris: null,
  laporanTertutup: true,
  koreksiTerapan: 0,
  gajiTerapan: 0,
  gaji: null,
  ditahan: null,
  hariTahan: [],
  ...lain,
});

/** September sudah dibayar `dibayar`, komisi per SPG-nya sekarang `angka`. */
const september = (angka: number, dibayar: number, lain: Partial<UnitKomisiSpg> = {}) =>
  unit({
    kunci: putusReportKey("s1", "2026-09"),
    bulanJual: "2026-09",
    angka,
    baris: baris({ refId: "r-sep", dibayar: true, bulanBayar: "2026-10", komisiTersimpan: dibayar }),
    ...lain,
  });

/** Oktober belum dibayar dan boleh dibayar, komisi per SPG-nya `angka`. */
const oktober = (angka: number, lain: Partial<UnitKomisiSpg> = {}) => unit({ angka, potong: 4, baris: baris({ komisiTersimpan: angka, potongTersimpan: 4 }), ...lain });

const KUNCI_OKT = putusReportKey("s1", "2026-10");

describe("contoh pemilik — koreksi ikut pembayaran berikutnya", () => {
  it("Ani: Oktober Rp 30.000 + koreksi September +Rp 17.500 → dibayar Rp 47.500", () => {
    const r = rencanaBayarKomisi({ units: [september(30_000, 12_500), oktober(30_000)], kunci: KUNCI_OKT });
    expect(r).toMatchObject({ sasaran: true, jumlahKoreksi: 17_500, dibayar: 47_500, dibawa: 0 });
  });

  it("selisih = angka − yang dibayar − yang sudah diterapkan; unit yang belum tertutup 0", () => {
    expect(selisihUnit(september(30_000, 12_500))).toBe(17_500);
    expect(selisihUnit(september(30_000, 12_500, { koreksiTerapan: 17_500 }))).toBe(0);
    expect(selisihUnit(oktober(30_000, { laporanTertutup: false, baris: null }))).toBe(0);
    expect(unitTertutup(september(1, 1))).toBe(true);
  });
});

describe("koreksi minus dan pengurang: dari komisi dulu, lalu gaji pokok (P5)", () => {
  it("minus yang lebih besar dari pembayarannya dibawa; yang dibayar tidak pernah di bawah nol", () => {
    const r = rencanaBayarKomisi({ units: [september(2_000, 4_500), oktober(2_000)], kunci: KUNCI_OKT });
    expect(r).toMatchObject({ jumlahKoreksi: -2_000, dibawa: -500, dibayar: 0 });
  });

  it("minus Rp 15.000 pada komisi Rp 10.000 + gaji Rp 100.000: Rp 10.000 dari komisi, Rp 5.000 dari gaji", () => {
    const r = rencanaBayarKomisi({ units: [september(5_000, 20_000), oktober(10_000, { gaji: gaji(100_000) })], kunci: KUNCI_OKT });
    expect(r).toMatchObject({ gajiPokok: 100_000, dariKomisi: 10_000, dariGaji: 5_000, dibayar: 95_000, dibawa: 0 });
  });

  it("urutan pengurang: koreksi → barang hilang → beban retur pembeli → utang", () => {
    const konteks: KonteksBayar = {
      bebanHilang: [{ shareId: "h1", lossId: "l1", storeId: "s1", sisaSen: 300_000 }],
      bebanRetur: [{ chargeId: "c1", storeId: "s1", sisaSen: 400_000 }],
      utang: [{ debtId: "d1", jenis: "KOREKSI", storeId: "s1", sisaSen: 500_000 }],
      akhir: false,
    };
    const r = rencanaBayarKomisi({ units: [september(8_000, 10_000), oktober(10_000)], kunci: KUNCI_OKT, konteks });
    expect(r?.potong.map((p) => p.jenis)).toEqual(["KOREKSI", "BARANG_HILANG", "RETUR_PEMBELI", "UTANG"]);
    // Komisi Rp 10.000: koreksi −Rp 2.000, barang hilang Rp 3.000, retur Rp 4.000, utang Rp 1.000 dari Rp 5.000.
    expect(r).toMatchObject({ potonganHilang: 3_000, potonganRetur: 4_000, potonganUtang: 1_000, dibayar: 0 });
    expect(r?.potong.find((p) => p.jenis === "UTANG")?.sisa).toBe(4_000);
  });

  it("pengurang yang tertutup tidak dibawa; utang sisanya tetap terbuka (dibawa hanya untuk koreksi)", () => {
    const r = rencanaBayarKomisi({ units: [oktober(10_000)], kunci: KUNCI_OKT, konteks: { bebanHilang: [], bebanRetur: [], utang: [{ debtId: "d1", jenis: "KOREKSI", storeId: null, sisaSen: 250_000 }], akhir: false } });
    expect(r).toMatchObject({ potonganUtang: 2_500, dibayar: 7_500, dibawa: 0 });
  });
});

describe("contoh pemilik P11 dan P5 — satu pembayaran", () => {
  const bebanHilang50rb: KonteksBayar = {
    bebanHilang: [{ shareId: "h1", lossId: "l1", storeId: "s1", sisaSen: 5_000_000 }],
    bebanRetur: [],
    utang: [],
    akhir: false,
  };

  it("P11: gaji 1.000.000 + komisi 40.000 + koreksi +17.500 − barang hilang 50.000 → dibayar 1.007.500, seluruh potongan dari komisi", () => {
    const r = rencanaBayarKomisi({
      units: [september(47_500, 30_000), oktober(40_000, { gaji: gaji(1_000_000) })],
      kunci: KUNCI_OKT,
      konteks: bebanHilang50rb,
    });
    expect(r).toMatchObject({ gajiPokok: 1_000_000, jumlahKoreksi: 17_500, potonganHilang: 50_000, dariKomisi: 50_000, dariGaji: 0, dibayar: 1_007_500 });
    // Barang hilang dipotong PENUH di pembayaran ini (P11a), tidak dicicil.
    expect(r?.potong.find((p) => p.jenis === "BARANG_HILANG")).toMatchObject({ jumlah: 50_000, sisa: 0 });
  });

  it("P5: komisi 0, koreksi −2.500, gaji 1.000.000 → Rp 2.500 diambil dari gaji pokok, dibayar 997.500", () => {
    const r = rencanaBayarKomisi({ units: [september(20_000, 22_500), oktober(0, { gaji: gaji(1_000_000) })], kunci: KUNCI_OKT });
    expect(r).toMatchObject({ jumlahKoreksi: -2_500, dariKomisi: 0, dariGaji: 2_500, dibayar: 997_500, dibawa: 0 });
  });

  it("unit bertanda campuran: izin disetujui belakangan +134.615 (gaji) dan retur −20.000 (komisi) — minus komisinya tidak hilang", () => {
    const sep = september(10_000, 30_000, {
      gaji: gaji(3_634_615),
      baris: baris({ refId: "r-sep", dibayar: true, bulanBayar: "2026-10", komisiTersimpan: 30_000, gajiPokok: 3_500_000 }),
    });
    expect(selisihUnitRinci(sep)).toEqual({ komisi: -20_000, gaji: 134_615 });
    const r = rencanaBayarKomisi({ units: [sep, oktober(50_000)], kunci: KUNCI_OKT });
    // Kantong komisi 50.000 − 20.000; kantong gaji 0 + 134.615.
    expect(r).toMatchObject({ dariKomisi: 20_000, dariGaji: 0, dibayar: 164_615 });
    const k = r?.koreksi.find((x) => x.sumber === sep.kunci);
    expect(k).toMatchObject({ diterapkan: 114_615, gajiDiterapkan: 134_615 });
  });
});

describe("gaji pokok ikut dikoreksi", () => {
  it("gaji September dibayar Rp 3.000.000, sekarang Rp 3.100.000: selisih gaji +Rp 100.000", () => {
    const sep = september(10_000, 10_000, { gaji: gaji(3_100_000), baris: baris({ refId: "r-sep", dibayar: true, komisiTersimpan: 10_000, gajiPokok: 3_000_000 }) });
    expect(selisihUnitRinci(sep)).toEqual({ komisi: 0, gaji: 100_000 });
    const [k] = selisihMenunggu([sep]);
    expect(k).toMatchObject({ selisih: 100_000, selisihGaji: 100_000 });
    expect(teksKoreksi({ ...k, gajiDiterapkan: 100_000 })).toBe("Koreksi gaji & komisi penjualan September 2026 — Toko A");
  });
});

describe("pembayaran ditahan (P60)", () => {
  it("unit yang ditahan: rencana bertanda ditahan, bukan sasaran, dan tidak menyumbang selisih", () => {
    const okt = oktober(10_000, { ditahan: "JADWAL_MENUNGGU_PERSETUJUAN", hariTahan: ["2026-10-03"] });
    const r = rencanaBayarKomisi({ units: [september(30_000, 12_500), okt], kunci: KUNCI_OKT });
    expect(r?.ditahan).toBe("JADWAL_MENUNGGU_PERSETUJUAN");
    expect(barisSasaranKoreksi([okt])).toBeNull();
    expect(selisihUnit(okt)).toBe(0);
    expect(unitDitahan([okt])).toHaveLength(1);
  });
});

describe("pembayaran terakhir SPG yang berhenti (P6a)", () => {
  it("minus yang tidak tertutup menjadi utang, tidak dibawa", () => {
    const r = rencanaBayarKomisi({ units: [september(2_000, 4_500), oktober(2_000)], kunci: KUNCI_OKT, konteks: { bebanHilang: [], bebanRetur: [], utang: [], akhir: true } });
    expect(r).toMatchObject({ akhir: true, dibawa: 0, dibayar: 0 });
    expect(r?.keUtang?.koreksi).toEqual([expect.objectContaining({ bulanJual: "2026-09", jumlah: 500 })]);
  });
});

describe("rencanaBayarSemua", () => {
  it("satu rencana per baris yang belum dibayar dan boleh dibayar", () => {
    const peta = rencanaBayarSemua([september(30_000, 12_500), oktober(30_000)], { bebanHilang: [], bebanRetur: [], utang: [] });
    expect([...peta.keys()]).toEqual(["r-okt"]);
  });

  it("dua baris belum dibayar, satu beban: beban dibagi menurut urutan bayar dan tidak pernah tampak dua kali (B22)", () => {
    // September belum dibayar (komisi Rp 3.000) dibayar lebih dulu dari Oktober (Rp 10.000).
    const sepBelum = unit({
      kunci: putusReportKey("s1", "2026-09"),
      bulanJual: "2026-09",
      angka: 3_000,
      potong: 1,
      baris: baris({ refId: "r-sep", komisiTersimpan: 3_000, potongTersimpan: 1 }),
    });
    const peta = rencanaBayarSemua([oktober(10_000), sepBelum], {
      bebanHilang: [],
      bebanRetur: [{ chargeId: "c1", storeId: "s1", sisaSen: 400_000 }],
      kembaliBeban: [{ chargeId: "c9", storeId: "s1", sen: 200_000 }],
      utang: [],
    });
    const sep = peta.get("r-sep");
    const okt = peta.get("r-okt");
    // Beban Rp 4.000: Rp 3.000 dari September, sisanya Rp 1.000 dari Oktober — jumlahnya tepat bebannya.
    expect([sep?.potonganRetur, okt?.potonganRetur]).toEqual([3_000, 1_000]);
    expect(sep?.potong.find((p) => p.sumber === "c1")).toMatchObject({ jumlah: 4_000, sisa: 1_000 });
    expect(okt?.potong.find((p) => p.sumber === "c1")).toMatchObject({ jumlah: 1_000, sisa: 0 });
    // Pengembalian beban ikut baris pertama saja.
    expect(sep?.jumlahKembaliBeban).toBe(2_000);
    expect(okt?.kembaliBeban).toEqual([]);
    expect([sep?.dibayar, okt?.dibayar]).toEqual([2_000, 9_000]);
  });

  it("baris yang ditahan tidak mengambil beban; baris berikutnya yang membayarnya", () => {
    const sepTahan = unit({
      kunci: putusReportKey("s1", "2026-09"),
      bulanJual: "2026-09",
      angka: 3_000,
      baris: baris({ refId: "r-sep", komisiTersimpan: 3_000 }),
      ditahan: "CATATAN_HADIR_BELUM_DIMASUKKAN",
      hariTahan: ["2026-09-01"],
    });
    const peta = rencanaBayarSemua([sepTahan, oktober(10_000)], {
      bebanHilang: [],
      bebanRetur: [{ chargeId: "c1", storeId: "s1", sisaSen: 400_000 }],
      kembaliBeban: [{ chargeId: "c9", storeId: "s1", sen: 200_000 }],
      utang: [],
    });
    expect(peta.get("r-sep")).toMatchObject({ ditahan: "CATATAN_HADIR_BELUM_DIMASUKKAN", potonganRetur: 0, jumlahKembaliBeban: 0 });
    expect(peta.get("r-okt")).toMatchObject({ potonganRetur: 4_000, jumlahKembaliBeban: 2_000, dibayar: 8_000 });
  });
});

describe("jendela koreksi (P10)", () => {
  it("12 bulan ke belakang dari bulan berjalan; unit di luar jendela tidak dikoreksi lagi", () => {
    expect(awalJendelaKoreksi("2026-11")).toBe("2025-11");
    expect(dalamJendelaKoreksi("2025-11", "2026-11")).toBe(true);
    expect(dalamJendelaKoreksi("2025-10", "2026-11")).toBe(false);
    expect(dalamJendelaKoreksi(null, "2026-11")).toBe(false);
    expect(selisihUnit(september(30_000, 12_500, { diLuarJendela: true }))).toBe(0);
  });
});

describe("teks", () => {
  it("nama laporan dan jumlah bertanda (minus U+2212)", () => {
    expect(labelLaporanKomisi({ bulanJual: "2026-10", namaToko: "Toko A" })).toBe("Komisi penjualan Oktober 2026 — Toko A");
    expect(formatKoreksi(17_500)).toMatch(/^\+Rp\s?17\.500$/);
    expect(formatKoreksi(-2_500)).toMatch(/^−Rp\s?2\.500$/);
  });

  it("kalimat kabar: koreksi yang diterapkan lalu sisa yang dibawa; pengurang menyebut bagian dari gaji", () => {
    const r = rencanaBayarKomisi({ units: [september(2_000, 4_500), oktober(2_000)], kunci: KUNCI_OKT });
    expect(kalimatKoreksiKabar(r?.koreksi ?? [])).toContain("dikurangkan dari pembayaran berikutnya");
    expect(kalimatKoreksiKabar([])).toBe("");
    expect(kalimatPotongKabar({ potonganHilang: 1_000, potonganRetur: 0, potonganUtang: 0, dariGaji: 500 })).toContain("sebagian dari gaji pokok");
    expect(kalimatPotongKabar({ potonganHilang: 0, potonganRetur: 0, potonganUtang: 0, dariGaji: 0 })).toBe("");
  });
});
