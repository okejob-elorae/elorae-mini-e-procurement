import type { KanalJurnal } from "@/lib/finance/journals/kanal";
import type { PostingRole } from "@/lib/constants/journal-roles";

/*
 * Saldo awal buku besar per tanggal mulai (`finance.glCutoverDate`).
 *
 * Murni — dipakai layar dan penulis. Satu `OpeningBalanceImport` per jenis
 * yang BERLAKU (status POSTED); memposting ulang membalik jurnal lama lalu
 * memposting yang baru (keduanya `sourceType = "OPENING"`, lihat
 * `SUMBER_JURNAL_SALDO_AWAL`), selama periode jurnalnya belum ditutup.
 */

export const JENIS_SALDO_AWAL = ["ACCOUNTS", "INVENTORY", "AR_STORE", "AR_MARKETPLACE", "AP"] as const;
export type JenisSaldoAwal = (typeof JENIS_SALDO_AWAL)[number];

/** Segmen URL `?jenis=` per jenis. */
export const SLUG_JENIS_SALDO_AWAL: Record<JenisSaldoAwal, string> = {
  ACCOUNTS: "akun",
  INVENTORY: "persediaan",
  AR_STORE: "piutang-toko",
  AR_MARKETPLACE: "piutang-marketplace",
  AP: "utang",
};

export function jenisDariSlug(slug: string | null | undefined): JenisSaldoAwal | null {
  const hit = JENIS_SALDO_AWAL.find((j) => SLUG_JENIS_SALDO_AWAL[j] === slug);
  return hit ?? null;
}

export function jenisSah(v: unknown): v is JenisSaldoAwal {
  return typeof v === "string" && (JENIS_SALDO_AWAL as readonly string[]).includes(v);
}

/** Judul jenis di uraian jurnal (data, selalu bahasa Indonesia). */
export const LABEL_JURNAL_JENIS: Record<JenisSaldoAwal, string> = {
  ACCOUNTS: "kas, bank & akun lain",
  INVENTORY: "persediaan",
  AR_STORE: "piutang toko",
  AR_MARKETPLACE: "piutang marketplace",
  AP: "utang pemasok",
};

/** Uraian jurnal: `OPENING/<jenis>/<tanggal mulai> · Saldo awal …`. */
export function uraianJurnalSaldoAwal(jenis: JenisSaldoAwal, tanggalMulai: string): string {
  return `OPENING/${SLUG_JENIS_SALDO_AWAL[jenis].toUpperCase()}/${tanggalMulai} · Saldo awal ${LABEL_JURNAL_JENIS[jenis]} per tanggal mulai buku besar`;
}

/** `OpeningBalanceImport.status`. REVERSED = posting lama yang sudah dibalik oleh posting ulang. */
export const STATUS_SALDO_AWAL = { DRAF: "DRAFT", DIPOSTING: "POSTED", DIBALIK: "REVERSED" } as const;
export type StatusSaldoAwal = (typeof STATUS_SALDO_AWAL)[keyof typeof STATUS_SALDO_AWAL];

/**
 * `Journal.sourceType` jurnal saldo awal DAN pembaliknya. Satu nilai untuk
 * keduanya, supaya laporan yang mengecualikan saldo awal (arus kas) cukup
 * menyaring satu sourceType. `sourceId` = id `OpeningBalanceImport`; pembalik
 * memakai `<id>:balik` dan mengisi `reversalOfId`.
 */
export const SUMBER_JURNAL_SALDO_AWAL = "OPENING";
export const AKHIRAN_BALIK = ":balik";

export function idSumberBalik(importId: string): string {
  return `${importId}${AKHIRAN_BALIK}`;
}

/** Id `OpeningBalanceImport` dari `Journal.sourceId` jurnal OPENING (asli maupun pembalik). */
export function importIdDariSumber(sourceId: string): string {
  return sourceId.endsWith(AKHIRAN_BALIK) ? sourceId.slice(0, -AKHIRAN_BALIK.length) : sourceId;
}

