import { describe, expect, it } from "vitest";
import { konsiReportKey, putusReportKey } from "@/lib/spg-commission/payout";
import { formatIDR } from "@/lib/sales-orders/format";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import {
  alasanTahan,
  alasanTahanBayar,
  awalJendelaKoreksi,
  barisSasaranKoreksi,
  dalamJendelaKoreksi,
  formatKoreksi,
  kalimatKoreksiKabar,
  koreksiDitahan,
  labelLaporanKomisi,
  MENAHAN_PEMBAYARAN,
  pratinjauSesudahDicek,
  rencanaBayarKomisi,
  rencanaBayarSemua,
  selisihMenunggu,
  selisihUnit,
  teksKoreksi,
  unitTertutup,
  type BarisKomisiSpg,
  type BarisKoreksi,
  type UnitKomisiSpg,
} from "./koreksi";

/**
 * Koreksi komisi SPG — bagian murni (keputusan pemilik 2026-11-02): tidak ada bagi rata; yang dulu
 * dibayar bagi rata dikoreksi SEKALI di pembayaran SPG itu berikutnya. Contoh pemilik: Ani dan Sari
 * masing-masing dibayar Rp 22.500 untuk September, padahal per SPG Ani Rp 40.000 dan Sari
 * Rp 20.000 — Ani +Rp 17.500, Sari −Rp 2.500 di pembayaran Oktober.
 */

const TOKO = "toko-x";
const NAMA = "Toko X";
const SEP = putusReportKey(TOKO, "2026-09");
const OKT = putusReportKey(TOKO, "2026-10");
const NOV = putusReportKey(TOKO, "2026-11");

function baris(over: Partial<BarisKomisiSpg> & Pick<BarisKomisiSpg, "refId">): BarisKomisiSpg {
  return {
    refType: REF_KOMISI_SPG_PUTUS,
    dibayar: false,
    dapatDibayar: true,
    bulanBayar: "2026-11",
    komisiTersimpan: 0,
    potongTersimpan: 0,
    dasarLama: false,
    gajiPokok: 0,
    potonganHilang: 0,
    dalamJendela: true,
    ...over,
  };
}

function unit(over: Partial<UnitKomisiSpg> & Pick<UnitKomisiSpg, "kunci" | "bulanJual">): UnitKomisiSpg {
  return {
    jenis: "PUTUS",
    storeId: TOKO,
    namaToko: NAMA,
    angka: 0,
    potong: 0,
    potongTanpaTarif: 0,
    baris: null,
    laporanTertutup: false,
    koreksiTerapan: 0,
    ditahan: null,
    ...over,
  };
}

/** September dibayar bagi rata Rp 22.500 (aturan lama); angka per SPG sekarang `angka`. */
const septemberDibayar = (refId: string, angka: number, koreksiTerapan = 0) =>
  unit({
    kunci: SEP,
    bulanJual: "2026-09",
    angka,
    potong: angka / 2_000,
    laporanTertutup: true,
    koreksiTerapan,
    baris: baris({ refId, dibayar: true, dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 15, dasarLama: true }),
  });

/** Oktober dicek di November, belum dibayar, ditetapkan dengan tarif kategori. */
const oktoberBelumDibayar = (refId: string, angka: number) =>
  unit({
    kunci: OKT,
    bulanJual: "2026-10",
    angka,
    potong: angka / 2_000,
    laporanTertutup: false,
    baris: baris({ refId, bulanBayar: "2026-11", komisiTersimpan: angka, potongTersimpan: angka / 2_000 }),
  });

const rencana = (units: UnitKomisiSpg[], kunci: string, maksPotongPersen = 50) => rencanaBayarKomisi({ units, kunci, maksPotongPersen });

