/**
 * Kinerja lapangan salesman — murni, tanpa basis data, supaya setiap angka di
 * ringkasan HP, dasbor atasan, ekspor Excel dan kabar harian dihitung dengan
 * SATU aturan yang dites. Kuerinya di `metrik-queries.ts`.
 *
 * Semua "hari" adalah hari kalender WIB: kunjungan jam 00.30 WIB milik hari
 * itu, bukan hari UTC sebelumnya. Rentang selalu setengah terbuka
 * [awal hari pertama, awal hari sesudah hari terakhir).
 */

import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatRupiahRingkas } from "@/lib/format/rupiah";
import type { TokoRencana } from "./dasbor";
import { bacaTandaCheckin, type KodeTandaCheckin, type TandaCheckin } from "./checkin-janggal";
import { adalahKodeHasil, KODE_HASIL, ringkasHasil, type KodeRingkasan, type RingkasanHasil } from "./hasil-kunjungan";
import { susunRencanaDenganMenurun, type TokoMenurun } from "./toko-menurun";

const HARI_MS = 86_400_000;
const MENIT_MS = 60_000;

// ─── Hari & rentang ──────────────────────────────────────────────────────────

/** Hari kalender WIB, `YYYY-MM-DD`, kedua ujung termasuk. */
export type Rentang = { dari: string; sampai: string };
export type PresetRentang = "hari" | "minggu" | "bulan" | "kustom";
export const PRESET_RENTANG: readonly PresetRentang[] = ["hari", "minggu", "bulan", "kustom"];

/**
 * Batas panjang rentang kustom. Dasbor memuat setiap kunjungan dalam rentang
 * untuk semua sales; setahun sudah lebih dari cukup untuk membandingkan, dan
 * alamat yang disunting tangan tidak bisa meminta sepuluh tahun sekaligus.
 */
export const MAKS_HARI_RENTANG = 366;

/** Tengah malam WIB hari itu, sebagai instan. */
export function awalHari(kunci: string): Date {
  return new Date(`${kunci}T00:00:00+07:00`);
}

