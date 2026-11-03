/**
 * Utang SPG yang sudah berhenti — aturan murni (keputusan pemilik 2026-11-02).
 *
 * "Saya tidak ada istilah iklas" (P6): pembayaran TERAKHIR SPG yang berhenti membayar semua koreksi
 * plus dan memotong semua pengurangnya; yang tidak tertutup dicatat sebagai utang SPG yang ditagih
 * (P6a, `SpgDebt`, satu baris per sumber). Koreksi plus yang muncul sesudahnya mengurangi utangnya
 * dulu, sisanya dibayar terpisah (P67, `SpgExtraPayout`). Pembayaran utang dicatat admin atau
 * Keuangan (P68) dan baru mengurangi utang sesudah dicocokkan dengan mutasi rekening oleh orang lain
 * (keputusan 11, `payments:verify`) — sampai itu MENUNGGU_CEK dan tidak mengurangi apa pun.
 */

/** `refType`/`createdRefType` yang menunjuk utang SPG. */
export const REF_UTANG_SPG = "SpgDebt";
/** `createdRefType` utang yang dicatat dari sisa sesudah pembayaran terakhir (`catatSisaSpgBerhenti`). */
export const REF_CATAT_SISA_SPG = "SpgDebtRecording";
/** `paidRefType` koreksi plus yang dibayar sesudah pembayaran terakhir. */
export const REF_BAYAR_TAMBAHAN_SPG = "SpgExtraPayout";
export const REF_BAYAR_UTANG_SPG = "SpgDebtPayment";

export const JENIS_UTANG_SPG = ["KOREKSI", "BARANG_HILANG", "RETUR_PEMBELI"] as const;
export type JenisUtangSpg = (typeof JENIS_UTANG_SPG)[number];

export const STATUS_UTANG_SPG = ["TERBUKA", "LUNAS"] as const;

export const STATUS_BAYAR_UTANG_SPG = ["MENUNGGU_CEK", "TERVERIFIKASI", "DIKEMBALIKAN", "DIBATALKAN"] as const;
export type StatusBayarUtangSpg = (typeof STATUS_BAYAR_UTANG_SPG)[number];

export const CARA_BAYAR_UTANG_SPG = ["tunai", "transfer"] as const;
export type CaraBayarUtangSpg = (typeof CARA_BAYAR_UTANG_SPG)[number];

/** `AuditLog.action` — label di `auditActions.actions.<KODE>`. */
export const JEJAK_UTANG_SPG = {
  DIBUAT: "SPG_DEBT_CREATED",
  BAYAR_DICATAT: "SPG_DEBT_PAYMENT_RECORDED",
  BAYAR_DIREVISI: "SPG_DEBT_PAYMENT_REVISED",
  BAYAR_DIVERIFIKASI: "SPG_DEBT_PAYMENT_VERIFIED",
  BAYAR_DIKEMBALIKAN: "SPG_DEBT_PAYMENT_RETURNED",
  BAYAR_DIBATALKAN: "SPG_DEBT_PAYMENT_VOIDED",
  IMBANG: "SPG_DEBT_OFFSET",
  TAMBAHAN_DIBAYAR: "SPG_EXTRA_PAYOUT_RECORDED",
} as const;

export const ENTITAS_UTANG_SPG = "SpgDebt";
export const ENTITAS_BAYAR_UTANG_SPG = "SpgDebtPayment";
export const ENTITAS_BAYAR_TAMBAHAN_SPG = "SpgExtraPayout";

/** Kategori `AdminNotification` (registri Izin). */
export const KATEGORI_NOTIF_UTANG_SPG = {
  BAYAR_DIAJUKAN: "SPG_DEBT_PAYMENT_SUBMITTED",
  BAYAR_DIKEMBALIKAN: "SPG_DEBT_PAYMENT_RETURNED",
} as const;

export const MAKS_CATATAN_UTANG = 500;
export const MAKS_KUNCI_UTANG = 100;

export function bacaCaraBayarUtang(x: unknown): CaraBayarUtangSpg | null {
  return typeof x === "string" && (CARA_BAYAR_UTANG_SPG as readonly string[]).includes(x) ? (x as CaraBayarUtangSpg) : null;
}

/** Bagikan `jumlahSen` ke utang yang belum lunas, BERURUTAN (yang terlama dulu — urutan pemanggil). */
export function alokasiUtang(utang: ReadonlyArray<{ id: string; sisaSen: number }>, jumlahSen: number): { id: string; sen: number }[] {
  let sisa = Math.max(0, Math.floor(jumlahSen));
  const hasil: { id: string; sen: number }[] = [];
  for (const u of utang) {
    if (sisa <= 0) break;
    const ambil = Math.min(sisa, Math.max(0, u.sisaSen));
    if (ambil <= 0) continue;
    hasil.push({ id: u.id, sen: ambil });
    sisa -= ambil;
  }
  return hasil;
}

/** Tanggal "YYYY-MM-DD" yang sah dan tidak di depan `hariIni`. */
export function tanggalBayarSah(x: unknown, hariIni: string): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== x) return false;
  return x <= hariIni;
}