describe("contoh pemilik — bagi rata September dikoreksi di pembayaran Oktober", () => {
  it("Ani: Oktober Rp 30.000 + koreksi September +Rp 17.500 → dibayar Rp 47.500", () => {
    const r = rencana([septemberDibayar("ani-sep", 40_000), oktoberBelumDibayar("ani-okt", 30_000)], OKT);
    expect(r).toMatchObject({ refId: "ani-okt", sasaran: true, berubah: false, dasar: 30_000, jumlahKoreksi: 17_500, dibayar: 47_500, dibawa: 0 });
    expect(r?.koreksi).toEqual([
      expect.objectContaining({ sumber: SEP, bulanJual: "2026-09", selisih: 17_500, diterapkan: 17_500, dibawa: 0, angka: 40_000, dibayarSebelum: 22_500, terapanSebelum: 0 }),
    ]);
    expect(r?.koreksiDiBarisLain).toBeNull();
  });

  it("Sari: Oktober Rp 10.000 − koreksi September Rp 2.500 → dibayar Rp 7.500", () => {
    const r = rencana([septemberDibayar("sari-sep", 20_000), oktoberBelumDibayar("sari-okt", 10_000)], OKT);
    expect(r).toMatchObject({ dasar: 10_000, jumlahKoreksi: -2_500, dibayar: 7_500, dibawa: 0 });
    expect(r?.koreksi.map((k) => [k.sumber, k.selisih, k.diterapkan, k.dibawa])).toEqual([[SEP, -2_500, -2_500, 0]]);
  });

  it("selisih unit yang sudah dibayar = angka − yang dibayar − yang sudah diterapkan; unit yang belum dibayar 0", () => {
    expect(selisihUnit(septemberDibayar("ani-sep", 40_000))).toBe(17_500);
    expect(selisihUnit(septemberDibayar("ani-sep", 40_000, 17_500))).toBe(0);
    expect(selisihUnit(oktoberBelumDibayar("ani-okt", 30_000))).toBe(0);
  });
});

describe("koreksi minus yang lebih besar dari pembayarannya dibawa", () => {
  it("Sari dasar Rp 2.000: diterapkan −Rp 2.000, dibawa −Rp 500, dibayar Rp 0", () => {
    const r = rencana([septemberDibayar("sari-sep", 20_000), oktoberBelumDibayar("sari-okt", 2_000)], OKT);
    expect(r).toMatchObject({ dasar: 2_000, jumlahKoreksi: -2_000, dibayar: 0, dibawa: -500 });
    expect(r?.koreksi.map((k) => [k.selisih, k.diterapkan, k.dibawa])).toEqual([[-2_500, -2_000, -500]]);
  });

  it("pembayaran berikutnya, dengan −Rp 2.000 sudah diterapkan, menerapkan sisa −Rp 500", () => {
    const oktDibayar = unit({
      kunci: OKT,
      bulanJual: "2026-10",
      angka: 2_000,
      potong: 1,
      baris: baris({ refId: "sari-okt", dibayar: true, dapatDibayar: false, bulanBayar: "2026-11", komisiTersimpan: 2_000, potongTersimpan: 1 }),
    });
    const nov = unit({ kunci: NOV, bulanJual: "2026-11", angka: 10_000, potong: 5, baris: baris({ refId: "sari-nov", bulanBayar: "2026-12", komisiTersimpan: 10_000, potongTersimpan: 5 }) });
    const units = [septemberDibayar("sari-sep", 20_000, -2_000), oktDibayar, nov];
    expect(selisihUnit(units[0])).toBe(-500);
    const r = rencana(units, NOV);
    expect(r).toMatchObject({ sasaran: true, jumlahKoreksi: -500, dibayar: 9_500, dibawa: 0 });
  });

  it("beberapa koreksi minus diterapkan terlama dulu, dan yang dibayar tidak pernah di bawah nol", () => {
    const juli = unit({
      kunci: putusReportKey(TOKO, "2026-07"),
      bulanJual: "2026-07",
      angka: 1_000,
      baris: baris({ refId: "jul", dibayar: true, dapatDibayar: false, bulanBayar: "2026-08", komisiTersimpan: 3_000 }),
    });
    const agustus = unit({
      kunci: putusReportKey(TOKO, "2026-08"),
      bulanJual: "2026-08",
      angka: 1_000,
      baris: baris({ refId: "agu", dibayar: true, dapatDibayar: false, bulanBayar: "2026-09", komisiTersimpan: 3_000 }),
    });
    const juni = unit({
      kunci: putusReportKey(TOKO, "2026-06"),
      bulanJual: "2026-06",
      angka: 2_000,
      baris: baris({ refId: "jun", dibayar: true, dapatDibayar: false, bulanBayar: "2026-07", komisiTersimpan: 1_000 }),
    });
    const r = rencana([agustus, juli, juni, oktoberBelumDibayar("okt", 3_000)], OKT);
    // Plus Juni +1.000 dulu (4.000), lalu Juli −2.000 (2.000), lalu Agustus −2.000 hanya −2.000 sampai 0.
    expect(r?.koreksi.map((k) => [k.bulanJual, k.selisih, k.diterapkan, k.dibawa])).toEqual([
      ["2026-06", 1_000, 1_000, 0],
      ["2026-07", -2_000, -2_000, 0],
      ["2026-08", -2_000, -2_000, 0],
    ]);
    expect(r).toMatchObject({ dibayar: 0, dibawa: 0, jumlahKoreksi: -3_000 });

    const kecil = rencana([agustus, juli, oktoberBelumDibayar("okt", 3_000)], OKT);
    expect(kecil?.koreksi.map((k) => [k.bulanJual, k.diterapkan, k.dibawa])).toEqual([
      ["2026-07", -2_000, 0],
      ["2026-08", -1_000, -1_000],
    ]);
    expect(kecil).toMatchObject({ dibayar: 0, dibawa: -1_000 });
  });
});

