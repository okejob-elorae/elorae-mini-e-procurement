/**
 * Giro (bilyet giro) pada laporan pelunasan — aturan murni, tanpa basis data.
 *
 * Giro adalah janji bank untuk membayar pada TANGGAL EFEKTIF, bukan uang. Selama
 * bilyetnya belum dikliringkan dan cair, piutangnya belum berkurang sepeser pun
 * — Aturan 1 ("klaim bukan lunas") berlaku dua kali di sini: sekali untuk
 * laporan sales, sekali lagi untuk kertas giro yang ia bawa pulang.
 *
 * Aman dibundel ke klien: formulir BKM memakai validasi yang SAMA dengan
 * penulisnya, supaya penolakan terlihat sebelum seluruh formulir terisi.
 */

/**
 * Masa berlaku bilyet giro: 70 hari sejak tanggal terbit (tanggal penarikan).
 *
 * PBI 18/41/PBI/2016 tentang Bilyet Giro. Tanggal efektif harus jatuh di dalam
 * tenggang waktu ini; giro yang diunjukkan sesudahnya ditolak bank. Menerima
 * giro dengan tanggal efektif di luar batas berarti menerima kertas yang tidak
 * akan pernah jadi uang.
 */
export const MASA_BERLAKU_GIRO_HARI = 70;

export const STATUS_GIRO = {
  MENUNGGU: 'MENUNGGU',
  CAIR: 'CAIR',
  DITOLAK: 'DITOLAK',
} as const;

export type StatusGiro = (typeof STATUS_GIRO)[keyof typeof STATUS_GIRO];

export type AlasanGiro =
  | 'GIRO_NOMOR_WAJIB'
  | 'GIRO_BANK_WAJIB'
  | 'GIRO_TANGGAL_WAJIB'
  | 'GIRO_EFEKTIF_SEBELUM_TERBIT'
  | 'GIRO_LEWAT_MASA_BERLAKU';

const HARI_MS = 24 * 60 * 60 * 1000;
const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "YYYY-MM-DD" → tengah malam WIB. `null` kalau bukan tanggal yang ada.
 *
 * Tanggal kalender dari `<input type="date">` tidak punya zona; dibaca sebagai
 * UTC, giro yang efektif hari ini tercatat kemarin bagi siapa pun di Jakarta.
 * "2026-02-31" ditolak, bukan digeser diam-diam ke 3 Maret.
 */
export function tanggalWib(teks: string): Date | null {
  const m = POLA_TANGGAL.exec(teks ?? '');
  if (!m) return null;
  const [, y, mo, da] = m.map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, da));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== da) return null;
  return new Date(`${teks}T00:00:00+07:00`);
}

/** Hari kalender WIB sebuah waktu, sebagai "YYYY-MM-DD". */
export function hariWib(waktu: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(waktu);
}

/** Selisih hari kalender antara dua "YYYY-MM-DD" (b − a). */
function selisihHariTeks(a: string, b: string): number {
  const ms = (t: string) => {
    const [y, mo, da] = t.split('-').map(Number);
    return Date.UTC(y, mo - 1, da);
  };
  return Math.round((ms(b) - ms(a)) / HARI_MS);
}

/** Tambah `n` hari kalender pada "YYYY-MM-DD". `null` kalau teksnya bukan tanggal. */
export function tambahHari(teks: string, n: number): string | null {
  if (!tanggalWib(teks)) return null;
  const [y, mo, da] = teks.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10);
}

export type GiroSah = {
  nomor: string;
  bank: string;
  tanggalTerbit: Date;
  tanggalEfektif: Date;
};

/**
 * Periksa isian giro pada BKM.
 *
 * Nomor dan bank wajib karena keduanya yang dicocokkan admin keuangan dengan
 * mutasi kliring; tanpa itu giro yang cair tidak bisa dipasangkan dengan
 * laporan mana pun.
 */
