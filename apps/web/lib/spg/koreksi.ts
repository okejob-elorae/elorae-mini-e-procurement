import { formatIDR } from "@/lib/sales-orders/format";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";
import type { AlasanTahanBayar, HasilGaji, RincianGaji } from "./gaji-pokok";
import { dariSen, keSen, REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { KOREKSI_JENDELA_BULAN } from "./komisi";

/**
 * Pembayaran gaji & komisi SPG dan koreksinya — murni, tanpa basis data, aman untuk klien
 * (keputusan pemilik 2026-11-02).
 *
 * SATU pembayaran per SPG × bulan kerja di tokonya: baris `ConsignmentCommission` (siklus konsinyasi
 * dikunci) atau `SpgCommission` (toko putus ditetapkan). Isinya gaji pokok (`lib/spg/gaji-pokok.ts`,
 * P7a–P7e, P62–P65, P70) + komisi (tarif kategori bulan penjualan × potong bersihnya sendiri,
 * `lib/spg-commission/payout.ts`). Baris yang BELUM dibayar selalu dibayar dengan angka yang dihitung
 * ulang di transaksi pembayarannya (`rencanaBayarKomisi` / `siapkanBayarKomisi`).
 *
 * TAHAN (P60). Selama dasar gaji bulan itu belum pasti, SELURUH pembayaran bulan itu menunggu —
 * gaji pokok, komisi, dan apa pun yang akan ikut (`AlasanTahanBayar`). Baris yang ditahan bukan
 * sasaran koreksi dan tidak bisa dibayar; unit koreksinya tidak membawa selisih sampai diputuskan.
 *
 * KOREKSI. Satu UNIT = satu laporan × satu SPG. Unit TERTUTUP kalau barisnya sudah dibayar, atau ia
 * tidak punya baris dan laporannya tertutup. Selisihnya per BAGIAN — komisi dan gaji pokok —
 * = angka sekarang − yang dibayar − koreksi yang sudah diterapkan; DITURUNKAN, tidak pernah
 * disimpan. Hanya unit yang bulan PENJUALANNYA masih dalam 12 bulan (P10) yang diperiksa. Selisih
 * ikut baris SASARAN SPG itu — baris belum dibayar, boleh dibayar, tidak ditahan, yang paling lama
 * (tanpa batas umur) — dan baru tertulis (`SpgCommissionCorrection`) saat baris itu dibayar.
 *
 * SUSUNAN PEMBAYARAN (B22, P5, P11, P11a, P13a). Dua kantong: komisi (komisi sekarang + bagian
 * komisi koreksi plus) dan gaji (gaji pokok sekarang + bagian gaji koreksi plus). Lalu semua
 * pengurang diambil PENUH sejauh kantongnya cukup, berurutan: koreksi minus (sasaran saja, bulan
 * penjualan terlama dulu), bagian beban barang hilang SPG itu, beban retur pembeli yang ditolak,
 * utang SPG — masing-masing dari kantong komisi dulu, baru kantong gaji. Yang dibayarkan = sisa kedua
 * kantong, tidak pernah di bawah Rp 0. Urutannya hanya menentukan mana yang masih terutang, tidak
 * pernah jumlah utangnya.
 *
 * SPG yang masih bekerja: koreksi minus yang tidak tertutup tetap selisih dan ikut pembayaran
 * berikutnya; bagian beban dan beban retur tetap terbuka. Pembayaran TERAKHIR SPG yang berhenti
 * (`akhir`): semua yang tidak tertutup menjadi utang SPG (`keUtang`) — tidak ada yang diikhlaskan
 * (P6, P6a).
 *
 * Semua uang dihitung dalam sen bulat.
 */

export type RefBarisKomisi = typeof REF_KOMISI_KONSI | typeof REF_KOMISI_SPG_PUTUS;

/** Baris resmi SPG pada satu laporan: `ConsignmentCommission` atau `SpgCommission`. */
export type BarisKomisiSpg = {
  refType: RefBarisKomisi;
  refId: string;
  dibayar: boolean;
  /** Belum dibayar dan sudah boleh dibayar: siklus terkunci; toko putus sudah dicek. */
  dapatDibayar: boolean;
  /** Bulan pembayarannya (WIB): kunci siklus atau tanda dicek. */
  bulanBayar: string | null;
  /** Komisi yang tersimpan. */
  komisiTersimpan: number;
  /** Potong yang tersimpan — toko putus saja; konsinyasi tidak menyimpannya per SPG. */
  potongTersimpan: number | null;
  /** Gaji pokok yang tersimpan (yang dibayar, kalau sudah dibayar). */
  gajiPokok: number;
  /** Potongan beban barang hilang yang tersimpan (diambil saat dibayar). */
  potonganHilang: number;
};

export type UnitKomisiSpg = {
  /** Kunci laporan: `konsi:<cycleId>` atau `putus:<storeId>:<YYYY-MM>`. */
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  namaToko: string;
  bulanJual: string;
  /** Komisi per SPG sekarang (rupiah bulat). */
  angka: number;
  /** Potong terkonfirmasi miliknya sekarang. */
  potong: number;
  potongTanpaTarif: number;
  baris: BarisKomisiSpg | null;
  /** Konsinyasi: siklusnya terkunci. Toko putus: sudah dicek. */
  laporanTertutup: boolean;
  /** Σ koreksi (komisi + gaji) yang sudah diterapkan dari unit ini. */
  koreksiTerapan: number;
  /** Σ bagian gaji pokok dari koreksi yang sudah diterapkan dari unit ini. */
  gajiTerapan: number;
  /** Gaji pokok bulan kerja unit ini sekarang; null = unit ini tidak memegang gaji (gajinya di baris lain). */
  gaji: HasilGaji | null;
  /** Sebab SELURUH pembayaran unit ini menunggu (P60) — dari `gaji`. */
  ditahan: AlasanTahanBayar | null;
  hariTahan: string[];
  /** Bulan penjualannya lebih tua dari jendela koreksi 12 bulan (P10): tidak dikoreksi lagi. */
  diLuarJendela?: boolean;
};

export type BarisKoreksi = {
  /** Kunci laporan asalnya. */
  sumber: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  namaToko: string;
  bulanJual: string;
  /** Seluruh selisihnya saat ini (komisi + gaji). */
  selisih: number;
  /** Bagian gaji pokok dari `selisih`. */
  selisihGaji: number;
  /** Yang diterapkan pada pembayaran ini (0 untuk yang hanya menunggu). */
  diterapkan: number;
  /** Bagian gaji pokok dari `diterapkan` — `SpgCommissionCorrection.salaryAmount`. */
  gajiDiterapkan: number;
  /** Bagian minus yang belum bisa diterapkan dan dibawa ke pembayaran berikutnya (≤ 0). */
  dibawa: number;
  /** Suku-suku rumusnya saat itu (disimpan sebagai potret di `SpgCommissionCorrection`). */
  angka: number;
  dibayarSebelum: number;
  terapanSebelum: number;
};

/** Satu pengurang yang diambil dari pembayaran. */
export type PotongBayar = {
  jenis: "KOREKSI" | "BARANG_HILANG" | "RETUR_PEMBELI" | "UTANG";
  /** Kunci laporan (KOREKSI), id bagian beban (BARANG_HILANG), id beban (RETUR_PEMBELI), id utang (UTANG). */
  sumber: string;
  storeId: string | null;
  /** Yang terutang sebelum pembayaran ini (positif). */
  jumlah: number;
  dariKomisi: number;
  dariGaji: number;
  /** Yang masih terutang sesudahnya (positif). */
  sisa: number;
};

/** Yang menjadi utang SPG pada pembayaran terakhirnya (B28). */
export type KeUtang = {
  koreksi: { sumber: string; jenis: "KONSI" | "PUTUS"; storeId: string; bulanJual: string; jumlah: number; gaji: number }[];
  hilang: { shareId: string; lossId: string; storeId: string | null; jumlah: number }[];
  retur: { chargeId: string; storeId: string; jumlah: number }[];
};

/** Bentuk yang dibaca modul beban retur pembeli (retur-spg-lanjutan) — turunan dari `potong`. */
export type BarisBebanDipotongRencana = {
  chargeId: string;
  storeId: string;
  sisaSebelum: number;
  diterapkan: number;
  dariKomisi: number;
  dariGaji: number;
  dibawa: number;
};

export type BarisKembaliBebanRencana = { chargeId: string; storeId: string; jumlah: number };

export type RencanaBayarKomisi = {
  refType: RefBarisKomisi;
  refId: string;
  kunci: string;
  /** Komisi yang tersimpan. */
  komisiLama: number;
  /** Komisi per SPG sekarang — yang dibayar. */
  komisiBaru: number;
  potongBaru: number;
  /** Komisi, potong, atau gaji pokok berbeda dari yang tersimpan — barisnya ditulis ulang saat dibayar. */
  berubah: boolean;
  /** Rincian gaji pokok sekarang (null: gaji bulan itu di baris lain, atau ditahan). */
  gaji: RincianGaji | null;
  /** Gaji pokok yang tersimpan. */
  gajiLama: number;
  /** Gaji pokok sekarang — yang dibayar. */
  gajiPokok: number;
  /** Komisi + gaji pokok sekarang. */
  dasar: number;
  potong: PotongBayar[];
  potonganHilang: number;
  potonganRetur: number;
  potonganUtang: number;
  /** Σ pengurang (termasuk koreksi minus) yang diambil dari kantong komisi / gaji. */
  dariKomisi: number;
  dariGaji: number;
  /** Baris ini tempat koreksi SPG itu ikut. */
  sasaran: boolean;
  koreksi: BarisKoreksi[];
  /** Σ koreksi yang diterapkan (bertanda). */
  jumlahKoreksi: number;
  /** Uang pengembalian beban retur yang ikut dibayar (P79), di luar kedua kantong. */
  kembaliBeban: BarisKembaliBebanRencana[];
  jumlahKembaliBeban: number;
  /** Yang dibayarkan, ≥ 0. */
  dibayar: number;
  /** Σ koreksi minus yang dibawa ke pembayaran berikutnya (≤ 0); 0 pada pembayaran terakhir. */
  dibawa: number;
  /** Koreksi yang menunggu ikut baris lain (sasaran SPG ini), bukan baris ini. */
  koreksiDiBarisLain: { kunci: string; bulanJual: string; namaToko: string; jumlah: number } | null;
  /** Pembayaran terakhir SPG yang berhenti. */
  akhir: boolean;
  keUtang: KeUtang | null;
  /** Menunggu (P60): baris ini TIDAK bisa dibayar; tanpa angka. */
  ditahan: AlasanTahanBayar | null;
  hariTahan: string[];
  /** Bentuk turunan untuk modul beban retur pembeli. */
  beban: BarisBebanDipotongRencana[];
  jumlahBeban: number;
};

/** Konteks pengurang SPG itu saat dibayar (dari basis data). Uang dalam sen. */
export type KonteksBayar = {
  bebanHilang: readonly { shareId: string; lossId: string; storeId: string | null; sisaSen: number }[];
  bebanRetur: readonly { chargeId: string; storeId: string; sisaSen: number }[];
  kembaliBeban?: readonly { chargeId: string; storeId: string; sen: number }[];
  utang: readonly { debtId: string; jenis: string; storeId: string | null; sisaSen: number }[];
  akhir: boolean;
};

export const KONTEKS_KOSONG: KonteksBayar = { bebanHilang: [], bebanRetur: [], kembaliBeban: [], utang: [], akhir: false };

const sen = keSen;
const rupiah = dariSen;
const tanpaMinNol = (n: number) => (n === 0 ? 0 : n);
const bandingId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/** Bulan penjualan paling tua yang masih diperiksa untuk koreksi (P10). */
export function awalJendelaKoreksi(bulanIni: string): string {
  return shiftYearMonth(bulanIni, -KOREKSI_JENDELA_BULAN);
}

export function dalamJendelaKoreksi(bulan: string | null | undefined, bulanIni: string): boolean {
  if (!bulan) return false;
  return bulan >= awalJendelaKoreksi(bulanIni);
}

export function unitTertutup(u: UnitKomisiSpg): boolean {
  return u.baris ? u.baris.dibayar : u.laporanTertutup;
}

/** Gaji pokok sekarang milik unit (0 bila gajinya di baris lain atau ditahan). */
const gajiSekarang = (u: UnitKomisiSpg): number => (u.gaji && u.gaji.ok ? u.gaji.rincian.gajiPokok : 0);

/**
 * Selisih unit yang menunggu koreksi, per bagian: komisi dan gaji pokok. Nol untuk unit yang belum
 * tertutup, yang ditahan, dan yang bulan penjualannya di luar jendela 12 bulan.
 */
export function selisihUnitRinci(u: UnitKomisiSpg): { komisi: number; gaji: number } {
  if (u.ditahan || !unitTertutup(u) || u.diLuarJendela) return { komisi: 0, gaji: 0 };
  const b = u.baris;
  const komisiDibayar = b?.dibayar ? sen(b.komisiTersimpan) : 0;
  const gajiDibayar = b?.dibayar ? sen(b.gajiPokok) : 0;
  const gajiTerapan = sen(u.gajiTerapan);
  const komisiTerapan = sen(u.koreksiTerapan) - gajiTerapan;
  return {
    komisi: tanpaMinNol(rupiah(sen(u.angka) - komisiDibayar - komisiTerapan)),
    gaji: tanpaMinNol(rupiah(sen(gajiSekarang(u)) - gajiDibayar - gajiTerapan)),
  };
}

/** Seluruh selisih unit (komisi + gaji). */
export function selisihUnit(u: UnitKomisiSpg): number {
  const r = selisihUnitRinci(u);
  return tanpaMinNol(rupiah(sen(r.komisi) + sen(r.gaji)));
}

/** Baris yang belum dibayar, boleh dibayar, dan tidak ditahan. Tanpa batas umur (spesifikasi putaran 3). */
function bisaJadiSasaran(u: UnitKomisiSpg): boolean {
  const b = u.baris;
  return Boolean(b && !u.ditahan && !b.dibayar && b.dapatDibayar);
}

const urutSasaran = (a: UnitKomisiSpg, b: UnitKomisiSpg) =>
  (a.baris?.bulanBayar ?? "9999-99").localeCompare(b.baris?.bulanBayar ?? "9999-99") ||
  a.bulanJual.localeCompare(b.bulanJual) ||
  (a.jenis === b.jenis ? 0 : a.jenis === "KONSI" ? -1 : 1) ||
  bandingId(a.baris?.refId ?? "", b.baris?.refId ?? "");

/**
 * Baris SASARAN koreksi seorang SPG: baris belum dibayar yang boleh dibayar dan tidak ditahan,
 * dengan bulan pembayaran terlama, lalu bulan penjualan terlama, konsinyasi sebelum toko putus,
 * lalu id. Membayar baris lain tidak menerapkan koreksi apa pun.
 */
export function barisSasaranKoreksi(units: readonly UnitKomisiSpg[]): { unit: UnitKomisiSpg; baris: BarisKomisiSpg } | null {
  const calon = units.filter(bisaJadiSasaran).sort(urutSasaran);
  const u = calon[0];
  return u && u.baris ? { unit: u, baris: u.baris } : null;
}

const urutKoreksi = (a: { bulanJual: string; sumber: string }, b: { bulanJual: string; sumber: string }) =>
  a.bulanJual.localeCompare(b.bulanJual) || bandingId(a.sumber, b.sumber);

const keBarisKoreksi = (
  u: UnitKomisiSpg,
  m: { selisihSen: number; selisihGajiSen: number; diterapkanSen: number; gajiDiterapkanSen: number; dibawaSen: number; dibayarSebelum: number },
): BarisKoreksi => ({
  sumber: u.kunci,
  jenis: u.jenis,
  storeId: u.storeId,
  namaToko: u.namaToko,
  bulanJual: u.bulanJual,
  selisih: tanpaMinNol(rupiah(m.selisihSen)),
  selisihGaji: tanpaMinNol(rupiah(m.selisihGajiSen)),
  diterapkan: tanpaMinNol(rupiah(m.diterapkanSen)),
  gajiDiterapkan: tanpaMinNol(rupiah(m.gajiDiterapkanSen)),
  dibawa: tanpaMinNol(rupiah(m.dibawaSen)),
  angka: u.angka,
  dibayarSebelum: m.dibayarSebelum,
  terapanSebelum: u.koreksiTerapan,
});

/** Setiap unit tertutup yang selisihnya bukan nol, bulan penjualan terlama dulu. */
export function selisihMenunggu(units: readonly UnitKomisiSpg[]): BarisKoreksi[] {
  return units
    .flatMap((u) => {
      const r = selisihUnitRinci(u);
      const s = sen(r.komisi) + sen(r.gaji);
      if (s === 0) return [];
      return [
        keBarisKoreksi(u, {
          selisihSen: s,
          selisihGajiSen: sen(r.gaji),
          diterapkanSen: 0,
          gajiDiterapkanSen: 0,
          dibawaSen: 0,
          dibayarSebelum: u.baris?.dibayar ? u.baris.komisiTersimpan + u.baris.gajiPokok : 0,
        }),
      ];
    })
    .sort(urutKoreksi);
}

/** Unit yang ditahan (P60) — kartu "menunggu" di Komisi SPG: barisnya belum bisa dibayar. */
export function unitDitahan(units: readonly UnitKomisiSpg[]): UnitKomisiSpg[] {
  return units.filter((u) => u.ditahan && u.baris && !u.baris.dibayar && u.baris.dapatDibayar).sort(urutSasaran);
}

const rencanaTahan = (u: UnitKomisiSpg, b: BarisKomisiSpg, akhir: boolean): RencanaBayarKomisi => ({
  refType: b.refType,
  refId: b.refId,
  kunci: u.kunci,
  komisiLama: b.komisiTersimpan,
  komisiBaru: 0,
  potongBaru: 0,
  berubah: false,
  gaji: null,
  gajiLama: b.gajiPokok,
  gajiPokok: 0,
  dasar: 0,
  potong: [],
  potonganHilang: 0,
  potonganRetur: 0,
  potonganUtang: 0,
  dariKomisi: 0,
  dariGaji: 0,
  sasaran: false,
  koreksi: [],
  jumlahKoreksi: 0,
  kembaliBeban: [],
  jumlahKembaliBeban: 0,
  dibayar: 0,
  dibawa: 0,
  koreksiDiBarisLain: null,
  akhir,
  keUtang: null,
  ditahan: u.ditahan,
  hariTahan: u.hariTahan,
  beban: [],
  jumlahBeban: 0,
});

/**
 * Rencana membayar satu baris (`kunci` = laporannya): gaji pokok dan komisi sekarang, koreksi yang
 * ikut, pengurang yang diambil penuh dari komisi dulu lalu gaji pokok, dan yang dibayarkan. Null
 * kalau unit itu tidak punya baris yang belum dibayar dan boleh dibayar. Halaman yang
 * memperlihatkannya dan penulis yang membayarnya memakai fungsi ini, jadi yang ditampilkan = yang
 * dibayar. Unit yang ditahan mendapat rencana bertanda `ditahan` tanpa angka.
 */
export function rencanaBayarKomisi(input: { units: readonly UnitKomisiSpg[]; kunci: string; konteks?: KonteksBayar }): RencanaBayarKomisi | null {
  const { units, kunci } = input;
  const konteks = input.konteks ?? KONTEKS_KOSONG;
  const u0 = units.find((u) => u.kunci === kunci && u.baris && !u.baris.dibayar && u.baris.dapatDibayar);
  const b = u0?.baris;
  if (!u0 || !b) return null;
  if (u0.ditahan) return rencanaTahan(u0, b, konteks.akhir);

  const gajiBaru = gajiSekarang(u0);
  const rincianGaji = u0.gaji && u0.gaji.ok ? u0.gaji.rincian : null;
  const berubah =
    sen(u0.angka) !== sen(b.komisiTersimpan) ||
    sen(gajiBaru) !== sen(b.gajiPokok) ||
    (u0.jenis === "PUTUS" && u0.potong !== b.potongTersimpan);

  let kantongKomisi = sen(u0.angka);
  let kantongGaji = sen(gajiBaru);
  const dasarSen = kantongKomisi + kantongGaji;

  const sasaranAda = barisSasaranKoreksi(units);
  const sasaran = sasaranAda !== null && sasaranAda.baris.refId === b.refId && sasaranAda.baris.refType === b.refType;

  // Koreksi per unit sebagai dua komponen bertanda (komisi, gaji). Koreksi yang dulu diterapkan dari
  // unit INI (dibayar lewat koreksi sebelum ia punya baris) ditarik di pembayarannya sendiri,
  // sasaran atau bukan — total unit ini tepat angkanya.
  type Calon = { u: UnitKomisiSpg; komisiSen: number; gajiSen: number; dibayarSebelum: number };
  const calon: Calon[] = [];
  const terapanSendiriGaji = sen(u0.gajiTerapan);
  const terapanSendiriKomisi = sen(u0.koreksiTerapan) - terapanSendiriGaji;
  if (terapanSendiriKomisi !== 0 || terapanSendiriGaji !== 0) {
    calon.push({ u: u0, komisiSen: -terapanSendiriKomisi, gajiSen: -terapanSendiriGaji, dibayarSebelum: u0.angka + gajiBaru });
  }
  if (sasaran) {
    for (const u of units) {
      if (u === u0) continue;
      const r = selisihUnitRinci(u);
      if (sen(r.komisi) === 0 && sen(r.gaji) === 0) continue;
      calon.push({
        u,
        komisiSen: sen(r.komisi),
        gajiSen: sen(r.gaji),
        dibayarSebelum: u.baris?.dibayar ? u.baris.komisiTersimpan + u.baris.gajiPokok : 0,
      });
    }
  }
  calon.sort((x, y) => urutKoreksi({ bulanJual: x.u.bulanJual, sumber: x.u.kunci }, { bulanJual: y.u.bulanJual, sumber: y.u.kunci }));

  // 1. Setiap komponen PLUS mengisi kantongnya sendiri, penuh.
  const terapKomisi = new Map<Calon, number>();
  const terapGaji = new Map<Calon, number>();
  for (const c of calon) {
    if (c.komisiSen > 0) {
      kantongKomisi += c.komisiSen;
      terapKomisi.set(c, c.komisiSen);
    }
    if (c.gajiSen > 0) {
      kantongGaji += c.gajiSen;
      terapGaji.set(c, c.gajiSen);
    }
  }

  /** Ambil `perlu` sen dari kantong komisi dulu, lalu gaji (P5). */
  const ambil = (perlu: number): { dariKomisi: number; dariGaji: number } => {
    const dariKomisi = Math.min(Math.max(0, kantongKomisi), perlu);
    kantongKomisi -= dariKomisi;
    const dariGaji = Math.min(Math.max(0, kantongGaji), perlu - dariKomisi);
    kantongGaji -= dariGaji;
    return { dariKomisi, dariGaji };
  };

  const potong: PotongBayar[] = [];
  let dariKomisiSen = 0;
  let dariGajiSen = 0;
  const catat = (jenis: PotongBayar["jenis"], sumber: string, storeId: string | null, perluSen: number) => {
    const a = ambil(perluSen);
    dariKomisiSen += a.dariKomisi;
    dariGajiSen += a.dariGaji;
    const diambil = a.dariKomisi + a.dariGaji;
    potong.push({ jenis, sumber, storeId, jumlah: rupiah(perluSen), dariKomisi: rupiah(a.dariKomisi), dariGaji: rupiah(a.dariGaji), sisa: rupiah(perluSen - diambil) });
    return diambil;
  };

  // 2a. Komponen MINUS koreksi, bulan penjualan terlama dulu; dalam satu unit komisi dulu, lalu gaji.
  const dibawa = new Map<Calon, number>();
  const sisaMinus = new Map<Calon, { komisi: number; gaji: number }>();
  for (const c of calon) {
    const negKomisi = c.komisiSen < 0 ? -c.komisiSen : 0;
    const negGaji = c.gajiSen < 0 ? -c.gajiSen : 0;
    if (negKomisi + negGaji === 0) continue;
    const diambil = catat("KOREKSI", c.u.kunci, c.u.storeId, negKomisi + negGaji);
    const diambilKomisi = Math.min(diambil, negKomisi);
    const diambilGaji = diambil - diambilKomisi;
    if (diambilKomisi > 0) terapKomisi.set(c, (terapKomisi.get(c) ?? 0) - diambilKomisi);
    if (diambilGaji > 0) terapGaji.set(c, (terapGaji.get(c) ?? 0) - diambilGaji);
    dibawa.set(c, -(negKomisi + negGaji - diambil));
    sisaMinus.set(c, { komisi: negKomisi - diambilKomisi, gaji: negGaji - diambilGaji });
  }
  // 2b–2d. Beban barang hilang, beban retur pembeli, utang — pada pembayaran mana pun, penuh.
  let hilangSen = 0;
  for (const h of konteks.bebanHilang) if (h.sisaSen > 0) hilangSen += catat("BARANG_HILANG", h.shareId, h.storeId, h.sisaSen);
  let returSen = 0;
  for (const r of konteks.bebanRetur) if (r.sisaSen > 0) returSen += catat("RETUR_PEMBELI", r.chargeId, r.storeId, r.sisaSen);
  let utangSen = 0;
  for (const d of konteks.utang) if (d.sisaSen > 0) utangSen += catat("UTANG", d.debtId, d.storeId, d.sisaSen);

  const kembali = (konteks.kembaliBeban ?? []).filter((k) => k.sen > 0);
  const kembaliSen = kembali.reduce((n, k) => n + k.sen, 0);
  const dibayarSen = Math.max(0, kantongKomisi) + Math.max(0, kantongGaji) + kembaliSen;

  const koreksi: BarisKoreksi[] = calon.map((c) => {
    const tk = terapKomisi.get(c) ?? 0;
    const tg = terapGaji.get(c) ?? 0;
    return keBarisKoreksi(c.u, {
      selisihSen: c.komisiSen + c.gajiSen,
      selisihGajiSen: c.gajiSen,
      diterapkanSen: tk + tg,
      gajiDiterapkanSen: tg,
      dibawaSen: konteks.akhir ? 0 : (dibawa.get(c) ?? 0),
      dibayarSebelum: c.dibayarSebelum,
    });
  });
  koreksi.sort(urutKoreksi);
  const jumlahKoreksiSen = koreksi.reduce((n, k) => n + sen(k.diterapkan), 0);
  const dibawaSen = koreksi.reduce((n, k) => n + sen(k.dibawa), 0);

  let keUtang: KeUtang | null = null;
  if (konteks.akhir) {
    const sisaDari = (jenis: PotongBayar["jenis"], sumber: string) => potong.find((p) => p.jenis === jenis && p.sumber === sumber)?.sisa ?? 0;
    keUtang = {
      koreksi: calon.flatMap((c) => {
        const s = sisaMinus.get(c);
        if (!s || s.komisi + s.gaji <= 0) return [];
        return [{ sumber: c.u.kunci, jenis: c.u.jenis, storeId: c.u.storeId, bulanJual: c.u.bulanJual, jumlah: rupiah(s.komisi + s.gaji), gaji: rupiah(s.gaji) }];
      }),
      hilang: konteks.bebanHilang.flatMap((h) => {
        const s = sisaDari("BARANG_HILANG", h.shareId);
        return sen(s) > 0 ? [{ shareId: h.shareId, lossId: h.lossId, storeId: h.storeId, jumlah: s }] : [];
      }),
      retur: konteks.bebanRetur.flatMap((r) => {
        const s = sisaDari("RETUR_PEMBELI", r.chargeId);
        return sen(s) > 0 ? [{ chargeId: r.chargeId, storeId: r.storeId, jumlah: s }] : [];
      }),
    };
  }

  let koreksiDiBarisLain: RencanaBayarKomisi["koreksiDiBarisLain"] = null;
  if (!sasaran && sasaranAda) {
    const tunggu = selisihMenunggu(units).filter((k) => k.sumber !== u0.kunci);
    if (tunggu.length > 0) {
      koreksiDiBarisLain = {
        kunci: sasaranAda.unit.kunci,
        bulanJual: sasaranAda.unit.bulanJual,
        namaToko: sasaranAda.unit.namaToko,
        jumlah: rupiah(tunggu.reduce((n, k) => n + sen(k.selisih), 0)),
      };
    }
  }

  const beban: BarisBebanDipotongRencana[] = potong
    .filter((p) => p.jenis === "RETUR_PEMBELI")
    .map((p) => ({
      chargeId: p.sumber,
      storeId: p.storeId ?? "",
      sisaSebelum: p.jumlah,
      diterapkan: rupiah(sen(p.dariKomisi) + sen(p.dariGaji)),
      dariKomisi: p.dariKomisi,
      dariGaji: p.dariGaji,
      dibawa: p.sisa,
    }));

  return {
    refType: b.refType,
    refId: b.refId,
    kunci: u0.kunci,
    komisiLama: b.komisiTersimpan,
    komisiBaru: u0.angka,
    potongBaru: u0.potong,
    berubah,
    gaji: rincianGaji,
    gajiLama: b.gajiPokok,
    gajiPokok: gajiBaru,
    dasar: rupiah(dasarSen),
    potong,
    potonganHilang: rupiah(hilangSen),
    potonganRetur: rupiah(returSen),
    potonganUtang: rupiah(utangSen),
    dariKomisi: rupiah(dariKomisiSen),
    dariGaji: rupiah(dariGajiSen),
    sasaran,
    koreksi,
    jumlahKoreksi: tanpaMinNol(rupiah(jumlahKoreksiSen)),
    kembaliBeban: kembali.map((k) => ({ chargeId: k.chargeId, storeId: k.storeId, jumlah: rupiah(k.sen) })),
    jumlahKembaliBeban: rupiah(kembaliSen),
    dibayar: rupiah(dibayarSen),
    dibawa: tanpaMinNol(rupiah(dibawaSen)),
    koreksiDiBarisLain,
    akhir: konteks.akhir,
    keUtang,
    ditahan: null,
    hariTahan: [],
    beban,
    jumlahBeban: rupiah(returSen),
  };
}

/**
 * Rencana bayar setiap baris yang belum dibayar dan boleh dibayar, menurut id barisnya. Pengurang
 * SPG itu (`konteks`) ditampilkan pada setiap barisnya — mana pun yang dibayar lebih dulu yang
 * mengambilnya. `akhir(refId)`: baris itu pembayaran terakhir SPG yang berhenti.
 */
export function rencanaBayarSemua(
  units: readonly UnitKomisiSpg[],
  konteks: Omit<KonteksBayar, "akhir"> & { akhir?: (refId: string) => boolean } = { bebanHilang: [], bebanRetur: [], kembaliBeban: [], utang: [] },
): Map<string, RencanaBayarKomisi> {
  const hasil = new Map<string, RencanaBayarKomisi>();
  for (const u of units) {
    if (!u.baris || u.baris.dibayar || !u.baris.dapatDibayar) continue;
    const akhir = konteks.akhir ? konteks.akhir(u.baris.refId) : false;
    const r = rencanaBayarKomisi({ units, kunci: u.kunci, konteks: { ...konteks, akhir } });
    if (r) hasil.set(r.refId, r);
  }
  return hasil;
}

/** "Koreksi komisi penjualan September 2026 — Toko X" — catatan baris koreksi. */
export function teksKoreksi(k: { bulanJual: string; namaToko: string; gajiDiterapkan?: number }): string {
  const apa = k.gajiDiterapkan && sen(k.gajiDiterapkan) !== 0 ? "Koreksi gaji & komisi" : "Koreksi komisi";
  return `${apa} penjualan ${salesMonthLabelId(k.bulanJual)} — ${k.namaToko}`;
}

/** "Komisi penjualan Oktober 2026 — Toko X" — nama sebuah laporan pembayaran. */
export function labelLaporanKomisi(k: { bulanJual: string; namaToko: string }): string {
  return `Komisi penjualan ${salesMonthLabelId(k.bulanJual)} — ${k.namaToko}`;
}

/** "+Rp 17.500" / "−Rp 2.500" (tanda minus U+2212). */
export function formatKoreksi(n: number): string {
  return sen(n) < 0 ? `−${formatIDR(rupiah(-sen(n)))}` : `+${formatIDR(rupiah(sen(n)))}`;
}

/**
 * Kalimat koreksi untuk kabar pembayaran: setiap koreksi yang diterapkan (menyebut bagian gaji
 * pokoknya), dan sisa minus yang dibawa.
 */
export function kalimatKoreksiKabar(k: readonly BarisKoreksi[]): string {
  const terap = k.filter((x) => sen(x.diterapkan) !== 0);
  const dibawaSen = k.reduce((n, x) => n + sen(x.dibawa), 0);
  const bagian: string[] = [];
  if (terap.length > 0) bagian.push(`Termasuk ${terap.map((x) => `${teksKoreksi(x)} ${formatKoreksi(x.diterapkan)}`).join("; ")}.`);
  if (dibawaSen < 0) bagian.push(`Sisa koreksi ${formatIDR(rupiah(-dibawaSen))} dikurangkan dari pembayaran berikutnya.`);
  return bagian.join(" ");
}

/** Kalimat pengurang untuk kabar pembayaran: beban barang hilang, beban retur, utang — dari komisi / gaji. */
export function kalimatPotongKabar(r: Pick<RencanaBayarKomisi, "potonganHilang" | "potonganRetur" | "potonganUtang" | "dariGaji">): string {
  const bagian: string[] = [];
  if (r.potonganHilang > 0) bagian.push(`beban barang hilang ${formatIDR(r.potonganHilang)}`);
  if (r.potonganRetur > 0) bagian.push(`beban retur pembeli ${formatIDR(r.potonganRetur)}`);
  if (r.potonganUtang > 0) bagian.push(`utang ${formatIDR(r.potonganUtang)}`);
  if (bagian.length === 0) return "";
  return `Dipotong ${bagian.join(", ")}${r.dariGaji > 0 ? ` (sebagian dari gaji pokok ${formatIDR(r.dariGaji)})` : ""}.`;
}
