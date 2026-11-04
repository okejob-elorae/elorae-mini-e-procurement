import type { BarisStok } from "@/lib/spg/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { kunciBaris } from "@/lib/spg/stok";
import type { BarisPilihan } from "./barang-pilihan";

/**
 * Barang yang bisa dipilih di layar SPG (minta kiriman, opname, formulir retur
 * toko SPG): katalog aktif yang dijual offline DIGABUNG dengan barang yang
 * pernah bergerak di toko.
 *
 * Katalog saja tidak cukup — barang yang dijadikan "Marketplace saja" (P3a)
 * tetap bisa masih ada di rak toko, dan opname harus bisa menghitungnya (P73).
 * Barang di buku toko itu karenanya diminta tetap tampil di katalog
 * (`tetapTampilkan`), supaya baris katalognya (barcode, label varian) tetap
 * terbaca. Barang yang sudah DINONAKTIFKAN di master tidak ikut — P73 hanya
 * soal saluran jual, dan belum ada jawaban pemilik untuk barang nonaktif —
 * jadi yang tampil hanya baris yang memang ada di saldo toko (tanpa barcode
 * katalog, seperti sebelum P73); varian yang belum pernah dipegang toko tidak
 * ditawarkan. Stok toko saja juga tidak cukup — barang yang belum pernah ada
 * di toko justru yang paling perlu diminta.
 *
 * Hanya untuk server component: dipanggil dari halaman, hasilnya dikirim ke
 * klien sebagai data polos. Tipe dan pencariannya ada di `barang-pilihan.ts`,
 * yang aman diimpor komponen klien.
 */

export async function pilihanBarang(stok: BarisStok[]): Promise<BarisPilihan[]> {
  // Saldo sudah ada di `stok` — katalog dimuat TANPA toko supaya kelompok
  // gerakan stok tidak dihitung dua kali.
  const katalog = await getSellableCatalogForSpg(undefined, { tetapTampilkan: [...new Set(stok.map((s) => s.itemId))] });
  const saldo = new Map(stok.map((b) => [kunciBaris(b.itemId, b.variantSku), b]));

  const hasil = new Map<string, BarisPilihan>();
  for (const k of katalog) {
    const kunci = kunciBaris(k.itemId, k.variantSku);
    const s = saldo.get(kunci);
    hasil.set(kunci, {
      kunci,
      itemId: k.itemId,
      sku: k.sku,
      variantSku: k.variantSku,
      kode: k.variantSku || k.sku,
      nama: k.productName,
      varian: k.variantLabel,
      barcode: k.barcode,
      stok: s?.qty ?? 0,
      dilacak: s !== undefined,
    });
  }
  // Barang di rak yang tidak lagi ada di katalog aktif.
  for (const [kunci, b] of saldo) {
    if (hasil.has(kunci)) continue;
    hasil.set(kunci, {
      kunci,
      itemId: b.itemId,
      sku: b.sku,
      variantSku: b.variantSku || null,
      kode: b.sku,
      nama: b.nama,
      varian: b.varian,
      barcode: null,
      stok: b.qty,
      dilacak: true,
    });
  }
  return [...hasil.values()].sort((a, b) => a.nama.localeCompare(b.nama) || a.kode.localeCompare(b.kode));
}
