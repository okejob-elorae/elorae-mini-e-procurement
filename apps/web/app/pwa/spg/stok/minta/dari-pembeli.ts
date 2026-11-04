import { alamatMinta, BATAS_TAMBAHAN, QTY_TAMBAHAN_MAKS, type BarisTambahan } from "@/lib/spg/saran-minta";

/**
 * Jalan dari "barang dicari" dan "titip pesan" ke formulir minta kiriman:
 * alamat `?tambah=` berisi barang/varian yang dicari pembeli, jumlah yang
 * dicatat, dan alasan barisnya. Murni — aman untuk komponen klien.
 *
 * Barang yang diketik bebas (tanpa `itemId`) tidak bisa diisikan: tidak ada
 * barang katalog untuk diminta. Jumlahnya dikembalikan supaya layar bisa
 * menyebutnya, tidak hilang diam-diam.
 */

export type BarisPembeli = { itemId: string | null; variantSku: string | null; qty: number };
export type AlasanPembeli = "DICARI_PEMBELI" | "TITIP_PEMBELI";

export function mintaDariPembeli(
  baris: readonly BarisPembeli[],
  alasan: AlasanPembeli,
): { alamat: string; terisi: number; tanpaBarang: number } {
  // Barang/ukuran yang sama dari beberapa pembeli digabung DI SINI, sebelum
  // alamatnya dipotong di BATAS_TAMBAHAN: batas itu berlaku per barang, bukan
  // per pembeli, dan `terisi` sama dengan yang benar-benar sampai ke formulir.
  const perKunci = new Map<string, BarisTambahan>();
  let tanpaBarang = 0;
  for (const b of baris) {
    if (!b.itemId) {
      tanpaBarang += 1;
      continue;
    }
    const qty = Number.isInteger(b.qty) && b.qty >= 1 ? Math.min(b.qty, QTY_TAMBAHAN_MAKS) : 1;
    const variantSku = b.variantSku ?? "";
    const k = `${b.itemId}::${variantSku}`;
    const ada = perKunci.get(k);
    if (ada) ada.qty = Math.min(QTY_TAMBAHAN_MAKS, ada.qty + qty);
    else perKunci.set(k, { itemId: b.itemId, variantSku, qty, alasan });
  }
  const isi = [...perKunci.values()].slice(0, BATAS_TAMBAHAN);
  return { alamat: alamatMinta(isi), terisi: isi.length, tanpaBarang };
}
