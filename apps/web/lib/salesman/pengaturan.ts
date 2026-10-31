import { kunciHariWib } from '@/lib/dashboard/tren';

/**
 * Pengaturan dasbor salesman, disimpan di `SystemSetting` — tanpa tabel baru.
 *
 * Batas hari kunjungan ditetapkan pemilik sendiri. Selama belum diatur dipakai
 * `BATAS_HARI_BAWAAN`, dan layarnya menyebut "belum diatur" supaya angka itu
 * tidak dikira keputusan siapa pun.
 */

export const KUNCI_BATAS_HARI = 'salesman.visitIntervalDays';
export const KUNCI_TARGET = 'salesman.targets';
export const BATAS_HARI_BAWAAN = 14;
const BATAS_HARI_MAKS = 365;

export function bacaBatasHari(nilai: string | null | undefined): { hari: number; diatur: boolean } {
  const n = Number(nilai);
  if (nilai && Number.isInteger(n) && n >= 1 && n <= BATAS_HARI_MAKS) return { hari: n, diatur: true };
  return { hari: BATAS_HARI_BAWAAN, diatur: false };
}

/** "YYYY-MM" menurut kalender Jakarta. */
export function bulanWib(d: Date): string {
  return kunciHariWib(d).slice(0, 7);
}

type PetaTarget = Record<string, Record<string, number>>;

function bacaPeta(nilai: string | null | undefined): PetaTarget {
  if (!nilai) return {};
  try {
    const x = JSON.parse(nilai);
    return x && typeof x === 'object' && !Array.isArray(x) ? (x as PetaTarget) : {};
  } catch {
    return {};
  }
}

export function bacaTargetBulan(nilai: string | null | undefined, userId: string, bulan: string): number | null {
  const t = bacaPeta(nilai)[userId]?.[bulan];
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
}

/** Semua target satu bulan, untuk layar pengaturan admin. */
export function bacaTargetSemua(nilai: string | null | undefined, bulan: string): Record<string, number> {
  const hasil: Record<string, number> = {};
  for (const [userId, perBulan] of Object.entries(bacaPeta(nilai))) {
    const t = perBulan?.[bulan];
    if (typeof t === 'number' && t > 0) hasil[userId] = t;
  }
  return hasil;
}

/** Ubah satu sel; `null` menghapusnya. Salesman dan bulan lain tidak tersentuh. */
export function tulisTargetBulan(
  nilai: string | null | undefined,
  userId: string,
  bulan: string,
  jumlah: number | null,
): string {
  const peta = bacaPeta(nilai);
  const milik = { ...(peta[userId] ?? {}) };
  if (jumlah && jumlah > 0) milik[bulan] = Math.round(jumlah);
  else delete milik[bulan];
  if (Object.keys(milik).length) peta[userId] = milik;
  else delete peta[userId];
  return JSON.stringify(peta);
}

// ─── Kunci "hanya toko sendiri" ──────────────────────────────────────────────

/**
 * Saklar pemilik: saat menyala, sales hanya melihat dan check-in di toko yang
 * ia pegang (`Store.salesmanId`). BAWAAN MATI — menyalakannya sebelum semua
 * toko punya pemegang membuat sales di lapangan kehilangan tokonya.
 */
export const KUNCI_TOKO_TERKUNCI = 'salesman.tokoTerkunci';

export function bacaTokoTerkunci(nilai: string | null | undefined): boolean {
  return nilai === '1';
}