describe("baris sasaran", () => {
  it("baris yang bukan sasaran tidak menerapkan apa pun dan menyebut ke baris mana koreksinya ikut", () => {
    const konsi = unit({
      kunci: konsiReportKey("siklus-okt"),
      jenis: "KONSI",
      storeId: "toko-k",
      namaToko: "Toko K",
      bulanJual: "2026-10",
      angka: 8_000,
      laporanTertutup: true,
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "konsi-okt", bulanBayar: "2026-12", komisiTersimpan: 8_000, potongTersimpan: null }),
    });
    const units = [septemberDibayar("ani-sep", 40_000), oktoberBelumDibayar("ani-okt", 30_000), konsi];
    const r = rencana(units, konsi.kunci);
    expect(r).toMatchObject({ sasaran: false, koreksi: [], jumlahKoreksi: 0, dibayar: 8_000 });
    expect(r?.koreksiDiBarisLain).toEqual({ kunci: OKT, bulanJual: "2026-10", namaToko: NAMA, jumlah: 17_500 });
    // Rencana sasaran tetap membawanya.
    expect(rencanaBayarSemua(units, 50).get("ani-okt")?.jumlahKoreksi).toBe(17_500);
  });

  it("penyeimbang unitnya sendiri selalu ikut, walau bukan sasaran", () => {
    // Siklus konsi yang dulu dibayar lewat koreksi Rp 5.000 (tanpa baris), kini punya baris sendiri.
    const konsi = unit({
      kunci: konsiReportKey("siklus-sep"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 5_000,
      laporanTertutup: true,
      koreksiTerapan: 5_000,
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "konsi-sep", bulanBayar: "2026-12", komisiTersimpan: 5_000, potongTersimpan: null }),
    });
    const r = rencana([oktoberBelumDibayar("ani-okt", 30_000), konsi], konsi.kunci);
    expect(r?.sasaran).toBe(false);
    expect(r?.koreksi.map((k) => [k.sumber, k.selisih, k.diterapkan])).toEqual([[konsi.kunci, -5_000, -5_000]]);
    expect(r?.dibayar).toBe(0);
  });

  it("urutan: bulan pembayaran, lalu bulan penjualan, konsinyasi sebelum putus, lalu id; yang dibayar/tidak bisa dibayar/di luar jendela dilewati", () => {
    const putusNov = unit({ kunci: "p-nov", bulanJual: "2026-10", baris: baris({ refId: "b", bulanBayar: "2026-11" }) });
    const putusOktBayar = unit({ kunci: "p-okt", bulanJual: "2026-10", baris: baris({ refId: "c", bulanBayar: "2026-10" }) });
    expect(barisSasaranKoreksi([putusNov, putusOktBayar])?.baris.refId).toBe("c");

    const jualSep = unit({ kunci: "p-sep", bulanJual: "2026-09", baris: baris({ refId: "z", bulanBayar: "2026-11" }) });
    expect(barisSasaranKoreksi([putusNov, jualSep])?.baris.refId).toBe("z");

    const konsi = unit({ kunci: "k", jenis: "KONSI", bulanJual: "2026-10", baris: baris({ refType: REF_KOMISI_KONSI, refId: "zz", bulanBayar: "2026-11" }) });
    expect(barisSasaranKoreksi([putusNov, konsi])?.baris.refId).toBe("zz");

    const kembar = unit({ kunci: "p-nov-2", bulanJual: "2026-10", baris: baris({ refId: "a", bulanBayar: "2026-11" }) });
    expect(barisSasaranKoreksi([putusNov, kembar])?.baris.refId).toBe("a");

    const lewat = [
      unit({ kunci: "dibayar", bulanJual: "2026-01", baris: baris({ refId: "1", dibayar: true, dapatDibayar: false, bulanBayar: "2026-02" }) }),
      unit({ kunci: "belum-dicek", bulanJual: "2026-01", baris: baris({ refId: "2", dapatDibayar: false, bulanBayar: null }) }),
      unit({ kunci: "lama", bulanJual: "2025-01", baris: baris({ refId: "3", bulanBayar: "2025-02", dalamJendela: false }) }),
    ];
    expect(barisSasaranKoreksi([...lewat, putusNov])?.baris.refId).toBe("b");
    expect(barisSasaranKoreksi(lewat)).toBeNull();
  });
});

