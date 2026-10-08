import type { Prisma } from "../generated/prisma/client";

/*
 * Kunci periode akuntansi (rancangan akuntansi & pajak lengkap, bagian A1,
 * prinsip 6): tidak ada jurnal yang tertanggal di bulan yang sudah DITUTUP.
 *
 * Bulan dihitung menurut WIB (UTC+7, tanpa musim panas) — sama dengan laporan
 * keuangan, yang memotong periode di tengah malam WIB. Bulan tanpa baris
 * `AccountingPeriod` berarti TERBUKA.
 *
 * KENAPA SETIAP POSTING MENULIS BARIS PERIODENYA. Pemeriksaan "bulan ini
 * terbuka?" lalu menyisipkan jurnal adalah pola baca-lalu-tulis: tanpa kunci,
 * penutup buku yang meng-commit CLOSED di antara keduanya meninggalkan jurnal
 * di bulan tertutup. Kunci baris (UPDATE) dipakai karena ia bekerja sama di
 * MariaDB dan Postgres:
 *  - penutup buku lebih dulu → UPDATE poster menunggu sampai penutup commit,
 *    lalu membaca CLOSED (READ COMMITTED membaca versi terbaru untuk baris yang
 *    dikunci; SERIALIZABLE gagal-serialisasi dan diulang `runSerializable`);
 *  - poster lebih dulu → UPDATE penutup buku (SERIALIZABLE) bertemu baris yang
 *    diubah transaksi lain sesudah snapshot-nya → gagal-serialisasi → diulang,
 *    dan percobaan ulangnya melihat jurnal baru itu di daftar periksanya.
 * Baris yang belum ada dibuat dulu (`createMany` + `skipDuplicates` = INSERT
 * … ON CONFLICT DO NOTHING / INSERT IGNORE), karena baris yang tidak ada tidak
 * bisa dikunci. Harganya: posting jurnal di bulan yang sama saling menunggu
 * sampai transaksi masing-masing selesai — kecil untuk volume Elorae.
 */

export const STATUS_PERIODE = { OPEN: "OPEN", CLOSED: "CLOSED" } as const;

const WIB_MS = 7 * 60 * 60 * 1000;

const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tahun dan bulan (1–12) kalender WIB dari sebuah instan. */
export function wibYearMonth(date: Date): { year: number; month: number } {
  const wib = new Date(date.getTime() + WIB_MS);
  return { year: wib.getUTCFullYear(), month: wib.getUTCMonth() + 1 };
}

/** 00:00:00.000 WIB tanggal 1 bulan itu, sebagai instan. */
export function firstDayOfMonthWib(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - WIB_MS);
}

/** Bulan sesudahnya (Desember → Januari tahun berikut). */
export function nextYearMonth(ym: { year: number; month: number }): { year: number; month: number } {
  return ym.month === 12 ? { year: ym.year + 1, month: 1 } : { year: ym.year, month: ym.month + 1 };
}

