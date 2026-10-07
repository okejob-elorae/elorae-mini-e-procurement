/**
 * CSV Ruang KOL — murni, aman untuk klien.
 *
 * Berkas dibuka orang di Excel/Google Sheets, jadi: BOM UTF-8 di depan (tanpa
 * itu Excel membaca "é" sebagai sampah), pemisah koma, sel dikutip bila memuat
 * koma/kutip/baris baru, angka TANPA titik ribuan (supaya terbaca sebagai
 * angka, bukan teks), tanggal "YYYY-MM-DD". Sel yang diawali =, +, -, @
 * diberi petik di depan supaya tidak dijalankan sebagai rumus (nama KOL dan
 * catatan diketik orang).
 */

import { cpm, jumlahUang, roas } from "./angka-konten";
import { LABEL_PLATFORM, type Platform } from "./aturan";
import { LABEL_TAHAP, type JenisKerjaSama, type Tahap } from "./tahap";

export type SelCsv = string | number | null | undefined;

const RUMUS = /^[=+\-@\t\r]/;

/** Satu sel CSV. */
export function selCsv(v: SelCsv): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? angkaCsv(v) : "";
  let s = String(v);
  if (RUMUS.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Angka polos: bulat tanpa desimal, selain itu dua desimal bertitik. */
export function angkaCsv(n: number): string {
  const sen = Math.round(Number((n * 100).toFixed(4)));
  if (sen % 100 === 0) return String(sen / 100);
  return (sen / 100).toFixed(2);
}

/** Baris-baris menjadi isi berkas, ber-BOM. */
export function susunCsv(baris: readonly (readonly SelCsv[])[]): string {
  return `\uFEFF${baris.map((b) => b.map(selCsv).join(",")).join("\r\n")}\r\n`;
}

/** "performa-2026-10-07.csv" / "performa-2026-10-01_sd_2026-10-07.csv". */
export function namaBerkasPeriode(awalan: string, dari: string, sampai: string): string {
  return dari === sampai ? `${awalan}-${dari}.csv` : `${awalan}-${dari}_sd_${sampai}.csv`;
}

const LABEL_JENIS: Record<JenisKerjaSama, string> = { BARTER: "Barter", BAYAR: "Berbayar", CAMPURAN: "Campuran", KOMISI: "Komisi" };

export type BarisPerformaCsv = {
  /** Username tanpa "@" (sel berawalan "@" terbaca rumus di Excel). */
  username: string | null;
  namaKol: string;
  platform: Platform | null;
  pengikut: number;
  campaign: string | null;
  docNo: string;
  tahap: Tahap;
  jenis: JenisKerjaSama;
  fee: number;
  views: number;
  jumlahKonten: number;
  orders: number;
  gmv: number;
  komisi: number;
  /** Ongkir + HPP sampel. */
  biayaKirim: number;
  boost: number;
  totalBiaya: number;
  roas: number | null;
};

/**
 * CSV "Performa" — satu baris per kolaborasi yang punya aktivitas di periode,
 * angka dari `angkaKolaborasi(periode)`. Diawali baris periode, ditutup baris
 * TOTAL.
 */
export function csvPerforma(baris: readonly BarisPerformaCsv[], periode: { dari: string; sampai: string } | null): string {
  const kepala = [
    "No",
    "Username",
    "Nama",
    "Platform",
    "Pengikut",
    "Campaign",
    "No. kolaborasi",
    "Tahap",
    "Jenis",
    "Fee",
    "Konten",
    "Views",
    "Order",
    "GMV",
    "Komisi",
    "Biaya kirim",
    "Boost",
    "Total biaya",
    "ROAS",
    "CPM",
  ];
  const isi = baris.map((b, i) => [
    i + 1,
    b.username?.replace(/^@+/, "") ?? "",
    b.namaKol,
    b.platform ? LABEL_PLATFORM[b.platform] : "",
    b.pengikut,
    b.campaign ?? "",
    b.docNo,
    LABEL_TAHAP[b.tahap],
    LABEL_JENIS[b.jenis],
    b.fee,
    b.jumlahKonten,
    b.views,
    b.orders,
    b.gmv,
    b.komisi,
    b.biayaKirim,
    b.boost,
    b.totalBiaya,
    b.roas,
    cpm(b.totalBiaya, b.views),
  ]);
  const jumlah = (f: (b: BarisPerformaCsv) => number) => jumlahUang(baris.map(f));
  const views = baris.reduce((s, b) => s + b.views, 0);
  const totalBiaya = jumlah((b) => b.totalBiaya);
  const gmv = jumlah((b) => b.gmv);
  const total = [
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    jumlah((b) => b.fee),
    baris.reduce((s, b) => s + b.jumlahKonten, 0),
    views,
    baris.reduce((s, b) => s + b.orders, 0),
    gmv,
    jumlah((b) => b.komisi),
    jumlah((b) => b.biayaKirim),
    jumlah((b) => b.boost),
    totalBiaya,
    roas(gmv, totalBiaya),
    cpm(totalBiaya, views),
  ];
  return susunCsv([
    [periode ? `Periode: ${periode.dari} s/d ${periode.sampai}` : "Periode: semua"],
    kepala,
    ...isi,
    [],
    total,
  ]);
}