describe("sumber koreksi", () => {
  it("baris yang belum dibayar tidak pernah menjadi sumber — dibayar dengan angka sekarang", () => {
    const u = unit({ kunci: SEP, bulanJual: "2026-09", angka: 20_000, laporanTertutup: true, baris: baris({ refId: "x", komisiTersimpan: 22_500 }) });
    expect(unitTertutup(u)).toBe(false);
    expect(selisihUnit(u)).toBe(0);
    expect(selisihMenunggu([u])).toEqual([]);
  });

  it("tanpa baris di laporan yang sudah tertutup: seluruh angkanya (nota yang menyusul) menjadi selisih", () => {
    const u = unit({ kunci: SEP, bulanJual: "2026-09", angka: 4_000, laporanTertutup: true });
    expect(unitTertutup(u)).toBe(true);
    expect(selisihUnit(u)).toBe(4_000);
    expect(selisihMenunggu([u, unit({ kunci: OKT, bulanJual: "2026-10", angka: 9_000 })]).map((k) => [k.sumber, k.selisih])).toEqual([[SEP, 4_000]]);
  });

  it("selisih menunggu: hanya unit tertutup dengan selisih bukan nol, bulan penjualan terlama dulu", () => {
    const daftar = selisihMenunggu([septemberDibayar("s", 20_000), septemberDibayar("t", 22_500), unit({ kunci: "agu", bulanJual: "2026-08", angka: 1_000, laporanTertutup: true })]);
    expect(daftar.map((k) => [k.bulanJual, k.selisih, k.diterapkan, k.dibawa])).toEqual([
      ["2026-08", 1_000, 0, 0],
      ["2026-09", -2_500, 0, 0],
    ]);
  });
});

describe("membayar dengan angka sekarang", () => {
  it("angka aturan lama yang basi (Rp 22.500) diganti angka per SPG (Rp 20.000): berubah, dibayar dari Rp 20.000", () => {
    const u = unit({
      kunci: SEP,
      bulanJual: "2026-09",
      angka: 20_000,
      potong: 10,
      laporanTertutup: true,
      baris: baris({ refId: "sari-sep", bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 10, dasarLama: true }),
    });
    expect(rencana([u], SEP)).toMatchObject({ komisiLama: 22_500, komisiBaru: 20_000, berubah: true, dasar: 20_000, dibayar: 20_000 });
  });

  it("baris toko putus aturan lama yang angkanya sama tetap ditulis ulang (dasarnya); potong yang berbeda juga mengubahnya", () => {
    const sama = unit({ kunci: SEP, bulanJual: "2026-09", angka: 20_000, potong: 10, baris: baris({ refId: "a", komisiTersimpan: 20_000, potongTersimpan: 10, dasarLama: true }) });
    expect(rencana([sama], SEP)?.berubah).toBe(true);
    const potong = unit({ kunci: SEP, bulanJual: "2026-09", angka: 20_000, potong: 11, baris: baris({ refId: "a", komisiTersimpan: 20_000, potongTersimpan: 10 }) });
    expect(rencana([potong], SEP)?.berubah).toBe(true);
    const tetap = unit({ kunci: SEP, bulanJual: "2026-09", angka: 20_000, potong: 10, baris: baris({ refId: "a", komisiTersimpan: 20_000, potongTersimpan: 10 }) });
    expect(rencana([tetap], SEP)?.berubah).toBe(false);
  });

  it("potongan beban barang hilang dipertahankan selama tidak melebihi batas bruto baru, selain itu sama dengan batasnya", () => {
    const u = (angka: number) =>
      unit({ kunci: SEP, bulanJual: "2026-09", angka, baris: baris({ refId: "a", komisiTersimpan: 22_500, potonganHilang: 4_000 }) });
    expect(rencana([u(20_000)], SEP)).toMatchObject({ potonganHilang: 4_000, dasar: 16_000, dibayar: 16_000 });
    // Bruto 6.000 × 50% = 3.000: potongan turun ke batasnya, tidak pernah naik.
    expect(rencana([u(6_000)], SEP)).toMatchObject({ potonganHilang: 3_000, dasar: 3_000 });
  });

  it("konsinyasi: gaji pokok ikut dasar, dan batas potongnya dari gaji + komisi", () => {
    const u = unit({
      kunci: konsiReportKey("c1"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 40_000,
      laporanTertutup: true,
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "k1", komisiTersimpan: 22_500, potongTersimpan: null, gajiPokok: 1_000_000, potonganHilang: 50_000 }),
    });
    expect(rencana([u], u.kunci)).toMatchObject({ berubah: true, komisiBaru: 40_000, potonganHilang: 50_000, dasar: 990_000, dibayar: 990_000 });
  });

  it("tanpa baris yang belum dibayar dan bisa dibayar: tidak ada rencana", () => {
    expect(rencana([septemberDibayar("a", 40_000)], SEP)).toBeNull();
    expect(rencana([unit({ kunci: SEP, bulanJual: "2026-09", baris: baris({ refId: "b", dapatDibayar: false }) })], SEP)).toBeNull();
    expect(rencana([], SEP)).toBeNull();
  });

  it("tepat sampai sen", () => {
    const sep = unit({
      kunci: SEP,
      bulanJual: "2026-09",
      angka: 20_000,
      laporanTertutup: true,
      baris: baris({ refId: "s", dibayar: true, dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_499.99 }),
    });
    expect(selisihUnit(sep)).toBe(-2_499.99);
    const r = rencana([sep, oktoberBelumDibayar("o", 10_000.1)], OKT);
    expect(r).toMatchObject({ jumlahKoreksi: -2_499.99, dibayar: 7_500.11 });
  });
});

