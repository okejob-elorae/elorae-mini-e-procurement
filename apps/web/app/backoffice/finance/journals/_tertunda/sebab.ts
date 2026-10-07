import type { SumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";

/*
 * Tampilan tab "Tertunda" di halaman Jurnal. Murni (tanpa Prisma) — modul
 * `lib/finance/jurnal-tertunda.ts` hanya diimpor sebagai tipe.
 */

/** KONTRAK: Beranda menautkan baris "Jurnal gagal" ke `/backoffice/finance/journals?status=tertunda`. */
export const STATUS_TERTUNDA = "tertunda";

export type StatusJurnal = "terposting" | "tertunda";

export function bacaStatusJurnal(raw: string | undefined): StatusJurnal {
  return raw?.trim().toLowerCase() === STATUS_TERTUNDA ? "tertunda" : "terposting";
}

/**
 * Kode kegagalan yang ditulis para penulis `JOURNAL_PENDING` (jurnal otomatis,
 * pembayaran pemasok, retur penjualan). Setiap kode punya kalimatnya di
 * `financeJournals.tertunda.sebab.<KODE>`; kode di luar daftar ini tampil
 * sebagai `LAIN`, tidak pernah sebagai kode mentah.
 */
export const SEBAB_DIKENAL = [
  "UNMAPPED_ROLE",
  "UNBALANCED",
  "NON_POSTABLE_ACCOUNT",
  "ERROR",
  "NOTHING_TO_POST",
  "AP_ACCOUNT_MISMATCH",
  "GRN_APPROVAL_PENDING",
  "GRN_JOURNALS_INCOMPLETE",
  "GRN_REVERSAL_MISSING",
  "PAYMENT_SUPERSEDED",
  "PO_IS_PAID",
  "ORIGINAL_SALE_NOT_JOURNALED_YET",
  "ORIGINAL_SALE_UNLINKED",
  "ORIGINAL_SALE_OUTSIDE_LEDGER",
  "GL_CUTOVER_NOT_CONFIGURED",
] as const;

export type SebabDikenal = (typeof SEBAB_DIKENAL)[number];

const DIKENAL = new Set<string>(SEBAB_DIKENAL);

export function kunciSebab(sebab: string | null): SebabDikenal | "LAIN" {
  return sebab && DIKENAL.has(sebab) ? (sebab as SebabDikenal) : "LAIN";
}

/** Sebab yang diperbaiki di Keuangan → Pemetaan Akun (lalu posting ulang). */
const SEBAB_PEMETAAN = new Set(["UNMAPPED_ROLE", "NON_POSTABLE_ACCOUNT", "AP_ACCOUNT_MISMATCH"]);

export function perluPemetaanAkun(sebab: string | null): boolean {
  return sebab != null && SEBAB_PEMETAAN.has(sebab);
}

/** Jenis sumber jurnal (untuk label & tautan) dan id dokumennya. */
export function jenisDanIdSumber(sumber: SumberNotifikasiJurnal | null): { jenis: string; id: string } | null {
  if (!sumber) return null;
  if (sumber.tipe === "dokumen") return { jenis: sumber.sourceType, id: sumber.sourceId };
  return {
    jenis: sumber.arah === "payment" ? "SUPPLIER_PAYMENT" : "SUPPLIER_PAYMENT_REVERSAL",
    id: sumber.poId,
  };
}

/**
 * Jurnal penjualan marketplace diposting ulang OTOMATIS oleh sapuan 5 menit
 * (`lib/finance/sales/sweep.ts`) begitu penyebabnya beres — tidak ada tombol
 * "Post journal" di halaman pesanannya.
 */
export function postingUlangOtomatis(jenis: string | null): boolean {
  return jenis === "SALESORDER_REVENUE" || jenis === "SALESORDER_COGS";
}
