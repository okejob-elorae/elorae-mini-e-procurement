/**
 * Waktu tangkap kiriman dari antrean HP (dicatat tanpa sinyal) — murni.
 *
 * Pekerjaan yang dicatat tanpa sinyal tercatat pada waktu ia DILAKUKAN di HP,
 * bukan saat sinyal kembali: check-in pada jam SPG tiba, tanda terima pada jam
 * kiriman dihitung, opname pada jam rak dihitung. Jam HP tidak dipercaya buta:
 *
 * - jam yang MAJU (masa depan) dijepit ke sekarang — tidak ada catatan "dari
 *   masa depan";
 * - jam yang terlalu TUA ditolak (`null`) — HP yang tanggalnya salah, atau
 *   antrean yang tertahan terlalu lama untuk dipercaya.
 */

/**
 * Check-in tanpa sinyal yang lebih tua dari ini ditolak saat sinkron. SAMA
 * dengan batas nota dan stok tanpa sinyal: nota diikat ke check-in-nya, jadi
 * check-in yang ditolak menggagalkan SEMUA nota kunjungan itu — batas yang lebih
 * pendek (mula-mula 12 jam) membuat SPG yang seharian tanpa sinyal kehilangan
 * catatan uang sehari penuh, padahal jamnya tetap jam HP.
 */
export const BATAS_UMUR_CHECKIN_LURING_HARI = 14;
/** Terima kiriman dan opname tanpa sinyal — sama dengan batas nota SPG tanpa sinyal. */
export const BATAS_UMUR_STOK_LURING_HARI = 14;

export const BATAS_CHECKIN_LURING_MS = BATAS_UMUR_CHECKIN_LURING_HARI * 86_400_000;
export const BATAS_STOK_LURING_MS = BATAS_UMUR_STOK_LURING_HARI * 86_400_000;

/**
 * Waktu tangkap yang sah, atau `null` bila tidak terbaca / lebih tua dari
 * `batasMs`. Masa depan dijepit ke `sekarang`.
 */
export function jepitWaktuLuring(waktu: Date | string | number | null | undefined, sekarang: Date, batasMs: number): Date | null {
  if (waktu === null || waktu === undefined || waktu === "") return null;
  const t = waktu instanceof Date ? waktu.getTime() : typeof waktu === "number" ? waktu : Date.parse(waktu);
  if (!Number.isFinite(t)) return null;
  const kini = sekarang.getTime();
  if (t > kini) return new Date(kini);
  if (t < kini - batasMs) return null;
  return new Date(t);
}