describe("penahanan — laporan aturan lama yang tidak bisa dibandingkan jujur menunggu keputusan pemilik", () => {
  it("alasanTahan: hanya aturan lama; potong tanpa tarif lebih dulu, lalu laporan konsinyasi yang tidak lengkap", () => {
    expect(alasanTahan({ jenis: "PUTUS", dasarLama: true, potongTanpaTarif: 3, laporanTidakLengkap: false })).toBe("TANPA_TARIF");
    // Pemanggil yang tidak menyebut dibayar-tidaknya baris: bacaan paling hati-hati.
    expect(alasanTahan({ jenis: "KONSI", dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: true })).toBe("LAPORAN_TIDAK_LENGKAP");
    expect(alasanTahan({ jenis: "KONSI", dasarLama: true, potongTanpaTarif: 3, laporanTidakLengkap: true })).toBe("TANPA_TARIF");
    // Potong tanpa tarif menahan baris yang belum dibayar juga.
    expect(alasanTahan({ jenis: "KONSI", dasarLama: true, potongTanpaTarif: 3, laporanTidakLengkap: true, komisiDibayar: null, angka: 0 })).toBe("TANPA_TARIF");
    // Toko putus tidak punya angka resmi: "tidak lengkap" tidak berlaku.
    expect(alasanTahan({ jenis: "PUTUS", dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: true })).toBeNull();
    // Aturan baru tidak pernah ditahan: potong tanpa tarif di sana juga Rp 0 di angka tersimpannya.
    expect(alasanTahan({ jenis: "PUTUS", dasarLama: false, potongTanpaTarif: 3, laporanTidakLengkap: false })).toBeNull();
    expect(alasanTahan({ jenis: "KONSI", dasarLama: false, potongTanpaTarif: 0, laporanTidakLengkap: true })).toBeNull();
    expect(alasanTahan({ jenis: "KONSI", dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: false })).toBeNull();
  });

  it("laporan konsinyasi tidak lengkap (Q7): hanya uang yang sudah dibayar lebih dari angka sekarang yang ditahan", () => {
    const tidakLengkap = { jenis: "KONSI" as const, dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: true };
    // Baris belum dibayar, atau tanpa baris: dibayar dengan aturan hari ini — tidak pernah ditahan.
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: null, angka: 0 })).toBeNull();
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: null, angka: 16_000 })).toBeNull();
    // Sudah dibayar Rp 22.500 dari angka resmi, HP hanya Rp 16.000: tidak ditarik kembali.
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500, angka: 16_000 })).toBe("LAPORAN_TIDAK_LENGKAP");
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500, angka: 22_499.99 })).toBe("LAPORAN_TIDAK_LENGKAP");
    // Angka sekarang tidak kurang dari yang dibayar: tidak ada yang ditarik kembali, selisih plusnya jujur.
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500, angka: 22_500 })).toBeNull();
    expect(alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500, angka: 30_000 })).toBeNull();
    // Hanya potong tanpa tarif yang menahan PEMBAYARAN baris yang belum dibayar.
    expect(MENAHAN_PEMBAYARAN).toEqual({ TANPA_TARIF: true, LAPORAN_TIDAK_LENGKAP: false });
    expect([alasanTahanBayar("TANPA_TARIF"), alasanTahanBayar("LAPORAN_TIDAK_LENGKAP"), alasanTahanBayar(null)]).toEqual(["TANPA_TARIF", null, null]);
  });

  it("September dibayar bagi rata sebelum tabel tarif ada (potongnya terbaca Rp 0): TIDAK menjadi koreksi −Rp 22.500", () => {
    const u = { ...septemberDibayar("a", 0), potongTanpaTarif: 20, ditahan: "TANPA_TARIF" as const };
    expect(selisihUnit(u)).toBe(0);
    expect(selisihMenunggu([u])).toEqual([]);
    const r = rencana([u, oktoberBelumDibayar("o", 30_000)], OKT);
    // Oktober dibayar apa adanya; September tidak ikut.
    expect(r).toMatchObject({ ditahan: null, sasaran: true, koreksi: [], jumlahKoreksi: 0, dibayar: 30_000 });
    expect(koreksiDitahan([u])).toEqual([
      expect.objectContaining({ sumber: SEP, alasan: "TANPA_TARIF", selisih: -22_500, potongTanpaTarif: 20, belumDibayar: false }),
    ]);
  });

  it("baris aturan lama yang belum dibayar dan ditahan: tidak dibayar dengan Rp 0 maupun Rp 22.500, bukan sasaran, terdaftar", () => {
    const lama = unit({
      kunci: SEP,
      bulanJual: "2026-09",
      angka: 0,
      potong: 11,
      potongTanpaTarif: 11,
      ditahan: "TANPA_TARIF",
      baris: baris({ refId: "t", bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 11, dasarLama: true }),
    });
    const r = rencana([lama], SEP);
    expect(r).toMatchObject({ ditahan: "TANPA_TARIF", berubah: false, sasaran: false, koreksi: [], jumlahKoreksi: 0, komisiLama: 22_500 });
    // Rencana yang ditahan hanya untuk tampilan (angka tersimpan); penulis menolaknya.
    expect(r?.dibayar).toBe(22_500);
    // Koreksi SPG itu ikut baris lain yang tidak ditahan, bukan baris yang tertahan.
    const okt = oktoberBelumDibayar("o", 1_000);
    expect(barisSasaranKoreksi([lama, okt])?.baris.refId).toBe("o");
    expect(barisSasaranKoreksi([lama])).toBeNull();
    expect(koreksiDitahan([lama])).toEqual([expect.objectContaining({ sumber: SEP, alasan: "TANPA_TARIF", selisih: -22_500, belumDibayar: true })]);
  });

  it("siklus konsinyasi aturan lama yang laporannya diketik kantor: yang sudah dibayar tidak ditarik kembali, yang belum dibayar dibayar dengan aturan hari ini (Q7) beserta gajinya", () => {
    // Angka resmi 30 potong, HP mencatat 8 potong miliknya → Rp 16.000; dulu dibayar Rp 22.500.
    const tidakLengkap = { jenis: "KONSI" as const, dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: true, angka: 16_000 };
    const dibayar = unit({
      kunci: konsiReportKey("c-lama"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 16_000,
      potong: 8,
      laporanTertutup: true,
      ditahan: alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500 }),
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "k-lama", dibayar: true, dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: null, dasarLama: true }),
    });
    expect(dibayar.ditahan).toBe("LAPORAN_TIDAK_LENGKAP");
    expect(selisihUnit(dibayar)).toBe(0);
    expect(koreksiDitahan([dibayar])).toEqual([expect.objectContaining({ alasan: "LAPORAN_TIDAK_LENGKAP", selisih: -6_500, belumDibayar: false })]);
    // Pembayaran SPG itu berikutnya tidak membawa −Rp 6.500.
    expect(rencana([dibayar, oktoberBelumDibayar("o", 10_000)], OKT)).toMatchObject({ sasaran: true, koreksi: [], jumlahKoreksi: 0, dibayar: 10_000 });

    // Baris SPG lain di siklus yang sama, belum dibayar: tidak ditahan — gaji Rp 500.000 + komisi HP Rp 16.000.
    const belum = unit({
      ...dibayar,
      ditahan: alasanTahan({ ...tidakLengkap, komisiDibayar: null }),
      baris: { ...dibayar.baris!, refId: "k-belum", dibayar: false, dapatDibayar: true, gajiPokok: 500_000 },
    });
    expect(belum.ditahan).toBeNull();
    expect(rencana([belum], belum.kunci)).toMatchObject({ ditahan: null, komisiLama: 22_500, komisiBaru: 16_000, berubah: true, sasaran: true, dibayar: 516_000 });
    expect(koreksiDitahan([belum])).toEqual([]);

    // Laporan diketik kantor tanpa nota HP sama sekali: komisi Rp 0, gaji pokoknya tetap dibayar.
    const tanpaNota = unit({ ...belum, angka: 0, potong: 0, ditahan: alasanTahan({ ...tidakLengkap, angka: 0, komisiDibayar: null }) });
    expect(rencana([tanpaNota], tanpaNota.kunci)).toMatchObject({ ditahan: null, komisiBaru: 0, dibayar: 500_000 });
  });

  it("laporan konsinyasi tidak lengkap tidak pernah menahan pembayaran baris yang belum dibayar, meski unitnya bertanda begitu", () => {
    const u = unit({
      kunci: konsiReportKey("c-lama"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 16_000,
      potong: 8,
      laporanTertutup: true,
      ditahan: "LAPORAN_TIDAK_LENGKAP",
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "k", bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: null, dasarLama: true, gajiPokok: 500_000 }),
    });
    expect(rencana([u], u.kunci)).toMatchObject({ ditahan: null, sasaran: true, dibayar: 516_000 });
    expect(barisSasaranKoreksi([u])?.baris.refId).toBe("k");
    expect(koreksiDitahan([u])).toEqual([]);
  });

  it("laporan konsinyasi tidak lengkap yang dulu dibayar KURANG dari angka HP sekarang: selisih plusnya tetap dikoreksi", () => {
    const tidakLengkap = { jenis: "KONSI" as const, dasarLama: true, potongTanpaTarif: 0, laporanTidakLengkap: true };
    const sep = unit({
      kunci: konsiReportKey("c-lama"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 30_000,
      potong: 15,
      laporanTertutup: true,
      ditahan: alasanTahan({ ...tidakLengkap, komisiDibayar: 22_500, angka: 30_000 }),
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "k-lama", dibayar: true, dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: null, dasarLama: true }),
    });
    expect(sep.ditahan).toBeNull();
    expect(selisihUnit(sep)).toBe(7_500);
    const r = rencana([sep, oktoberBelumDibayar("o", 10_000)], OKT);
    expect(r).toMatchObject({ sasaran: true, jumlahKoreksi: 7_500, dibayar: 17_500 });
    expect(koreksiDitahan([sep])).toEqual([]);
  });

  it("unit ditahan yang tertutup tanpa selisih tidak terdaftar; laporan aturan baru tanpa tarif tetap dikoreksi", () => {
    const tanpaSelisih = { ...septemberDibayar("a", 22_500), ditahan: "TANPA_TARIF" as const };
    expect(koreksiDitahan([tanpaSelisih])).toEqual([]);
    // Aturan baru: angka tersimpan pun menghitung potong tanpa tarif Rp 0, jadi selisihnya jujur.
    const baru = unit({
      kunci: SEP,
      bulanJual: "2026-09",
      angka: 4_000,
      potongTanpaTarif: 3,
      laporanTertutup: true,
      baris: baris({ refId: "b", dibayar: true, dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 6_000 }),
    });
    expect(selisihUnit(baru)).toBe(-2_000);
  });
});