/** "15 Sep 2026" menurut WIB — untuk keterangan jurnal yang tanggalnya digeser. */
export function wibDayLabel(date: Date): string {
  const wib = new Date(date.getTime() + WIB_MS);
  return `${wib.getUTCDate()} ${BULAN_SINGKAT[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}

type PeriodDelegate = Prisma.TransactionClient["accountingPeriod"];

function periodModel(tx: Prisma.TransactionClient): PeriodDelegate | null {
  /*
   * Klien Prisma yang dimuat sebelum tabelnya ada (server dev yang belum
   * dinyalakan ulang) atau klien tiruan dalam tes tidak punya delegasinya.
   * Tanpa tabel tidak ada periode yang bisa ditutup, jadi semuanya terbuka.
   */
  const model = (tx as { accountingPeriod?: PeriodDelegate }).accountingPeriod;
  return model && typeof model.update === "function" ? model : null;
}

/**
 * Mengunci baris periode bulan `date` (WIB) untuk transaksi ini dan
 * mengembalikan statusnya. Kunci bertahan sampai transaksi pemanggil selesai.
 * HARUS dipanggil di dalam transaksi yang juga menulis jurnalnya.
 */
export async function lockPeriodForPosting(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<"OPEN" | "CLOSED"> {
  const model = periodModel(tx);
  if (!model) return STATUS_PERIODE.OPEN;
  const { year, month } = wibYearMonth(date);
  const kunci = () =>
    model.update({
      where: { year_month: { year, month } },
      data: { updatedAt: new Date() },
      select: { status: true },
    });
  /*
   * UPDATE dulu, INSERT hanya bila barisnya belum ada. Di InnoDB, INSERT IGNORE
   * atas baris yang sudah ada mengambil kunci BERSAMA; dua poster yang sama-sama
   * memegang kunci bersama lalu meminta kunci eksklusif (UPDATE) saling
   * menunggu → deadlock. Dengan UPDATE lebih dulu, poster bulan yang barisnya
   * sudah ada (hampir semua — `ensurePeriodRows` membuatnya lebih awal) hanya
   * mengantre kunci eksklusif.
   */
  let row: { status: string };
  try {
    row = await kunci();
  } catch (e) {
    if ((e as { code?: unknown })?.code !== "P2025") throw e;
    await model.createMany({ data: [{ year, month }], skipDuplicates: true });
    row = await kunci();
  }
  return row.status === STATUS_PERIODE.CLOSED ? STATUS_PERIODE.CLOSED : STATUS_PERIODE.OPEN;
}

/**
 * Membuat baris periode (TERBUKA) untuk bulan-bulan ini bila belum ada, di
 * luar transaksi posting mana pun — supaya posting pertama di sebuah bulan
 * tidak perlu menyisipkan barisnya sendiri (lihat `lockPeriodForPosting`).
 */
export async function ensurePeriodRows(
  client: Prisma.TransactionClient,
  months: Array<{ year: number; month: number }>,
): Promise<void> {
  const model = periodModel(client);
  if (!model || months.length === 0) return;
  await model.createMany({ data: months.map((m) => ({ year: m.year, month: m.month })), skipDuplicates: true });
}

/**
 * Perilaku saat tanggal jurnal jatuh di bulan TERTUTUP:
 * - `shift`  — jurnal otomatis: digeser ke tanggal 1 bulan TERBUKA berikutnya,
 *              tanggal aslinya disimpan (`originalDate`) dan disebut di keterangan
 *              (keputusan sementara pemilik no. 38);
 * - `refuse` — jurnal manual / draf: ditolak (`PERIOD_CLOSED`);
 * - `allow`  — jurnal tutup tahun milik penutupan itu sendiri (bulan-bulannya
 *              memang sudah ditutup lebih dulu). Tidak mengunci apa pun.
 */
export type ClosedPeriodMode = "shift" | "refuse" | "allow";

/** Batas langkah maju saat menggeser — dua tahun bulan tertutup berturut-turut berarti ada yang salah. */
const MAKS_LANGKAH_GESER = 24;

export class PeriodClosedError extends Error {
  constructor(
    public year: number,
    public month: number,
  ) {
    super(`PERIOD_CLOSED ${year}-${String(month).padStart(2, "0")}`);
    this.name = "PeriodClosedError";
  }
}

/**
 * Tanggal posting yang berlaku untuk `date` menurut `mode`, dengan baris
 * periode tujuan TERKUNCI. `shifted` = tanggal asli yang digeser, atau null.
 */
export async function resolvePostingDate(
  tx: Prisma.TransactionClient,
  date: Date,
  mode: ClosedPeriodMode,
): Promise<{ date: Date; shiftedFrom: Date | null }> {
  if (mode === "allow") return { date, shiftedFrom: null };
  if ((await lockPeriodForPosting(tx, date)) === STATUS_PERIODE.OPEN) return { date, shiftedFrom: null };

  const asal = wibYearMonth(date);
  if (mode === "refuse") throw new PeriodClosedError(asal.year, asal.month);

  let ym = asal;
  for (let langkah = 0; langkah < MAKS_LANGKAH_GESER; langkah++) {
    ym = nextYearMonth(ym);
    const kandidat = firstDayOfMonthWib(ym.year, ym.month);
    if ((await lockPeriodForPosting(tx, kandidat)) === STATUS_PERIODE.OPEN) {
      return { date: kandidat, shiftedFrom: date };
    }
  }
  throw new PeriodClosedError(asal.year, asal.month);
}
