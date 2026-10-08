import { cariTeks } from "@/lib/db/cari-teks";

/**
 * Pencarian tab Penerimaan Barang di SERVER: nomor GRN, nama/kode pemasok,
 * atau nomor PO. Dulu kotak cari menyaring satu halaman yang tampil saja, jadi
 * GRN di halaman lain dinyatakan tidak ada. Murni — dites tanpa basis data.
 */
export function syaratCariGrn(cari: string | null | undefined): { OR: Record<string, unknown>[] } | null {
  const k = (cari ?? "").trim().slice(0, 100);
  if (!k) return null;
  return {
    OR: [
      { docNumber: cariTeks(k) },
      { supplier: { name: cariTeks(k) } },
      { supplier: { code: cariTeks(k) } },
      { po: { docNumber: cariTeks(k) } },
    ],
  };
}
