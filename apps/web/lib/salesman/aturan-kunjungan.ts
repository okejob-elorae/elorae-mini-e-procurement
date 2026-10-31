/**
 * Aturan kunjungan salesman yang diatur pemilik di Pengaturan → Salesman —
 * murni, tanpa basis data. Disimpan sebagai JSON di `SystemSetting`; nilai
 * rusak dibaca sebagai bawaan PER KOLOM dan tidak pernah dilempar, supaya satu
 * baris setelan yang rusak tidak mematikan check-in/check-out di lapangan.
 *
 * - `salesman.hasilKunjungan`: alasan wajib bila pulang tanpa transaksi
 *   (bawaan WAJIB) dan foto sebelum check-out (bawaan TIDAK wajib).
 * - `salesman.checkin`: mode radius (bawaan PERINGATAN = perilaku lama) dan
 *   batas akurasi GPS yang masih dianggap wajar (bawaan 100 m).
 */

export const KUNCI_HASIL_KUNJUNGAN = "salesman.hasilKunjungan";
export const KUNCI_ATURAN_CHECKIN = "salesman.checkin";
/** Kunci lama radius check-in global (angka polos, bukan JSON) — dibaca `checkIn`. */
export const KUNCI_RADIUS_GLOBAL = "checkin.radiusMeters";

export type AturanHasilKunjungan = {
  /** Salesman harus memilih alasan bila kunjungan tidak menghasilkan transaksi. */
  alasanWajib: boolean;
  /** Minimal satu foto kunjungan sebelum check-out (dijaga di HP saja). */
  fotoWajib: boolean;
};

export const ATURAN_HASIL_BAWAAN: AturanHasilKunjungan = { alasanWajib: true, fotoWajib: false };

export type ModeRadius = "PERINGATAN" | "TOLAK";
export const MODE_RADIUS: readonly ModeRadius[] = ["PERINGATAN", "TOLAK"];

export type AturanCheckin = {
  /** PERINGATAN: di luar radius tetap boleh, hanya ditandai. TOLAK: check-in ditolak. */
  modeRadius: ModeRadius;
  /** Akurasi GPS (meter) di atas angka ini menandai check-in "akurasi buruk". */
  akurasiMaksMeter: number;
};

export const ATURAN_CHECKIN_BAWAAN: AturanCheckin = { modeRadius: "PERINGATAN", akurasiMaksMeter: 100 };

export const AKURASI_MAKS_MIN = 10;
export const AKURASI_MAKS_MAKS = 5000;
export const RADIUS_GLOBAL_MIN = 10;
export const RADIUS_GLOBAL_MAKS = 5000;

const bulatDalam = (x: unknown, min: number, maks: number): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= min && x <= maks;

function bacaObjek(nilai: string | null | undefined): Record<string, unknown> | null {
  if (!nilai) return null;
  try {
    const x: unknown = JSON.parse(nilai);
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function bacaAturanHasilKunjungan(nilai: string | null | undefined): AturanHasilKunjungan {
  const x = bacaObjek(nilai);
  if (!x) return ATURAN_HASIL_BAWAAN;
  return {
    alasanWajib: typeof x.alasanWajib === "boolean" ? x.alasanWajib : ATURAN_HASIL_BAWAAN.alasanWajib,
    fotoWajib: typeof x.fotoWajib === "boolean" ? x.fotoWajib : ATURAN_HASIL_BAWAAN.fotoWajib,
  };
}

/** JSON untuk disimpan, atau `null` bila bentuknya tidak sah. */
export function tulisAturanHasilKunjungan(a: AturanHasilKunjungan): string | null {
  if (!a || typeof a !== "object") return null;
  if (typeof a.alasanWajib !== "boolean" || typeof a.fotoWajib !== "boolean") return null;
  return JSON.stringify({ alasanWajib: a.alasanWajib, fotoWajib: a.fotoWajib });
}

export function bacaAturanCheckin(nilai: string | null | undefined): AturanCheckin {
  const x = bacaObjek(nilai);
  if (!x) return ATURAN_CHECKIN_BAWAAN;
  return {
    modeRadius: MODE_RADIUS.includes(x.modeRadius as ModeRadius)
      ? (x.modeRadius as ModeRadius)
      : ATURAN_CHECKIN_BAWAAN.modeRadius,
    akurasiMaksMeter: bulatDalam(x.akurasiMaksMeter, AKURASI_MAKS_MIN, AKURASI_MAKS_MAKS)
      ? x.akurasiMaksMeter
      : ATURAN_CHECKIN_BAWAAN.akurasiMaksMeter,
  };
}

/** JSON untuk disimpan, atau `null` bila bentuknya tidak sah. */
export function tulisAturanCheckin(a: AturanCheckin): string | null {
  if (!a || typeof a !== "object") return null;
  if (!MODE_RADIUS.includes(a.modeRadius)) return null;
  if (!bulatDalam(a.akurasiMaksMeter, AKURASI_MAKS_MIN, AKURASI_MAKS_MAKS)) return null;
  return JSON.stringify({ modeRadius: a.modeRadius, akurasiMaksMeter: a.akurasiMaksMeter });
}

/** Radius check-in global yang boleh disimpan dari layar pengaturan. */
export function sahRadiusGlobal(x: unknown): x is number {
  return bulatDalam(x, RADIUS_GLOBAL_MIN, RADIUS_GLOBAL_MAKS);
}
