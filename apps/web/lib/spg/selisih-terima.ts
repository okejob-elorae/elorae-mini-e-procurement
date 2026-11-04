/**
 * Selisih satu penerimaan kiriman di toko SPG, dalam POTONG saja — tanpa
 * rupiah, supaya aman dipakai di kabar ke HP salesman dan di layar HP-nya
 * (harga konsinyasi tidak pernah sampai ke sana).
 *
 * Murni, tanpa impor: dipakai penulis terima kiriman (kabar ke salesman),
 * kueri rincian pesanan salesman, dan layar klien.
 */

export type SelisihTerima = {
  /** Jumlah yang dikirim menurut dokumen sumbernya. */
  dikirim: number;
  /** Jumlah yang TIBA (termasuk yang rusak). */
  diterima: number;
  /** Potong yang tidak tiba — dihitung per baris, kelebihan satu baris tidak menutup kurang baris lain. */
  kurang: number;
  /** Potong yang tiba dalam keadaan rusak. */
  rusak: number;
};

export function hitungSelisihTerima(
  baris: { qtySent: number; qtyReceived: number; qtyDamaged?: number | null }[],
): SelisihTerima {
  let dikirim = 0;
  let diterima = 0;
  let kurang = 0;
  let rusak = 0;
  for (const b of baris) {
    dikirim += b.qtySent;
    diterima += b.qtyReceived;
    kurang += Math.max(0, b.qtySent - b.qtyReceived);
    rusak += Math.max(0, b.qtyDamaged ?? 0);
  }
  return { dikirim, diterima, kurang, rusak };
}

/** Penerimaan yang tidak pas: ada yang kurang atau ada yang rusak. */
export function adaSelisih(s: Pick<SelisihTerima, "kurang" | "rusak">): boolean {
  return s.kurang > 0 || s.rusak > 0;
}

/** "kurang 2 pcs, rusak 1 pcs" — bagian yang nol tidak ditulis; pas → "". */
export function teksSelisih(s: Pick<SelisihTerima, "kurang" | "rusak">): string {
  const bagian: string[] = [];
  if (s.kurang > 0) bagian.push(`kurang ${s.kurang} pcs`);
  if (s.rusak > 0) bagian.push(`rusak ${s.rusak} pcs`);
  return bagian.join(", ");
}
