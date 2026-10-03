/**
 * Nilai fisik awal yang diisikan ke layar hitung gudang, dari hitungan per baris.
 *
 * Murni — dipakai komponen klien dan dites tanpa basis data.
 *
 * - Baris berharga (NRT SPG toko KONSI, nilai dihitung server): jumlah qty yang
 *   diterima × harga barisnya.
 * - Baris tanpa harga (NRT SPG toko PUTUS: barisnya hanya qty, nilainya total
 *   nota toko): nilai klaim dibagi rata per potong, dikali potong yang diterima.
 *
 * Hanya usulan — gudang boleh mengubahnya, dan yang diketik yang tersimpan.
 * Barang rusak ikut terhitung: ia sampai di gudang. Siapa menanggung nilainya
 * adalah keputusan beban di kantor, bukan hitungan fisik.
 */
export function nilaiHitunganAwal(
  baris: { qty: number; price: number }[],
  qtyDiterima: number[],
  nilaiKlaim: number,
): number {
  const diterima = (i: number) => Math.max(0, qtyDiterima[i] ?? 0);
  if (baris.some((b) => b.price > 0)) {
    const total = baris.reduce((s, b, i) => s + diterima(i) * b.price, 0);
    return Math.round(total * 100) / 100;
  }
  const qtyKlaim = baris.reduce((s, b) => s + b.qty, 0);
  if (qtyKlaim <= 0) return nilaiKlaim;
  const qtyMasuk = baris.reduce((s, _b, i) => s + diterima(i), 0);
  return Math.round((nilaiKlaim * qtyMasuk) / qtyKlaim);
}