describe("pratinjau bulan aturan lama yang belum dicek (layar SPG)", () => {
  /** September ditetapkan bagi rata Rp 22.500 di bulan "Oktober", belum dicek dan belum ada yang dibayar. */
  const belumDicek = (over: Partial<UnitKomisiSpg> = {}) =>
    unit({
      kunci: SEP,
      bulanJual: "2026-09",
      angka: 20_000,
      potong: 10,
      baris: baris({ refId: "sari-sep", dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 15, dasarLama: true }),
      ...over,
    });
  const pratinjau = (units: UnitKomisiSpg[], kunci: string, maksPotongPersen = 50) => pratinjauSesudahDicek({ units, kunci, maksPotongPersen });

  it("yang akan dibayar sesudah dicek: komisi per SPG Rp 20.000 — angka lama Rp 22.500 hanya disebut sebagai sebelumnya", () => {
    const r = pratinjau([belumDicek()], SEP);
    expect(r).toMatchObject({ refId: "sari-sep", komisiLama: 22_500, komisiBaru: 20_000, berubah: true, sasaran: false, ditahan: null, koreksi: [], dibayar: 20_000 });
    // Penulis tetap menolaknya sebelum dicek: tidak ada rencana bayar sungguhan.
    expect(rencana([belumDicek()], SEP)).toBeNull();
    expect(rencanaBayarSemua([belumDicek()], 50).size).toBe(0);
  });

  it("tidak pernah sasaran koreksi: koreksi bulan lain tetap menunggu, tidak ikut pratinjau ini", () => {
    const okt = belumDicek({ kunci: OKT, bulanJual: "2026-10", baris: baris({ refId: "x-okt", dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 15, dasarLama: true }) });
    const agustus = unit({
      kunci: putusReportKey(TOKO, "2026-08"),
      bulanJual: "2026-08",
      angka: 40_000,
      laporanTertutup: true,
      baris: baris({ refId: "x-agu", dibayar: true, dapatDibayar: false, bulanBayar: "2026-09", komisiTersimpan: 22_500, dasarLama: true }),
    });
    const r = pratinjau([agustus, okt], OKT);
    expect(r).toMatchObject({ sasaran: false, koreksi: [], jumlahKoreksi: 0, dibayar: 20_000 });
    expect(selisihMenunggu([agustus, okt]).map((k) => [k.sumber, k.selisih])).toEqual([[putusReportKey(TOKO, "2026-08"), 17_500]]);
  });

  it("potongan beban barang hilang mengikuti batas bruto barunya, seperti saat dibayar", () => {
    const u = belumDicek({ baris: baris({ refId: "p", dapatDibayar: false, bulanBayar: "2026-10", komisiTersimpan: 22_500, potongTersimpan: 15, dasarLama: true, potonganHilang: 11_000 }) });
    expect(pratinjau([u], SEP)).toMatchObject({ potonganHilang: 10_000, dasar: 10_000, dibayar: 10_000 });
  });

  it("ditahan (potong tanpa tarif): rencana bertanda ditahan dari angka tersimpan, tanpa koreksi", () => {
    const u = belumDicek({ angka: 0, potongTanpaTarif: 10, ditahan: "TANPA_TARIF" });
    expect(pratinjau([u], SEP)).toMatchObject({ ditahan: "TANPA_TARIF", komisiLama: 22_500, koreksi: [], sasaran: false });
  });

  it("tidak untuk baris lain: yang sudah boleh dibayar, yang sudah dibayar, dan siklus yang kuncinya dibuka (tanpa bulan pembayaran)", () => {
    expect(pratinjau([oktoberBelumDibayar("o", 30_000)], OKT)).toBeNull();
    expect(pratinjau([septemberDibayar("a", 40_000)], SEP)).toBeNull();
    const dibuka = unit({
      kunci: konsiReportKey("c-buka"),
      jenis: "KONSI",
      bulanJual: "2026-09",
      angka: 22_500,
      baris: baris({ refType: REF_KOMISI_KONSI, refId: "k-buka", dapatDibayar: false, bulanBayar: null, komisiTersimpan: 22_500, potongTersimpan: null, dasarLama: true }),
    });
    expect(pratinjau([dibuka], dibuka.kunci)).toBeNull();
  });
});