/** Nama tindakan jejak (`AuditLog.action`). */
export const JEJAK_SALDO_AWAL = {
  DRAF: "OPENING_BALANCE_DRAFT_SAVED",
  DRAF_DIHAPUS: "OPENING_BALANCE_DRAFT_DELETED",
  DIPOSTING: "OPENING_BALANCE_POSTED",
  DIBALIK: "OPENING_BALANCE_REVERSED",
} as const;

/**
 * `OpeningBalanceImport.kind` yang disimpan. `ruang` hanya untuk tes: jenis
 * berawalan ruang tidak pernah terbaca layar atau spanduk kesiapan, jadi tes
 * tidak bisa membalik saldo awal sungguhan di basis data bersama.
 */
export function kunciJenis(jenis: JenisSaldoAwal, ruang?: string): string {
  return ruang ? `${ruang}:${jenis}` : jenis;
}

/** Peran yang dikelola jenis lain — akunnya tidak boleh diisi di saldo akun (tercatat dua kali). */
export const PERAN_MILIK_JENIS_LAIN: readonly PostingRole[] = ["INVENTORY", "INVENTORY_FG", "AR_STORE", "AR", "AP", "OPENING_EQUITY"];

/** Tipe akun yang boleh diisi di saldo akun: hanya akun neraca. */
export const TIPE_AKUN_SALDO_AWAL = ["ASET", "LIABILITAS", "EKUITAS"] as const;

// ── Isian per jenis (disimpan di `OpeningBalanceImport.entries`) ─────────────

export type EntriAkun = { akunId: string; kode?: string; nama?: string; debit: number; kredit: number; catatan?: string };

export type EntriPersediaan = {
  itemId: string;
  variantSku: string | null;
  hpp: number;
  /** Diisi saat diposting (dari stok saat itu). */
  sku?: string;
  nama?: string;
  qty?: number;
  hppLama?: number;
  nilaiLama?: number;
  nilaiBaru?: number;
};

export type EntriPiutangToko = { storeId: string; kode?: string; nama?: string; faktur: number; jumlah: number };

export type EntriPiutangMarketplace = { kanal: KanalJurnal; pesanan?: number; dihitung?: number; jumlah: number };

export type EntriHutang = { supplierId: string; kode?: string; nama?: string; grn?: number; dihitung?: number; jumlah: number };

export type EntriSaldoAwal = {
  ACCOUNTS: EntriAkun;
  INVENTORY: EntriPersediaan;
  AR_STORE: EntriPiutangToko;
  AR_MARKETPLACE: EntriPiutangMarketplace;
  AP: EntriHutang;
};

export type RingkasanIsian = {
  /** Efek bersih ke Ekuitas saldo awal (kredit positif). */
  ekuitas: number;
  /** Hanya persediaan: nilai jurnal kumulatif per peran (lihat penulis). */
  nilaiPerPeran?: Partial<Record<"INVENTORY" | "INVENTORY_FG", number>>;
  /** Tanggal mulai (YYYY-MM-DD) yang dipakai saat diposting. */
  tanggalMulai?: string;
};

export type IsiSaldoAwal<J extends JenisSaldoAwal = JenisSaldoAwal> = {
  versi: 1;
  baris: EntriSaldoAwal[J][];
  ringkasan?: RingkasanIsian;
};

/** Baca `entries` Json dengan longgar — data lama/rusak menjadi isian kosong, tidak melempar. */
export function bacaIsian<J extends JenisSaldoAwal>(json: unknown): IsiSaldoAwal<J> {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as { baris?: unknown; ringkasan?: unknown };
    const baris = Array.isArray(o.baris) ? (o.baris as EntriSaldoAwal[J][]) : [];
    const ringkasan = o.ringkasan && typeof o.ringkasan === "object" ? (o.ringkasan as RingkasanIsian) : undefined;
    return { versi: 1, baris, ...(ringkasan ? { ringkasan } : {}) };
  }
  return { versi: 1, baris: [] };
}
