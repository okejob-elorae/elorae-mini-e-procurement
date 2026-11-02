import { formatIDR } from "@/lib/sales-orders/format";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";
import { batasPotongSen, dariSen, keSen, REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { KOREKSI_JENDELA_BULAN } from "./komisi";

/**
 * Pembayaran komisi SPG dan koreksinya — murni, tanpa basis data, aman untuk klien.
 *
 * Satu aturan (keputusan pemilik 2026-11-02, "jangan ada harga rata-rata"): komisi seorang SPG
 * pada satu laporan = tarif kategori bulan penjualan × potong bersih terkonfirmasi miliknya sendiri
 * (`lib/spg-commission/payout.ts`). Di atasnya dua mekanisme:
 *
 * 1. BAYAR DENGAN ANGKA SEKARANG. Baris yang belum dibayar — toko putus maupun konsinyasi, aturan
 *    lama maupun baru — selalu dibayar dengan angka per SPG saat ditandai dibayar (`komisiBaru`),
 *    kecuali yang ditahan (di bawah). Angka tersimpan yang berbeda dicoret; potongan beban barang
 *    hilang dipertahankan, atau diturunkan sampai batas bruto barunya (tidak pernah dinaikkan).
 * 2. KOREKSI. Satu UNIT = satu laporan × satu SPG. Unit TERTUTUP kalau barisnya sudah dibayar, atau
 *    ia tidak punya baris dan laporannya tertutup. Selisihnya = angka sekarang − yang dibayar −
 *    koreksi yang sudah diterapkan dari unit itu; DITURUNKAN, tidak pernah disimpan. Selisih
 *    menunggu hanya ikut baris SASARAN SPG itu — baris belum dibayar yang paling lama — dan baru
 *    tertulis (`SpgCommissionCorrection`) saat baris itu ditandai dibayar. Koreksi plus diterapkan
 *    penuh; koreksi minus, bulan penjualan terlama dulu, hanya sejauh pembayarannya tetap ≥ Rp 0 —
 *    sisanya tetap selisih dan ikut pembayaran sesudahnya dengan sendirinya.
 *
 * PENAHANAN. Satu unit laporan ATURAN LAMA (tarif barang, dibagi rata) TIDAK dikoreksi dan TIDAK
 * diganti otomatis kalau angka sekarang tidak bisa dibandingkan jujur dengan uang yang dihitung
 * dengan aturan lain (`alasanTahan`) — ia menunggu keputusan pemilik:
 *    - `TANPA_TARIF`: sebagian potongnya di laporan itu tanpa tarif kategori. Tabel tarif baru ada
 *      sejak 2026-10 dan bulan yang sudah lewat tidak bisa diberi tarif (`setRate` → MONTH_CLOSED),
 *      jadi bulan aturan lama hampir selalu terbaca Rp 0 — memakainya menarik kembali seluruh bagi
 *      rata yang sudah dibayar, bukan +Rp 17.500 / −Rp 2.500 seperti contoh pemilik. Baris belum
 *      dibayarnya juga TIDAK dibayar (tidak dengan angka lama, tidak dengan Rp 0) — satu-satunya
 *      sebab yang menahan pembayaran (`MENAHAN_PEMBAYARAN`).
 *    - `LAPORAN_TIDAK_LENGKAP` (konsinyasi): angka resmi siklusnya tidak seluruhnya tercatat di HP
 *      SPG (ada baris diketik tanpa barang, atau potong HP < angka resmi), DAN baris SPG itu sudah
 *      dibayar LEBIH dari angka sekarangnya. Komisi konsinyasi dari potong HP saja (dibatasi angka
 *      resmi; laporan yang diketik kantor tanpa nota HP = Rp 0) adalah aturan hari ini yang masih
 *      ditanyakan ke pemilik (Q7), jadi ia berlaku seperti biasa: baris yang BELUM dibayar dibayar
 *      dengan aturan itu, gaji pokoknya ikut, dan selisih plus tetap dikoreksi (potong HP batas
 *      bawahnya). Yang ditahan hanya uang yang dulu dibayar dari angka resmi: ia tidak ditarik
 *      kembali lewat koreksi sampai Q7 dijawab.
 *    Laporan aturan baru tidak pernah ditahan: potong tanpa tarif di sana juga Rp 0 di angka
 *    tersimpannya, jadi selisihnya jujur.
 *
 * Semua uang dihitung dalam sen bulat.
 */

export type RefBarisKomisi = typeof REF_KOMISI_KONSI | typeof REF_KOMISI_SPG_PUTUS;

/** Sebab sebuah unit menunggu keputusan pemilik (`alasanTahan`). */
export type AlasanTahanKoreksi = "TANPA_TARIF" | "LAPORAN_TIDAK_LENGKAP";

/** Baris resmi SPG pada satu laporan: `ConsignmentCommission` atau `SpgCommission`. */
export type BarisKomisiSpg = {
  refType: RefBarisKomisi;
  refId: string;
  dibayar: boolean;
  /** Belum dibayar dan sudah boleh dibayar: siklus terkunci; toko putus dicek, atau sebagian bulannya sudah dibayar. */
  dapatDibayar: boolean;
  /** Bulan pembayarannya (WIB): kunci siklus, tanda dicek, atau penetapan terakhir aturan lama. */
  bulanBayar: string | null;
  /** Komisi kotor yang tersimpan (sebelum potongan). */
  komisiTersimpan: number;
  /** Potong yang tersimpan — toko putus saja; konsinyasi tidak menyimpannya per SPG. */
  potongTersimpan: number | null;
  /** Ditetapkan/dikunci dengan aturan lama (tarif barang, bagi rata). */
  dasarLama: boolean;
  gajiPokok: number;
  /** Potongan beban barang hilang yang tersimpan. */
  potonganHilang: number;
  /** Bulan pembayarannya di dalam jendela koreksi — hanya baris itu yang bisa menjadi sasaran koreksi. */
  dalamJendela: boolean;
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
  /** Konsinyasi: siklusnya terkunci. Toko putus: sudah ada baris toko × bulan itu yang dibayar. */
  laporanTertutup: boolean;
  /** Σ koreksi yang sudah diterapkan dari unit ini. */
  koreksiTerapan: number;
  /**
   * Menunggu keputusan pemilik (`alasanTahan`): tanpa selisih. Baris belum dibayarnya hanya
   * tertahan (bukan sasaran, tidak dibayar) oleh sebab yang menahan pembayaran (`alasanTahanBayar`).
   */
  ditahan: AlasanTahanKoreksi | null;
};

export type BarisKoreksi = {
  /** Kunci laporan asalnya. */
  sumber: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  namaToko: string;
  bulanJual: string;
  /** Seluruh selisihnya saat ini. */
  selisih: number;
  /** Yang diterapkan pada pembayaran ini (0 untuk yang hanya menunggu). */
  diterapkan: number;
  /** Bagian minus yang belum bisa diterapkan dan dibawa ke pembayaran berikutnya (≤ 0). */
  dibawa: number;
  /** Suku-suku rumusnya saat itu (disimpan sebagai potret di `SpgCommissionCorrection`). */
  angka: number;
  dibayarSebelum: number;
  terapanSebelum: number;
};

export type RencanaBayarKomisi = {
  refType: RefBarisKomisi;
  refId: string;
  kunci: string;
  /** Komisi yang tersimpan. */
  komisiLama: number;
  /** Komisi per SPG sekarang — yang dibayar. */
  komisiBaru: number;
  potongBaru: number;
  /** Baris diganti saat dibayar (angka, potong, atau dasar aturan lama). */
  berubah: boolean;
  gajiPokok: number;
  /** Potongan beban barang hilang yang dipakai (tidak pernah lebih dari yang tersimpan). */
  potonganHilang: number;
  /** gaji + komisi baru − potongan, ≥ 0. */
  dasar: number;
  /** Baris ini tempat koreksi SPG itu ikut. */
  sasaran: boolean;
  koreksi: BarisKoreksi[];
  jumlahKoreksi: number;
  /** Yang dibayarkan: dasar + Σ koreksi diterapkan, ≥ 0. */
  dibayar: number;
  /** Σ koreksi minus yang dibawa ke pembayaran berikutnya (≤ 0). */
  dibawa: number;
  /** Koreksi yang menunggu ikut baris lain (sasaran SPG ini), bukan baris ini. */
  koreksiDiBarisLain: { kunci: string; bulanJual: string; namaToko: string; jumlah: number } | null;
  /**
   * Menunggu keputusan pemilik: baris ini TIDAK bisa dibayar (penulis menolaknya dengan kode ini).
   * Rencananya hanya untuk tampilan — dari angka tersimpan, tanpa koreksi. Hanya sebab yang menahan
   * pembayaran (`MENAHAN_PEMBAYARAN`, kini `TANPA_TARIF`) — tidak pernah `LAPORAN_TIDAK_LENGKAP`.
   */
  ditahan: AlasanTahanKoreksi | null;
};

/** Unit yang menunggu keputusan pemilik — kartu "Koreksi komisi", bagian "perlu keputusan". */
export type KoreksiDitahan = {
  sumber: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  namaToko: string;
  bulanJual: string;
  alasan: AlasanTahanKoreksi;
  /** Selisih yang AKAN ada kalau angka sekarang dipakai — hanya informasi. */
  selisih: number;
  potongTanpaTarif: number;
  /** Baris yang belum dibayar dan pembayarannya tertahan (bukan selisih sesudah dibayar). */
  belumDibayar: boolean;
};

const sen = keSen;
const rupiah = dariSen;
const tanpaMinNol = (n: number) => (n === 0 ? 0 : n);
const bandingId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/** Bulan penjualan/pembayaran paling tua yang masih masuk jendela koreksi. */
export function awalJendelaKoreksi(bulanIni: string): string {
  return shiftYearMonth(bulanIni, -KOREKSI_JENDELA_BULAN);
}

/**
 * Satu definisi jendela untuk sasaran koreksi, untuk kartu #tunggakan, dan untuk baris Beranda
 * `spgCommissionsUnpaidPast`: tunggakan yang bulan pembayarannya lebih tua didaftar terpisah
 * ("lebih dari 12 bulan"), tidak pernah menjadi sasaran koreksi, dan tidak dihitung di Beranda.
 */
export function dalamJendelaKoreksi(bulan: string | null | undefined, bulanIni: string): boolean {
  if (!bulan) return false;
  return bulan >= awalJendelaKoreksi(bulanIni);
}

/**
 * Sebab sebuah unit menunggu keputusan pemilik, atau null. Hanya laporan aturan lama
 * (`dasarLama`): potong tanpa tarif kategori (`TANPA_TARIF`), atau — konsinyasi — angka resmi yang
 * tidak seluruhnya tercatat di HP pada baris yang sudah dibayar lebih dari angka sekarangnya
 * (`LAPORAN_TIDAK_LENGKAP`). Lihat penjelasan di kepala berkas.
 *
 * `komisiDibayar` = komisi tersimpan baris SPG itu kalau barisnya SUDAH dibayar; null kalau belum
 * dibayar atau ia tidak punya baris di laporan itu — baris seperti itu tidak pernah ditahan karena
 * laporannya tidak lengkap. Pemanggil yang tidak mengisinya mendapat bacaan paling hati-hati (setiap
 * unit siklus aturan lama yang tidak lengkap ditahan); setiap pemuat dan penulis mengisinya.
 */
export function alasanTahan(u: {
  jenis: "KONSI" | "PUTUS";
  dasarLama: boolean;
  potongTanpaTarif: number;
  laporanTidakLengkap: boolean;
  komisiDibayar?: number | null;
  /** Komisi per SPG sekarang, dibandingkan dengan `komisiDibayar`. */
  angka?: number;
}): AlasanTahanKoreksi | null {
  if (!u.dasarLama) return null;
  if (u.potongTanpaTarif > 0) return "TANPA_TARIF";
  if (u.jenis !== "KONSI" || !u.laporanTidakLengkap) return null;
  if (u.komisiDibayar === undefined) return "LAPORAN_TIDAK_LENGKAP";
  if (u.komisiDibayar === null) return null;
  // Angka sekarang ≥ yang dibayar: tidak ada yang ditarik kembali; selisih plusnya jujur (batas bawah).
  return sen(u.angka ?? 0) < sen(u.komisiDibayar) ? "LAPORAN_TIDAK_LENGKAP" : null;
}

/**
 * Sebab mana yang juga menahan PEMBAYARAN baris yang belum dibayar — gaji pokok konsinyasinya ikut.
 * Hanya `TANPA_TARIF`: `LAPORAN_TIDAK_LENGKAP` hanya menahan koreksi atas uang yang sudah dibayar
 * (Q7), dan baris yang belum dibayar dibayar dengan aturan hari ini.
 */
export const MENAHAN_PEMBAYARAN: Readonly<Record<AlasanTahanKoreksi, boolean>> = {
  TANPA_TARIF: true,
  LAPORAN_TIDAK_LENGKAP: false,
};

/** Sebab yang menahan pembayaran baris yang belum dibayar (`MENAHAN_PEMBAYARAN`), atau null. */
export function alasanTahanBayar(a: AlasanTahanKoreksi | null | undefined): AlasanTahanKoreksi | null {
  return a && MENAHAN_PEMBAYARAN[a] ? a : null;
}

export function unitTertutup(u: UnitKomisiSpg): boolean {
  return u.baris ? u.baris.dibayar : u.laporanTertutup;
}

/** Angka atau potongnya berbeda dari yang tersimpan (bukan sekadar dasar aturan lama). */
function angkaBerbeda(u: UnitKomisiSpg): boolean {
  const b = u.baris;
  if (!b) return u.angka !== 0;
  return sen(u.angka) !== sen(b.komisiTersimpan) || (u.jenis === "PUTUS" && u.potong !== b.potongTersimpan);
}

/**
 * Selisih unit yang menunggu koreksi: angka sekarang − yang dibayar − koreksi yang sudah
 * diterapkan. Nol untuk unit yang belum tertutup, dan untuk unit yang ditahan (`koreksiDitahan`).
 */
export function selisihUnit(u: UnitKomisiSpg): number {
  if (u.ditahan || !unitTertutup(u)) return 0;
  return tanpaMinNol(rupiah(sen(u.angka) - (u.baris?.dibayar ? sen(u.baris.komisiTersimpan) : 0) - sen(u.koreksiTerapan)));
}

/** Baris yang belum dibayar, boleh dibayar, pembayarannya tidak ditahan, dan bulan pembayarannya di jendela koreksi. */
function bisaJadiSasaran(u: UnitKomisiSpg): boolean {
  const b = u.baris;
  return Boolean(b && !alasanTahanBayar(u.ditahan) && !b.dibayar && b.dapatDibayar && b.dalamJendela);
}

const urutSasaran = (a: UnitKomisiSpg, b: UnitKomisiSpg) =>
  (a.baris?.bulanBayar ?? "9999-99").localeCompare(b.baris?.bulanBayar ?? "9999-99") ||
  a.bulanJual.localeCompare(b.bulanJual) ||
  (a.jenis === b.jenis ? 0 : a.jenis === "KONSI" ? -1 : 1) ||
  bandingId(a.baris?.refId ?? "", b.baris?.refId ?? "");

/**
 * Baris SASARAN koreksi seorang SPG: baris belum dibayar yang boleh dibayar (dan tidak ditahan),
 * bulan pembayarannya di jendela koreksi, dengan bulan pembayaran terlama, lalu bulan penjualan
 * terlama, konsinyasi sebelum toko putus, lalu id. Membayar baris lain tidak menerapkan koreksi apa pun.
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
  selisih: number,
  diterapkan: number,
  dibawa: number,
  dibayarSebelum: number = u.baris?.dibayar ? u.baris.komisiTersimpan : 0,
): BarisKoreksi => ({
  sumber: u.kunci,
  jenis: u.jenis,
  storeId: u.storeId,
  namaToko: u.namaToko,
  bulanJual: u.bulanJual,
  selisih: tanpaMinNol(selisih),
  diterapkan: tanpaMinNol(diterapkan),
  dibawa: tanpaMinNol(dibawa),
  angka: u.angka,
  dibayarSebelum,
  terapanSebelum: u.koreksiTerapan,
});

/** Setiap unit tertutup yang selisihnya bukan nol, bulan penjualan terlama dulu. */
export function selisihMenunggu(units: readonly UnitKomisiSpg[]): BarisKoreksi[] {
  return units
    .flatMap((u) => {
      const s = selisihUnit(u);
      return s === 0 ? [] : [keBarisKoreksi(u, s, 0, 0)];
    })
    .sort(urutKoreksi);
}

/**
 * Unit yang menunggu keputusan pemilik, bulan penjualan terlama dulu: setiap baris belum dibayar
 * yang sebenarnya sudah boleh dibayar tetapi ditahan (`belumDibayar`; `selisih` = angka sekarang −
 * angka tersimpannya), dan setiap unit tertutup yang ditahan dengan selisih bukan nol (angka
 * sekarang − yang dibayar − yang sudah diterapkan). `selisih` hanya informasi — tidak pernah
 * diterapkan. Baris yang belum dibayar hanya terdaftar karena sebab yang menahan pembayarannya
 * (`alasanTahanBayar`) — sama dengan `rencanaBayarKomisi`, yang membayar baris lainnya.
 */
export function koreksiDitahan(units: readonly UnitKomisiSpg[]): KoreksiDitahan[] {
  return units
    .flatMap((u): KoreksiDitahan[] => {
      const b = u.baris;
      const alasan = b && !b.dibayar ? alasanTahanBayar(u.ditahan) : u.ditahan;
      if (!alasan) return [];
      const belumDibayar = Boolean(b && !b.dibayar && b.dapatDibayar);
      let selisihSen = 0;
      if (b && !b.dibayar) selisihSen = sen(u.angka) - sen(b.komisiTersimpan) - sen(u.koreksiTerapan);
      else if (unitTertutup(u)) selisihSen = sen(u.angka) - (b?.dibayar ? sen(b.komisiTersimpan) : 0) - sen(u.koreksiTerapan);
      if (!belumDibayar && selisihSen === 0) return [];
      return [
        {
          sumber: u.kunci,
          jenis: u.jenis,
          storeId: u.storeId,
          namaToko: u.namaToko,
          bulanJual: u.bulanJual,
          alasan,
          selisih: tanpaMinNol(rupiah(selisihSen)),
          potongTanpaTarif: u.potongTanpaTarif,
          belumDibayar,
        },
      ];
    })
    .sort(urutKoreksi);
}

/**
 * Rencana membayar satu baris (`kunci` = laporannya): angka per SPG sekarang, potongan beban
 * barang hilang yang dipakai, koreksi yang ikut, dan yang dibayarkan. Null kalau unit itu tidak
 * punya baris yang belum dibayar dan boleh dibayar. Halaman yang memperlihatkannya dan penulis yang
 * membayarnya memakai fungsi ini, jadi yang ditampilkan = yang dibayar. Unit yang pembayarannya
 * ditahan (`alasanTahanBayar`) mendapat rencana bertanda `ditahan` yang tidak bisa dibayar; baris
 * siklus yang laporannya tidak lengkap (Q7) dibayar seperti biasa, dengan angka per SPG sekarang.
 *
 * Potongan beban barang hilang = yang tersimpan, atau batas bruto barunya kalau lebih kecil
 * (aturan batas sekarang) — penulis menurunkannya di transaksi yang sama setiap kali angka ini
 * lebih kecil dari yang tersimpan, berubah atau tidak komisinya, jadi baris yang dibayar, jurnal,
 * dan kabarnya sama dengan yang dilihat kantor.
 */
export function rencanaBayarKomisi(input: {
  units: readonly UnitKomisiSpg[];
  kunci: string;
  maksPotongPersen: number;
}): RencanaBayarKomisi | null {
  const { units, kunci, maksPotongPersen } = input;
  const u0 = units.find((u) => u.kunci === kunci && u.baris && !u.baris.dibayar && u.baris.dapatDibayar);
  const b = u0?.baris;
  if (!u0 || !b) return null;

  const tahanBayar = alasanTahanBayar(u0.ditahan);
  if (tahanBayar) {
    // Ditahan: tidak bisa dibayar. Hanya tampilan, dari angka tersimpan — bukan angka sekarang yang
    // belum diputuskan — tanpa koreksi apa pun.
    const potongTersimpanSen = Math.max(0, sen(b.potonganHilang));
    const dasarTahanSen = Math.max(0, sen(b.gajiPokok) + sen(b.komisiTersimpan) - potongTersimpanSen);
    return {
      refType: b.refType,
      refId: b.refId,
      kunci: u0.kunci,
      komisiLama: b.komisiTersimpan,
      komisiBaru: u0.angka,
      potongBaru: u0.potong,
      berubah: false,
      gajiPokok: b.gajiPokok,
      potonganHilang: rupiah(potongTersimpanSen),
      dasar: rupiah(dasarTahanSen),
      sasaran: false,
      koreksi: [],
      jumlahKoreksi: 0,
      dibayar: rupiah(dasarTahanSen),
      dibawa: 0,
      koreksiDiBarisLain: null,
      ditahan: tahanBayar,
    };
  }

  const berubah = angkaBerbeda(u0) || (u0.jenis === "PUTUS" && b.dasarLama);

  const brutoSen = sen(b.gajiPokok) + sen(u0.angka);
  const potonganSen = Math.min(sen(b.potonganHilang), batasPotongSen(rupiah(brutoSen), maksPotongPersen));
  const dasarSen = Math.max(0, brutoSen - potonganSen);

  const sasaranAda = barisSasaranKoreksi(units);
  const sasaran = sasaranAda !== null && sasaranAda.baris.refId === b.refId && sasaranAda.baris.refType === b.refType;

  // Koreksi yang dulu sudah diterapkan dari unit INI (dibayar lewat koreksi sebelum ia punya baris)
  // ditarik di pembayarannya sendiri, sasaran atau bukan — total unit ini tepat angkanya.
  const calon: { u: UnitKomisiSpg; selisihSen: number }[] = [];
  if (sen(u0.koreksiTerapan) !== 0) calon.push({ u: u0, selisihSen: -sen(u0.koreksiTerapan) });
  // Unit yang dibayar sekarang: "yang dibayar" = angka barunya.
  const dibayarSebelum = (u: UnitKomisiSpg) => (u === u0 ? u0.angka : u.baris?.dibayar ? u.baris.komisiTersimpan : 0);
  if (sasaran) {
    for (const u of units) {
      if (u === u0) continue;
      const s = sen(selisihUnit(u));
      if (s !== 0) calon.push({ u, selisihSen: s });
    }
  }
  const urut = (x: { u: UnitKomisiSpg }, y: { u: UnitKomisiSpg }) => urutKoreksi({ bulanJual: x.u.bulanJual, sumber: x.u.kunci }, { bulanJual: y.u.bulanJual, sumber: y.u.kunci });

  let berjalan = dasarSen;
  let dibawaSen = 0;
  const koreksi: BarisKoreksi[] = [];
  for (const c of calon.filter((c) => c.selisihSen > 0).sort(urut)) {
    berjalan += c.selisihSen;
    koreksi.push(keBarisKoreksi(c.u, rupiah(c.selisihSen), rupiah(c.selisihSen), 0, dibayarSebelum(c.u)));
  }
  for (const c of calon.filter((c) => c.selisihSen < 0).sort(urut)) {
    const terap = tanpaMinNol(Math.max(c.selisihSen, -berjalan));
    berjalan += terap;
    dibawaSen += c.selisihSen - terap;
    koreksi.push(keBarisKoreksi(c.u, rupiah(c.selisihSen), rupiah(terap), rupiah(c.selisihSen - terap), dibayarSebelum(c.u)));
  }
  koreksi.sort(urutKoreksi);

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

  return {
    refType: b.refType,
    refId: b.refId,
    kunci: u0.kunci,
    komisiLama: b.komisiTersimpan,
    komisiBaru: u0.angka,
    potongBaru: u0.potong,
    berubah,
    gajiPokok: b.gajiPokok,
    potonganHilang: rupiah(potonganSen),
    dasar: rupiah(dasarSen),
    sasaran,
    koreksi,
    jumlahKoreksi: tanpaMinNol(rupiah(berjalan - dasarSen)),
    dibayar: rupiah(berjalan),
    dibawa: tanpaMinNol(rupiah(dibawaSen)),
    koreksiDiBarisLain,
    ditahan: null,
  };
}

/**
 * Pratinjau baris yang belum dibayar dan BELUM boleh dibayar tetapi sudah punya bulan pembayaran —
 * bulan toko putus yang ditetapkan dengan aturan lama, belum dicek, dan belum ada yang dibayar:
 * yang akan dibayar SESUDAH laporannya dicek, dengan komisi per SPG sekarang (bukan angka
 * tersimpannya). Tidak pernah menjadi sasaran koreksi (koreksi bulan lain tetap menunggu di daftar
 * koreksi), jadi hanya angkanya sendiri. Unit yang ditahan mendapat rencana bertanda `ditahan`
 * seperti di `rencanaBayarKomisi`. Null untuk baris lain — termasuk siklus yang kuncinya dibuka
 * (tanpa bulan pembayaran): angkanya baru ada saat dikunci lagi. Hanya tampilan; penulis tetap
 * menolak membayarnya sebelum dicek.
 */
export function pratinjauSesudahDicek(input: {
  units: readonly UnitKomisiSpg[];
  kunci: string;
  maksPotongPersen: number;
}): RencanaBayarKomisi | null {
  const u0 = input.units.find((u) => u.kunci === input.kunci && u.baris && !u.baris.dibayar && !u.baris.dapatDibayar && u.baris.bulanBayar !== null);
  if (!u0 || !u0.baris) return null;
  const andai: UnitKomisiSpg = { ...u0, baris: { ...u0.baris, dapatDibayar: true, dalamJendela: false } };
  return rencanaBayarKomisi({
    units: input.units.map((u) => (u === u0 ? andai : u)),
    kunci: input.kunci,
    maksPotongPersen: input.maksPotongPersen,
  });
}

/** Rencana bayar setiap baris yang belum dibayar dan boleh dibayar, menurut id barisnya. */
export function rencanaBayarSemua(units: readonly UnitKomisiSpg[], maksPotongPersen: number): Map<string, RencanaBayarKomisi> {
  const hasil = new Map<string, RencanaBayarKomisi>();
  for (const u of units) {
    if (!u.baris || u.baris.dibayar || !u.baris.dapatDibayar) continue;
    const r = rencanaBayarKomisi({ units, kunci: u.kunci, maksPotongPersen });
    if (r) hasil.set(r.refId, r);
  }
  return hasil;
}

/** "Koreksi komisi penjualan September 2026 — Toko X" — catatan baris koreksi. */
export function teksKoreksi(k: { bulanJual: string; namaToko: string }): string {
  return `Koreksi komisi penjualan ${salesMonthLabelId(k.bulanJual)} — ${k.namaToko}`;
}

/** "Komisi penjualan Oktober 2026 — Toko X" — nama sebuah laporan pembayaran. */
export function labelLaporanKomisi(k: { bulanJual: string; namaToko: string }): string {
  return `Komisi penjualan ${salesMonthLabelId(k.bulanJual)} — ${k.namaToko}`;
}

/** "+Rp 17.500" / "−Rp 2.500" (tanda minus U+2212). */
export function formatKoreksi(n: number): string {
  return sen(n) < 0 ? `−${formatIDR(rupiah(-sen(n)))}` : `+${formatIDR(rupiah(sen(n)))}`;
}

/** Kalimat koreksi untuk kabar pembayaran: setiap koreksi yang diterapkan, dan sisa minus yang dibawa. */
export function kalimatKoreksiKabar(k: readonly BarisKoreksi[]): string {
  const terap = k.filter((x) => sen(x.diterapkan) !== 0);
  const dibawaSen = k.reduce((n, x) => n + sen(x.dibawa), 0);
  const bagian: string[] = [];
  if (terap.length > 0) bagian.push(`Termasuk ${terap.map((x) => `${teksKoreksi(x)} ${formatKoreksi(x.diterapkan)}`).join("; ")}.`);
  if (dibawaSen < 0) bagian.push(`Sisa koreksi ${formatIDR(rupiah(-dibawaSen))} dikurangkan dari pembayaran berikutnya.`);
  return bagian.join(" ");
}