describe("jendela koreksi", () => {
  it("12 bulan ke belakang dari bulan berjalan", () => {
    expect(awalJendelaKoreksi("2026-11")).toBe("2025-11");
    expect(dalamJendelaKoreksi("2025-11", "2026-11")).toBe(true);
    expect(dalamJendelaKoreksi("2025-10", "2026-11")).toBe(false);
    expect(dalamJendelaKoreksi(null, "2026-11")).toBe(false);
  });
});

describe("teks", () => {
  it("catatan koreksi dan nama laporan", () => {
    expect(teksKoreksi({ bulanJual: "2026-09", namaToko: NAMA })).toBe("Koreksi komisi penjualan September 2026 — Toko X");
    expect(labelLaporanKomisi({ bulanJual: "2026-10", namaToko: NAMA })).toBe("Komisi penjualan Oktober 2026 — Toko X");
  });

  it("jumlah koreksi bertanda, minusnya U+2212", () => {
    expect(formatKoreksi(17_500)).toBe(`+${formatIDR(17_500)}`);
    expect(formatKoreksi(-2_500)).toBe(`−${formatIDR(2_500)}`);
    expect(formatKoreksi(-2_500)).not.toContain("-");
  });

  it("kalimat kabar: koreksi yang diterapkan, lalu sisa yang dibawa; kosong tanpa keduanya", () => {
    const k: BarisKoreksi = {
      sumber: SEP,
      jenis: "PUTUS",
      storeId: TOKO,
      namaToko: NAMA,
      bulanJual: "2026-09",
      selisih: -2_500,
      diterapkan: -2_000,
      dibawa: -500,
      angka: 20_000,
      dibayarSebelum: 22_500,
      terapanSebelum: 0,
    };
    const kalimat = kalimatKoreksiKabar([k]);
    expect(kalimat).toContain(`Koreksi komisi penjualan September 2026 — Toko X −${formatIDR(2_000)}`);
    expect(kalimat).toContain(formatIDR(500));
    expect(kalimatKoreksiKabar([])).toBe("");
    expect(kalimatKoreksiKabar([{ ...k, diterapkan: 0, dibawa: 0 }])).toBe("");
  });
});
