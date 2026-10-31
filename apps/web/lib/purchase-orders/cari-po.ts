import { cariTeks } from "@/lib/db/cari-teks";

/**
 * Pencarian daftar PO di SERVER: nomor PO, nama pemasok, atau kode pemasok.
 *
 * Dulu kotak cari menyaring sepuluh baris halaman yang sedang tampil saja —
 * PO di halaman 2 dinyatakan "tidak ada" dan pager ikut hilang, jadi orang
 * menyimpulkan PO itu tidak pernah dibuat. Kata kunci kini masuk ke `where`
 * dan jumlah halaman dihitung dari hasil saringannya.
 *
 * Murni (tanpa Prisma) supaya bisa dites tanpa basis data.
 */

/** Panjang kata kunci maksimum yang dibaca dari alamat/isian. */
export const PANJANG_CARI_PO = 100;

export function bacaCariPo(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, PANJANG_CARI_PO);
}

export function bacaHalamanPo(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Syarat `where` untuk kata kunci, atau null bila kosong. */
export function syaratCariPo(cari: string | null | undefined): { OR: Record<string, unknown>[] } | null {
  const k = bacaCariPo(cari);
  if (!k) return null;
  return {
    OR: [
      { docNumber: cariTeks(k) },
      { supplier: { name: cariTeks(k) } },
      { supplier: { code: cariTeks(k) } },
    ],
  };
}

/** Halaman yang ditampilkan, dijepit ke halaman terakhir hasil saringan. */
export function jepitHalaman(halaman: number, total: number, ukuran: number): number {
  const terakhir = Math.max(1, Math.ceil(total / Math.max(1, ukuran)));
  return Math.min(Math.max(1, halaman), terakhir);
}

/** Alamat daftar PO (`?status=&cari=&halaman=`), tanpa yang kosong/bawaan. */
export function alamatDaftarPo(p: { status: string; cari: string; halaman: number }): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  const k = bacaCariPo(p.cari);
  if (k) q.set("cari", k);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  return q.toString();
}