function geserHari(kunci: string, n: number): string {
  return new Date(Date.parse(`${kunci}T00:00:00Z`) + n * HARI_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` yang benar-benar hari kalender (bukan 30 Februari). */
export function sahKunciHari(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}

export function batasRentang(r: Rentang): { mulai: Date; akhir: Date } {
  return { mulai: awalHari(r.dari), akhir: awalHari(geserHari(r.sampai, 1)) };
}

export function hariDalamRentang(r: Rentang): string[] {
  const hari: string[] = [];
  for (let k = r.dari; k <= r.sampai; k = geserHari(k, 1)) hari.push(k);
  return hari;
}

const dalam = (d: Date, b: { mulai: Date; akhir: Date }) => d >= b.mulai && d < b.akhir;

/** Hari ini / minggu ini (mulai Senin) / bulan ini — semuanya sampai hari ini. */
export function rentangPreset(preset: Exclude<PresetRentang, "kustom">, sekarang: Date): Rentang {
  const hariIni = kunciHariWib(sekarang);
  if (preset === "bulan") return { dari: `${hariIni.slice(0, 7)}-01`, sampai: hariIni };
  if (preset === "minggu") {
    const hariKe = new Date(`${hariIni}T00:00:00Z`).getUTCDay(); // 0 = Minggu
    return { dari: geserHari(hariIni, -((hariKe + 6) % 7)), sampai: hariIni };
  }
  return { dari: hariIni, sampai: hariIni };
}

type Param = string | string[] | undefined;
const pertama = (x: Param) => (Array.isArray(x) ? x[0] : x);

/**
 * Rentang dari parameter alamat (`?rentang=&dari=&sampai=`). Apa pun yang
 * rusak kembali ke "hari ini" — layar tidak boleh kosong karena alamat
 * disunting tangan.
 */
export function bacaRentang(
  p: { rentang?: Param; dari?: Param; sampai?: Param },
  sekarang: Date,
): { preset: PresetRentang; rentang: Rentang } {
  const preset = pertama(p.rentang);
  if (preset === "minggu" || preset === "bulan") return { preset, rentang: rentangPreset(preset, sekarang) };
  if (preset === "kustom") {
    const dari = pertama(p.dari);
    const sampai = pertama(p.sampai);
    const a = sahKunciHari(dari) ? dari : sahKunciHari(sampai) ? sampai : null;
    const b = sahKunciHari(sampai) ? sampai : a;
    if (a && b) {
      let r: Rentang = a <= b ? { dari: a, sampai: b } : { dari: b, sampai: a };
      const paling = geserHari(r.sampai, -(MAKS_HARI_RENTANG - 1));
      if (r.dari < paling) r = { dari: paling, sampai: r.sampai };
      return { preset: "kustom", rentang: r };
    }
  }
  return { preset: "hari", rentang: rentangPreset("hari", sekarang) };
}

/** Pilihan tanggal layar "Hari ini" di HP: hari ini dan enam hari sebelumnya, terbaru dulu. */
export function tujuhHariTerakhir(sekarang: Date): string[] {
  const hariIni = kunciHariWib(sekarang);
  return Array.from({ length: 7 }, (_, i) => geserHari(hariIni, -i));
}

/** Tanggal `?tanggal=` di HP — hanya tujuh hari terakhir; yang lain jadi hari ini. */
export function bacaTanggalHariIni(x: Param, sekarang: Date): string {
  const pilihan = tujuhHariTerakhir(sekarang);
  const t = pertama(x);
  return t && pilihan.includes(t) ? t : pilihan[0];
}

// ─── Bahan ───────────────────────────────────────────────────────────────────

export type KunjunganBahan = {
  id: string;
  storeId: string;
  checkinAt: Date;
  checkoutAt: Date | null;
  /** `StoreVisit.outcome` apa adanya; kunjungan lama bernilai null. */
  outcome: string | null;
  diLuarRadius: boolean;
  /** `StoreVisit.checkinFlags` mentah — dibaca di sini, entri rusak dibuang. */
  tanda: unknown;
};

export type PesananBahan = {
  id: string;
  storeId: string;
  visitId: string | null;
  orderType: "PUTUS" | "KONSI";
  status: string;
  /** Untuk konsi angka ini TIDAK dipakai: nilainya harga titip, bukan penjualan. */
  total: number;
  createdAt: Date;
  /** Pesanan jarak jauh (WA/telepon), tanpa check-in. */
  jarakJauh: boolean;
};

export type KlaimBahan = {
  id: string;
  storeId: string;
  status: string;
  /** Uang yang diterima (`receivedAmount`). */
  nilai: number;
  createdAt: Date;
  verifiedAt: Date | null;
};

export type ReturBahan = { id: string; storeId: string; status: string; createdAt: Date };
export type VanBahan = { id: string; storeId: string | null; total: number; createdAt: Date };
/** Toko baru (NOO): usulan yang disetujui, atau toko yang transaksi PERTAMANYA dicatat sales ini. */
export type TokoBaruBahan = { storeId: string; tanggal: Date; sumber: "USULAN" | "PESANAN_PERTAMA" };

export type BahanMetrik = {
  kunjungan: KunjunganBahan[];
  pesanan: PesananBahan[];
  klaim: KlaimBahan[];
  retur: ReturBahan[];
  van: VanBahan[];
  tokoBaru: TokoBaruBahan[];
};

// ─── Kunjungan efektif ───────────────────────────────────────────────────────

/**
 * Tenggang sesudah check-out. Laporan pelunasan dan retur sering dikirim di
 * mobil, beberapa menit sesudah meninggalkan toko — itu tetap hasil kunjungan
 * tadi. Setengah jam cukup untuk itu tanpa menarik dokumen kunjungan berikutnya.
 */
export const TENGGANG_MENIT = 30;

/** Hasil yang dicatat server sebagai "ada transaksi" (lihat `hasil-kunjungan.ts`). */
const HASIL_TRANSAKSI = new Set(["TRANSAKSI", "TRANSAKSI_TERTUNDA"]);

export type KodeJanggal = KodeTandaCheckin | "LUAR_RADIUS";
/** Semua kode check-in janggal, dalam urutan tampil. */
export const KODE_JANGGAL: readonly KodeJanggal[] = [
  "LUAR_RADIUS",
  "AKURASI_BURUK",
  "AKURASI_TIDAK_ADA",
  "LOMPATAN_MUSTAHIL",
  "KOORDINAT_KEMBAR",
];

export type RincianKunjungan = {
  id: string;
  storeId: string;
  checkinAt: Date;
  checkoutAt: Date | null;
  outcome: string | null;
  /**
   * Kode untuk ringkasan: hasil yang tercatat bila dikenal; kunjungan tanpa
   * hasil (sebelum fitur ini) yang bertransaksi dibaca TRANSAKSI — server akan
   * mencatat itu juga seandainya kunjungannya terjadi sekarang; sisanya KOSONG.
   */
  kodeHasil: KodeRingkasan;
  efektif: boolean;
  /** null selama kunjungan belum ditutup. */
  durasiMenit: number | null;
  diLuarRadius: boolean;
  tanda: TandaCheckin[];
  janggal: boolean;
  /** Pesanan yang tidak ditolak. */
  pesanan: number;
  pesananDitolak: number;
  nilaiPutus: number;
  konsi: number;
  klaim: number;
  nilaiKlaim: number;
  retur: number;
  van: number;
  nilaiVan: number;
};

/**
 * Akhir jendela sebuah kunjungan: check-out + tenggang; yang masih terbuka
 * sampai sekarang (hari ini) atau sampai akhir hari check-in-nya (hari lalu,
 * lupa check-out) — tidak pernah melewati hari itu.
 */
function akhirJendela(v: KunjunganBahan, sekarang: Date): Date {
  if (v.checkoutAt) return new Date(v.checkoutAt.getTime() + TENGGANG_MENIT * MENIT_MS);
  const akhirHari = awalHari(geserHari(kunciHariWib(v.checkinAt), 1));
  return sekarang < akhirHari ? sekarang : akhirHari;
}

/**
 * Setiap kunjungan beserta transaksi yang lahir darinya.
 *
 * Pesanan ber-`visitId` milik kunjungan itu, apa pun waktunya (pesanan luring
 * bisa tiba besok pagi). Dokumen lain — dan pesanan lama tanpa `visitId` —
 * hanya punya toko dan waktu, jadi ditautkan ke kunjungan di toko yang sama
 * yang jendelanya memuat waktu dokumen; bila dua kunjungan bersinggungan,
 * dokumen milik yang check-in-nya paling akhir sebelum dokumen itu, supaya satu
 * dokumen tidak membuat dua kunjungan efektif.
 *
 * Pesanan yang kemudian DITOLAK tetap membuat kunjungan efektif: transaksinya
 * terjadi di toko; keputusan kantor sesudahnya bukan kerja lapangan. Klaim yang
 * dibatalkan dan retur yang batal tidak — itu dokumen yang ditarik kembali.
 */
export function rincianKunjungan(bahan: BahanMetrik, sekarang: Date): RincianKunjungan[] {
  const rincian = bahan.kunjungan.map<RincianKunjungan>((v) => {
    const tanda = bacaTandaCheckin(v.tanda);
    return {
      id: v.id,
      storeId: v.storeId,
      checkinAt: v.checkinAt,
      checkoutAt: v.checkoutAt,
      outcome: v.outcome,
      kodeHasil: "KOSONG",
      efektif: false,
      durasiMenit: v.checkoutAt
        ? Math.max(0, Math.round((v.checkoutAt.getTime() - v.checkinAt.getTime()) / MENIT_MS))
        : null,
      diLuarRadius: v.diLuarRadius,
      tanda,
      janggal: v.diLuarRadius || tanda.length > 0,
      pesanan: 0,
      pesananDitolak: 0,
      nilaiPutus: 0,
      konsi: 0,
      klaim: 0,
      nilaiKlaim: 0,
      retur: 0,
      van: 0,
      nilaiVan: 0,
    };
  });
  const perId = new Map(rincian.map((r) => [r.id, r]));
  const jendela = bahan.kunjungan.map((v, i) => ({ v, r: rincian[i], akhir: akhirJendela(v, sekarang) }));
  const tertaut = new Set<string>();

  const cariKunjungan = (storeId: string | null, waktu: Date): RincianKunjungan | null => {
    if (!storeId) return null;
    let pilih: (typeof jendela)[number] | null = null;
    for (const j of jendela) {
      if (j.v.storeId !== storeId || waktu < j.v.checkinAt || waktu > j.akhir) continue;
      if (!pilih || j.v.checkinAt > pilih.v.checkinAt) pilih = j;
    }
    return pilih ? pilih.r : null;
  };

  for (const o of bahan.pesanan) {
    const r = o.visitId !== null ? perId.get(o.visitId) ?? null : cariKunjungan(o.storeId, o.createdAt);
    if (!r) continue;
    tertaut.add(r.id);
    if (o.status === "REJECTED") {
      r.pesananDitolak += 1;
      continue;
    }
    r.pesanan += 1;
    if (o.orderType === "KONSI") r.konsi += 1;
    else r.nilaiPutus += o.total;
  }
  for (const k of bahan.klaim) {
    if (k.status === "DIBATALKAN") continue;
    const r = cariKunjungan(k.storeId, k.createdAt);
    if (!r) continue;
    tertaut.add(r.id);
    r.klaim += 1;
    r.nilaiKlaim += k.nilai;
  }
  for (const x of bahan.retur) {
    if (x.status === "BATAL") continue;
    const r = cariKunjungan(x.storeId, x.createdAt);
    if (!r) continue;
    tertaut.add(r.id);
    r.retur += 1;
  }
  for (const n of bahan.van) {
    const r = cariKunjungan(n.storeId, n.createdAt);
    if (!r) continue;
    tertaut.add(r.id);
    r.van += 1;
    r.nilaiVan += n.total;
  }

  for (const r of rincian) {
    const adaTransaksi = tertaut.has(r.id);
    r.efektif = adaTransaksi || (r.outcome !== null && HASIL_TRANSAKSI.has(r.outcome));
    r.kodeHasil = adalahKodeHasil(r.outcome) ? r.outcome : adaTransaksi ? "TRANSAKSI" : "KOSONG";
  }
  return rincian;
}

// ─── Metrik ──────────────────────────────────────────────────────────────────

export type MetrikLapangan = {
  kunjungan: number;
  /** Toko berbeda yang didatangi (dijumlah per sales pada baris total). */
  tokoDikunjungi: number;
  efektif: number;
  /** Kunjungan efektif ÷ kunjungan, dibulatkan; null tanpa kunjungan. */
  persenEfektif: number | null;
  /** Kunjungan yang belum di-check-out. */
  berlangsung: number;
  /** Ringkasan hasil kunjungan yang sudah selesai. */
  hasil: RingkasanHasil;
  /** Kunjungan dengan check-in janggal (di luar radius atau bertanda). */
  janggal: number;
  /** Per tanda — satu kunjungan bisa punya beberapa tanda. */
  perTanda: { kode: KodeJanggal; jumlah: number }[];
  pesanan: {
    /** Pesanan yang tidak ditolak, putus + konsi. */
    jumlah: number;
    putus: number;
    nilaiPutus: number;
    /** Konsinyasi hanya dihitung — nilainya harga titip, bukan penjualan. */
    konsi: number;
    ditolak: number;
    jarakJauh: number;
  };
  van: { jumlah: number; nilai: number };
  pelunasan: {
    /** Laporan pelunasan yang dikirim di rentang ini (yang dibatalkan tidak). */
    dilaporkan: number;
    nilaiDilaporkan: number;
    /** Yang diverifikasi keuangan di rentang ini — hanya ini uang yang sudah pasti. */
    terverifikasi: number;
    nilaiTerverifikasi: number;
  };
  retur: number;
  tokoBaru: number;
  /**
   * Waktu di lapangan: check-in pertama → check-out terakhir, per hari WIB,
   * dijumlah. `mulai`/`selesai` hanya diisi bila rentangnya satu hari kerja.
   */
  lapangan: { menit: number; hariAktif: number; mulai: Date | null; selesai: Date | null };
};

function urutkanTanda(peta: Map<KodeJanggal, number>): { kode: KodeJanggal; jumlah: number }[] {
  return [...peta.entries()]
    .map(([kode, jumlah]) => ({ kode, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || KODE_JANGGAL.indexOf(a.kode) - KODE_JANGGAL.indexOf(b.kode));
}

/**
 * Semua angka satu sales untuk satu rentang. Bahan boleh berisi baris di luar
 * rentang (kueri mengambil klaim menurut tanggal lapor ATAU tanggal verifikasi);
 * setiap angka menyaring menurut tanggalnya sendiri di sini.
 */
export function hitungMetrikLapangan(bahan: BahanMetrik, rentang: Rentang, sekarang: Date): MetrikLapangan {
  const b = batasRentang(rentang);
  const kunjunganDalam = bahan.kunjungan.filter((v) => dalam(v.checkinAt, b));
  // Transaksi untuk menautkan diambil dari seluruh bahan: klaim yang dikirim
  // sesudah tengah malam masih hasil kunjungan jam 23.50.
  const rincian = rincianKunjungan({ ...bahan, kunjungan: kunjunganDalam }, sekarang);

  const efektif = rincian.filter((r) => r.efektif).length;
  const perTanda = new Map<KodeJanggal, number>();
  for (const r of rincian) {
    const kode = new Set<KodeJanggal>(r.tanda.map((t) => t.kode));
    if (r.diLuarRadius) kode.add("LUAR_RADIUS");
    for (const k of kode) perTanda.set(k, (perTanda.get(k) ?? 0) + 1);
  }

  const pesanan = bahan.pesanan.filter((o) => dalam(o.createdAt, b));
  const hidup = pesanan.filter((o) => o.status !== "REJECTED");
  const putus = hidup.filter((o) => o.orderType === "PUTUS");

  const dilaporkan = bahan.klaim.filter((k) => k.status !== "DIBATALKAN" && dalam(k.createdAt, b));
  const terverifikasi = bahan.klaim.filter(
    (k) => k.status === "TERVERIFIKASI" && k.verifiedAt !== null && dalam(k.verifiedAt, b),
  );
  const van = bahan.van.filter((n) => dalam(n.createdAt, b));
  const jumlah = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

  return {
    kunjungan: rincian.length,
    tokoDikunjungi: new Set(rincian.map((r) => r.storeId)).size,
    efektif,
    persenEfektif: rincian.length ? Math.round((efektif / rincian.length) * 100) : null,
    berlangsung: rincian.filter((r) => r.checkoutAt === null).length,
    hasil: ringkasHasil(
      rincian.map((r) => ({
        outcome: r.kodeHasil === "KOSONG" ? null : r.kodeHasil,
        selesai: r.checkoutAt !== null,
        spg: false,
      })),
    ),
    janggal: rincian.filter((r) => r.janggal).length,
    perTanda: urutkanTanda(perTanda),
    pesanan: {
      jumlah: hidup.length,
      putus: putus.length,
      nilaiPutus: jumlah(putus, (o) => o.total),
      konsi: hidup.length - putus.length,
      ditolak: pesanan.length - hidup.length,
      jarakJauh: hidup.filter((o) => o.jarakJauh).length,
    },
    van: { jumlah: van.length, nilai: jumlah(van, (n) => n.total) },
    pelunasan: {
      dilaporkan: dilaporkan.length,
      nilaiDilaporkan: jumlah(dilaporkan, (k) => k.nilai),
      terverifikasi: terverifikasi.length,
      nilaiTerverifikasi: jumlah(terverifikasi, (k) => k.nilai),
    },
    retur: bahan.retur.filter((x) => x.status !== "BATAL" && dalam(x.createdAt, b)).length,
    tokoBaru: new Set(bahan.tokoBaru.filter((t) => dalam(t.tanggal, b)).map((t) => t.storeId)).size,
    lapangan: waktuLapangan(kunjunganDalam, sekarang),
  };
}

/**
 * Check-in pertama → check-out terakhir per hari. Kunjungan yang masih terbuka
 * hari ini dihitung sampai sekarang; yang terbuka dari hari lalu (lupa
 * check-out) tidak menambah waktu — jamnya tidak diketahui, dan menebaknya
 * sampai tengah malam akan menggelembungkan angka.
 */
function waktuLapangan(kunjungan: readonly KunjunganBahan[], sekarang: Date): MetrikLapangan["lapangan"] {
  const hariIni = kunciHariWib(sekarang);
  const perHari = new Map<string, { mulai: Date; selesai: Date }>();
  for (const v of kunjungan) {
    const hari = kunciHariWib(v.checkinAt);
    const selesai = v.checkoutAt ?? (hari === hariIni ? sekarang : v.checkinAt);
    const h = perHari.get(hari);
    if (!h) perHari.set(hari, { mulai: v.checkinAt, selesai });
    else {
      if (v.checkinAt < h.mulai) h.mulai = v.checkinAt;
      if (selesai > h.selesai) h.selesai = selesai;
    }
  }
  let menit = 0;
  for (const h of perHari.values()) menit += Math.max(0, Math.round((h.selesai.getTime() - h.mulai.getTime()) / MENIT_MS));
  const satu = perHari.size === 1 ? [...perHari.values()][0] : null;
  return { menit, hariAktif: perHari.size, mulai: satu?.mulai ?? null, selesai: satu?.selesai ?? null };
}

export function adaKegiatan(m: MetrikLapangan): boolean {
  return (
    m.kunjungan > 0 ||
    m.pesanan.jumlah + m.pesanan.ditolak > 0 ||
    m.pelunasan.dilaporkan > 0 ||
    m.pelunasan.terverifikasi > 0 ||
    m.retur > 0 ||
    m.van.jumlah > 0 ||
    m.tokoBaru > 0
  );
}

const URUT_HASIL: readonly KodeRingkasan[] = [...KODE_HASIL, "KOSONG"];

/**
 * Baris total. Persen efektif dihitung ulang dari jumlahnya, bukan rata-rata
 * persen per sales: sales dengan dua kunjungan tidak boleh berbobot sama
 * dengan sales dengan dua puluh.
 */
export function jumlahkanMetrik(daftar: readonly MetrikLapangan[]): MetrikLapangan {
  const t: MetrikLapangan = {
    kunjungan: 0,
    tokoDikunjungi: 0,
    efektif: 0,
    persenEfektif: null,
    berlangsung: 0,
    hasil: { total: 0, transaksi: 0, perKode: [] },
    janggal: 0,
    perTanda: [],
    pesanan: { jumlah: 0, putus: 0, nilaiPutus: 0, konsi: 0, ditolak: 0, jarakJauh: 0 },
    van: { jumlah: 0, nilai: 0 },
    pelunasan: { dilaporkan: 0, nilaiDilaporkan: 0, terverifikasi: 0, nilaiTerverifikasi: 0 },
    retur: 0,
    tokoBaru: 0,
    lapangan: { menit: 0, hariAktif: 0, mulai: null, selesai: null },
  };
  const hasil = new Map<KodeRingkasan, number>();
  const tanda = new Map<KodeJanggal, number>();
  for (const m of daftar) {
    t.kunjungan += m.kunjungan;
    t.tokoDikunjungi += m.tokoDikunjungi;
    t.efektif += m.efektif;
    t.berlangsung += m.berlangsung;
    t.hasil.total += m.hasil.total;
    t.hasil.transaksi += m.hasil.transaksi;
    for (const h of m.hasil.perKode) hasil.set(h.kode, (hasil.get(h.kode) ?? 0) + h.jumlah);
    t.janggal += m.janggal;
    for (const x of m.perTanda) tanda.set(x.kode, (tanda.get(x.kode) ?? 0) + x.jumlah);
    for (const k of Object.keys(t.pesanan) as (keyof MetrikLapangan["pesanan"])[]) t.pesanan[k] += m.pesanan[k];
    t.van.jumlah += m.van.jumlah;
    t.van.nilai += m.van.nilai;
    for (const k of Object.keys(t.pelunasan) as (keyof MetrikLapangan["pelunasan"])[]) t.pelunasan[k] += m.pelunasan[k];
    t.retur += m.retur;
    t.tokoBaru += m.tokoBaru;
    t.lapangan.menit += m.lapangan.menit;
    t.lapangan.hariAktif += m.lapangan.hariAktif;
  }
  t.persenEfektif = t.kunjungan ? Math.round((t.efektif / t.kunjungan) * 100) : null;
  t.hasil.perKode = [...hasil.entries()]
    .map(([kode, jumlah]) => ({ kode, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || URUT_HASIL.indexOf(a.kode) - URUT_HASIL.indexOf(b.kode));
  t.perTanda = urutkanTanda(tanda);
  return t;
}

// ─── Rencana vs realisasi ────────────────────────────────────────────────────

export type AlasanRencana = "tagih" | "lama" | "menurun";

export type RencanaRealisasi = {
  /** Toko berbeda yang masuk rencana pada salah satu hari di rentang. */
  direncanakan: number;
  /** Dari itu, yang didatangi pada hari ia sedang direncanakan. */
  dikunjungi: number;
  persen: number | null;
  /** Urut menurut kemunculan pertama di rencana (hari pertama, urutan rencana hari itu). */
  toko: { storeId: string; nama: string; alasan: AlasanRencana[]; dikunjungi: boolean }[];
};

/**
 * Rencana kunjungan yang disusun ulang untuk setiap hari di rentang dengan
 * aturan yang sama dengan beranda HP (`susunRencanaDenganMenurun`), lalu
 * dicocokkan dengan kunjungan sungguhan.
 *
 * Untuk hari lalu, yang bisa disusun ulang hanya aturan jarak kunjungan
 * (kunjungan terakhir sebelum hari itu + batas hari). Tagihan lewat janji dan
 * toko menurun hanya diketahui keadaan SEKARANG — memakainya untuk hari lalu
 * akan menghukum sales atas tagihan yang waktu itu belum lewat — jadi keduanya
 * hanya ikut pada `hariIni`. Hari sesudah hari ini tidak direncanakan.
 *
 * "Toko saya" adalah daftar saat ini (`tokoSaya`), bukan daftar waktu itu.
 */
export function rencanaVsRealisasi(m: {
  toko: readonly TokoRencana[];
  /** Kunjungan terakhir sales ini ke tiap toko SEBELUM rentang dimulai. */
  kunjunganSebelum: ReadonlyMap<string, Date>;
  /** Kunjungan sales ini di dalam rentang. */
  kunjungan: readonly { storeId: string; checkinAt: Date }[];
  menurun: readonly TokoMenurun[];
  rentang: Rentang;
  batasHari: number;
  /** Hari ini (`YYYY-MM-DD`, WIB). */
  hariIni: string;
}): RencanaRealisasi {
  const kunjunganPerHari = new Map<string, Set<string>>();
  const riwayat = new Map<string, Date[]>();
  for (const v of [...m.kunjungan].sort((a, b) => a.checkinAt.getTime() - b.checkinAt.getTime())) {
    const hari = kunciHariWib(v.checkinAt);
    const set = kunjunganPerHari.get(hari) ?? new Set<string>();
    set.add(v.storeId);
    kunjunganPerHari.set(hari, set);
    riwayat.set(v.storeId, [...(riwayat.get(v.storeId) ?? []), v.checkinAt]);
  }

  const hasil = new Map<string, { storeId: string; nama: string; alasan: Set<AlasanRencana>; dikunjungi: boolean }>();
  for (const hari of hariDalamRentang(m.rentang)) {
    if (hari > m.hariIni) break;
    const awal = awalHari(hari);
    const hariItu = hari === m.hariIni;
    const toko: TokoRencana[] = m.toko.map((t) => {
      let terakhir = m.kunjunganSebelum.get(t.storeId) ?? null;
      for (const d of riwayat.get(t.storeId) ?? []) if (d < awal && (!terakhir || d > terakhir)) terakhir = d;
      return { ...t, kunjunganTerakhir: terakhir, tagih: hariItu ? t.tagih : false };
    });
    const rencana = susunRencanaDenganMenurun(toko, hariItu ? m.menurun : [], { batasHari: m.batasHari, hariIni: awal });
    const didatangi = kunjunganPerHari.get(hari);
    for (const r of rencana) {
      const h = hasil.get(r.storeId) ?? { storeId: r.storeId, nama: r.nama, alasan: new Set<AlasanRencana>(), dikunjungi: false };
      for (const a of r.alasan) h.alasan.add(a);
      if (r.menurun) h.alasan.add("menurun");
      if (didatangi?.has(r.storeId)) h.dikunjungi = true;
      hasil.set(r.storeId, h);
    }
  }

  const URUT_ALASAN: readonly AlasanRencana[] = ["tagih", "menurun", "lama"];
  const toko = [...hasil.values()].map((h) => ({
    storeId: h.storeId,
    nama: h.nama,
    alasan: URUT_ALASAN.filter((a) => h.alasan.has(a)),
    dikunjungi: h.dikunjungi,
  }));
  const dikunjungi = toko.filter((t) => t.dikunjungi).length;
  return {
    direncanakan: toko.length,
    dikunjungi,
    persen: toko.length ? Math.round((dikunjungi / toko.length) * 100) : null,
    toko,
  };
}

// ─── Kalimat ringkasan ───────────────────────────────────────────────────────

/*
 * Kalimat kabar ditulis dalam bahasa Indonesia di server: kabar disimpan
 * sebagai teks di `NotificationQueue`/`AdminNotification` dan dikirim sebagai
 * push, sama dengan kabar lain (pesanan disetujui, pelunasan ditolak, …).
 */

/** "5 kunjungan · 3 pesanan Rp 4,2 jt · 1 pelunasan" — hanya bagian yang ada isinya, kunjungan selalu. */
export function kalimatRingkasan(m: MetrikLapangan): string {
  const bagian = [`${m.kunjungan} kunjungan`];
  if (m.pesanan.jumlah > 0) {
    bagian.push(`${m.pesanan.jumlah} pesanan${m.pesanan.nilaiPutus > 0 ? ` ${formatRupiahRingkas(m.pesanan.nilaiPutus)}` : ""}`);
  }
  if (m.pelunasan.dilaporkan > 0) bagian.push(`${m.pelunasan.dilaporkan} pelunasan`);
  if (m.retur > 0) bagian.push(`${m.retur} retur`);
  if (m.van.jumlah > 0) bagian.push(`${m.van.jumlah} jual van ${formatRupiahRingkas(m.van.nilai)}`);
  if (m.tokoBaru > 0) bagian.push(`${m.tokoBaru} toko baru`);
  return bagian.join(" · ");
}

/** Ringkasan satu hari seluruh tim, untuk atasan. */
export function kalimatRingkasanTim(total: MetrikLapangan, salesAktif: number): string {
  const bagian = [`${salesAktif} sales aktif`];
  bagian.push(
    total.persenEfektif === null
      ? `${total.kunjungan} kunjungan`
      : `${total.kunjungan} kunjungan (efektif ${total.persenEfektif}%)`,
  );
  if (total.pesanan.jumlah > 0) {
    bagian.push(
      `${total.pesanan.jumlah} pesanan${total.pesanan.nilaiPutus > 0 ? ` ${formatRupiahRingkas(total.pesanan.nilaiPutus)}` : ""}`,
    );
  }
  if (total.pelunasan.dilaporkan > 0) bagian.push(`${total.pelunasan.dilaporkan} pelunasan`);
  if (total.tokoBaru > 0) bagian.push(`${total.tokoBaru} toko baru`);
  if (total.janggal > 0) bagian.push(`${total.janggal} check-in janggal`);
  return bagian.join(" · ");
}
