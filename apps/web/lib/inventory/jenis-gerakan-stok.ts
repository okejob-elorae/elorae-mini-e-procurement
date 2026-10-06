/**
 * Kode jenis gerakan stok gudang dan saringan sumber daftar penyesuaian.
 * Aman untuk komponen klien: tidak mengimpor `@elorae/db` (barel utamanya
 * menyeret Prisma ke bundel peramban).
 *
 * Dua kelompok kode berbagi satu namespace label `inventory.stockMoveKind`:
 *  - `refType` StockMovement (GRN, WO_ISSUE, OPNAME, …);
 *  - `source` StockAdjustment (FULFILLMENT_CONSUME, VAN_LOAD, …).
 * Kode yang belum punya label (penulis baru) tampil sebagai ejaan manusiawi
 * kodenya, tidak pernah SNAKE_CASE mentah.
 */
import { humanizeAuditCode } from "@/lib/audit/action-label";

/** refType StockMovement yang ditulis penulis di codebase ini. */
export const REF_GERAKAN_STOK = [
  "GRN",
  "GRN_OWNER_DECLINE",
  "WO_ISSUE",
  "WO_RECEIPT",
  "FG_RECEIPT",
  "ADJUSTMENT",
  "OPNAME",
  "RECON",
  "VENDOR_RETURN",
  "RETURN",
] as const;

/**
 * Nilai `StockAdjustment.source`. Mencakup registri `STOCK_ADJUSTMENT_SOURCES`
 * di @elorae/db (dijaga tes) ditambah sumber yang ditulis di apps/web
 * (tukar barang, seeding KOL).
 */
export const SUMBER_PENYESUAIAN = [
  "ERP",
  "ERP_OPNAME",
  "ERP_RETURN_ACCEPT",
  "FULFILLMENT_CONSUME",
  "FIELD_SALES_CONSUME",
  "JUBELIO_WEBHOOK",
  "JUBELIO_RECONCILE",
  "VAN_LOAD",
  "VAN_RETURN",
  "STORE_RETURN_RECEIVE",
  "KONSI_TRANSFER",
  "STORE_EXCHANGE_OUT",
  "STORE_EXCHANGE_IN",
  "KOL_SEEDING",
] as const;

/** Keputusan orang kantor/gudang: penyesuaian manual (termasuk stok awal) dan opname. */
export const SUMBER_MANUAL = ["ERP", "ERP_OPNAME"] as const;

/**
 * Sumber yang ditulis sistem sebagai akibat dokumen lain atau integrasi.
 * Disembunyikan di daftar penyesuaian secara bawaan. Sengaja daftar HITAM:
 * sumber baru yang belum dikenal tetap tampil, tidak hilang diam-diam.
 */
export const SUMBER_OTOMATIS: readonly string[] = SUMBER_PENYESUAIAN.filter(
  (s) => !(SUMBER_MANUAL as readonly string[]).includes(s),
);

/** Saringan sumber: kelompok, atau satu kode sumber. */
export const SARINGAN_SUMBER_MANUAL = "manual";
export const SARINGAN_SUMBER_SEMUA = "semua";
export const SARINGAN_SUMBER_OTOMATIS = "otomatis";
export const SARINGAN_SUMBER_BAWAAN = SARINGAN_SUMBER_MANUAL;

const POLA_KODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Potongan `where` Prisma untuk saringan sumber. Nilai tak dikenal (bukan
 * kelompok dan bukan kode berbentuk SNAKE_CASE) jatuh ke bawaan.
 */
export function whereSaringanSumber(saringan?: string | null): { source?: string | { in: string[] } | { notIn: string[] } } {
  const s = (saringan ?? "").trim();
  if (s === SARINGAN_SUMBER_SEMUA) return {};
  if (s === SARINGAN_SUMBER_OTOMATIS) return { source: { in: [...SUMBER_OTOMATIS] } };
  if (s !== SARINGAN_SUMBER_MANUAL && POLA_KODE.test(s)) return { source: s };
  return { source: { notIn: [...SUMBER_OTOMATIS] } };
}

/** Potongan translator next-intl yang dibutuhkan. */
export type PenerjemahJenis = {
  (key: string): string;
  has: (key: string) => boolean;
};

/** Label jenis gerakan untuk `t = useTranslations("inventory.stockMoveKind")`. */
export function labelJenisGerakan(t: PenerjemahJenis, kode: string | null | undefined): string {
  const k = (kode ?? "").trim();
  if (!k) return "";
  if (POLA_KODE.test(k) && t.has(k)) return t(k);
  return humanizeAuditCode(k);
}
