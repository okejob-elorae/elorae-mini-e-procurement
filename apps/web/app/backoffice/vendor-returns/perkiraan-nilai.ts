/**
 * Perkiraan nilai retur ke pemasok SEBELUM disimpan. Dulu formulir hanya
 * berkata "Total nilai dihitung saat disimpan", jadi pembeli baru tahu nilai
 * retur (dan potongan utang PO-nya) sesudah menyimpan.
 *
 * Kain dan aksesoris = qty × harga rata-rata stok saat ini (sama dengan penulis
 * retur untuk baris bukan barang jadi). Barang jadi cacat dinilai penulis dari
 * biaya bahan per pcs, yang tidak tersedia di peramban — baris itu tidak ikut
 * dijumlah dan ditandai, supaya angkanya tidak pura-pura lengkap. Murni.
 */
export type BarisPerkiraan = { type: "FABRIC" | "ACCESSORIES" | "FG_REJECT"; itemId: string; qty: number };

export function perkiraanNilaiRetur(
  baris: readonly BarisPerkiraan[],
  hargaRata: Readonly<Record<string, number>>,
): { nilai: number; adaBarangJadi: boolean; adaTanpaHarga: boolean } {
  let nilai = 0;
  let adaBarangJadi = false;
  let adaTanpaHarga = false;
  for (const b of baris) {
    if (!b.itemId || !(b.qty > 0)) continue;
    if (b.type === "FG_REJECT") {
      adaBarangJadi = true;
      continue;
    }
    const harga = hargaRata[b.itemId];
    if (harga == null || !Number.isFinite(harga)) {
      adaTanpaHarga = true;
      continue;
    }
    nilai += b.qty * harga;
  }
  return { nilai: Math.round(nilai * 100) / 100, adaBarangJadi, adaTanpaHarga };
}

/** Isian tautan bukti: satu per baris atau dipisah koma; kosong dibuang. */
export function pisahTautanBukti(teks: string): string[] {
  return teks
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