export function periksaGiro(g: {
  nomor: string | null | undefined;
  bank: string | null | undefined;
  tanggalTerbit: Date | null | undefined;
  tanggalEfektif: Date | null | undefined;
}): { ok: true; giro: GiroSah } | { ok: false; alasan: AlasanGiro } {
  const nomor = g.nomor?.trim() ?? '';
  const bank = g.bank?.trim() ?? '';
  if (!nomor) return { ok: false, alasan: 'GIRO_NOMOR_WAJIB' };
  if (!bank) return { ok: false, alasan: 'GIRO_BANK_WAJIB' };
  if (!g.tanggalTerbit || !g.tanggalEfektif) return { ok: false, alasan: 'GIRO_TANGGAL_WAJIB' };

  const jarak = selisihHariTeks(hariWib(g.tanggalTerbit), hariWib(g.tanggalEfektif));
  if (jarak < 0) return { ok: false, alasan: 'GIRO_EFEKTIF_SEBELUM_TERBIT' };
  if (jarak > MASA_BERLAKU_GIRO_HARI) return { ok: false, alasan: 'GIRO_LEWAT_MASA_BERLAKU' };

  return {
    ok: true,
    giro: { nomor, bank, tanggalTerbit: g.tanggalTerbit, tanggalEfektif: g.tanggalEfektif },
  };
}

/**
 * Apakah verifikasi sebuah klaim harus ditolak karena giro-nya belum cair.
 *
 * Hanya `MENUNGGU` yang menahan. `CAIR` berarti uangnya sudah masuk; `null`
 * berarti klaim itu bukan giro — atau giro yang dicatat sebelum kolom ini ada,
 * yang tetap diverifikasi lewat mutasi rekening seperti dulu.
 */
export function giroMenahanVerifikasi(giroStatus: string | null | undefined): boolean {
  return giroStatus === STATUS_GIRO.MENUNGGU;
}

export type KelompokGiro = 'LEWAT' | 'HARI_INI' | 'PEKAN_INI' | 'NANTI';

export const URUTAN_KELOMPOK_GIRO: KelompokGiro[] = ['LEWAT', 'HARI_INI', 'PEKAN_INI', 'NANTI'];

/**
 * Kapan giro yang masih menunggu harus disetorkan, menurut hari kalender WIB.
 * `PEKAN_INI` = satu sampai tujuh hari ke depan.
 */
export function kelompokGiro(tanggalEfektif: Date, sekarang: Date): KelompokGiro {
  const jarak = selisihHariTeks(hariWib(sekarang), hariWib(tanggalEfektif));
  if (jarak < 0) return 'LEWAT';
  if (jarak === 0) return 'HARI_INI';
  if (jarak <= 7) return 'PEKAN_INI';
  return 'NANTI';
}

/**
 * Masa berlaku bilyetnya sudah habis — lebih dari 70 hari sejak terbit.
 * Giro seperti ini tidak lagi bisa diunjukkan; menunggunya cair sia-sia, yang
 * perlu dilakukan adalah meminta toko menggantinya.
 */
export function giroKedaluwarsa(tanggalTerbit: Date, sekarang: Date): boolean {
  return selisihHariTeks(hariWib(tanggalTerbit), hariWib(sekarang)) > MASA_BERLAKU_GIRO_HARI;
}

export type RingkasanGiro = Record<KelompokGiro, { jumlah: number; nilai: number }>;

/** Jumlah dan nilai giro menunggu per kelompok jatuh tempo. */
export function ringkasGiro(
  giro: { tanggalEfektif: Date; nilai: number }[],
  sekarang: Date,
): RingkasanGiro {
  const hasil: RingkasanGiro = {
    LEWAT: { jumlah: 0, nilai: 0 },
    HARI_INI: { jumlah: 0, nilai: 0 },
    PEKAN_INI: { jumlah: 0, nilai: 0 },
    NANTI: { jumlah: 0, nilai: 0 },
  };
  for (const g of giro) {
    const k = kelompokGiro(g.tanggalEfektif, sekarang);
    hasil[k].jumlah += 1;
    hasil[k].nilai += g.nilai;
  }
  return hasil;
}
