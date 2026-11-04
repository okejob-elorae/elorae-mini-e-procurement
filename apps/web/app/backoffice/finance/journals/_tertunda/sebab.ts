import type { SumberNotifikasiJurnal } from "@/lib/finance/jurnal-tertunda";

/*
 * Tampilan tab "Tertunda" di halaman Jurnal. Murni (tanpa Prisma) — modul
 * `lib/finance/jurnal-tertunda.ts` hanya diimpor sebagai tipe.
 */

/** KONTRAK: Beranda menautkan baris "Jurnal gagal" ke `/backoffice/finance/journals?status=tertunda`. */
export const STATUS_TERTUNDA = "tertunda";

/** Tab jurnal manual yang menunggu persetujuan / yang ditolak (maker-checker, lib/finance/jurnal-manual). */
export const STATUS_DRAF = "draf";
export const STATUS_DITOLAK = "ditolak";

export type StatusJurnal = "terposting" | "tertunda" | "draf" | "ditolak";

export function bacaStatusJurnal(raw: string | undefined): StatusJurnal {
  const v = raw?.trim().toLowerCase();
  if (v === STATUS_TERTUNDA) return "tertunda";
  if (v === STATUS_DRAF) return "draf";
  if (v === STATUS_DITOLAK) return "ditolak";
  return "terposting";
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
  // Jurnal lapangan (lib/finance/lapangan): biaya barang yang keluar tidak ada di kartu stok.
  "BIAYA_TIDAK_DIKETAHUI",
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
  if (sumber.tipe === "kolaborasiKol") return { jenis: "KOL_KOLABORASI", id: sumber.kolaborasiId };
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

/**
 * Langkah posting ulang per jenis dokumen, untuk ditulis di bawah sebabnya
 * (`financeJournals.tertunda.langkah.<KUNCI>`). Pembayaran pemasok lama tidak
 * punya tombol "Posting jurnal": tanda bayarnya dibatalkan lalu ditandai lagi.
 */
export type LangkahPostingUlang = "OTOMATIS" | "BAYAR_PEMASOK" | "BALIK_BAYAR_PEMASOK" | "DOKUMEN";

export function langkahPostingUlang(jenis: string | null): LangkahPostingUlang {
  if (postingUlangOtomatis(jenis)) return "OTOMATIS";
  if (jenis === "SUPPLIER_PAYMENT") return "BAYAR_PEMASOK";
  if (jenis === "SUPPLIER_PAYMENT_REVERSAL") return "BALIK_BAYAR_PEMASOK";
  return "DOKUMEN";
}

/**
 * Sebab yang ditampilkan SEKARANG. Notifikasi `JOURNAL_PENDING` menyimpan
 * sebab saat gagal; sesudah peran dipetakan, "peran belum dipetakan" sudah
 * tidak benar lagi (audit G8: baris tertunda menyebut Utang Usaha belum
 * dipetakan di bawah spanduk "peran wajib 11/11"). `peranKiniTerpetakan` =
 * hasil pemeriksaan ulang pemetaan saat halaman dimuat.
 */
export function sebabTerkini(sebab: string | null, peranKiniTerpetakan: boolean | null): SebabDikenal | "LAIN" | "UNMAPPED_ROLE_SUDAH" {
  const kunci = kunciSebab(sebab);
  return kunci === "UNMAPPED_ROLE" && peranKiniTerpetakan === true ? "UNMAPPED_ROLE_SUDAH" : kunci;
}
