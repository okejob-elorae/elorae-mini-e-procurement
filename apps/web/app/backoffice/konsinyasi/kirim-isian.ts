import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import type { BarisKirim, BarisKurangKirim } from "@/lib/konsinyasi/writer";

/**
 * Logika murni formulir "Kirim titipan" (tanpa React, tanpa Prisma — hanya `import type`).
 *
 * Satu baris = satu barang + satu varian. Barang bervarian WAJIB dipilih ukurannya (penulis
 * menolak `VARIAN_WAJIB`), jadi tombol simpan menyebut baris mana yang belum siap.
 */

export type BarisKirimIsian = BarisKirim & { uid: string };

export type KeadaanVarian =
  | { status: "memuat" }
  | { status: "gagal" }
  | { status: "siap"; pilihan: PilihanVarianKirim };

export type AlasanBelumKirim =
  | { kode: "TOKO" }
  | { kode: "BARIS" }
  | { kode: "NAMA"; baris: number }
  | { kode: "QTY"; baris: number }
  | { kode: "MEMUAT"; baris: number }
  | { kode: "GAGAL_MUAT"; baris: number; nama: string }
  | { kode: "VARIAN"; baris: number; nama: string };

/** Alasan PERTAMA tombol simpan dimatikan, urut formulir; null = siap dikirim. */
export function alasanBelumKirim(
  tokoId: string,
  baris: BarisKirimIsian[],
  varian: Record<string, KeadaanVarian>,
): AlasanBelumKirim | null {
  if (!tokoId) return { kode: "TOKO" };
  if (baris.length === 0) return { kode: "BARIS" };
  for (const [i, b] of baris.entries()) {
    const n = i + 1;
    if (!b.itemName.trim()) return { kode: "NAMA", baris: n };
    if (!(Number.isInteger(b.qty) && b.qty > 0)) return { kode: "QTY", baris: n };
    if (!b.itemId) continue;
    const k = varian[b.itemId];
    if (!k || k.status === "memuat") return { kode: "MEMUAT", baris: n };
    if (k.status === "gagal") return { kode: "GAGAL_MUAT", baris: n, nama: b.itemName.trim() };
    if (k.pilihan.perluVarian && !b.variantSku?.trim()) return { kode: "VARIAN", baris: n, nama: b.itemName.trim() };
  }
  return null;
}

/** Stok tersedia untuk varian baris ini (null bila belum diketahui / baris tanpa katalog). */
export function tersediaUntukBaris(b: BarisKirim, k: KeadaanVarian | undefined): number | null {
  if (!b.itemId || !k || k.status !== "siap") return null;
  const sku = b.variantSku?.trim() ?? "";
  if (!sku) return k.pilihan.perluVarian ? null : k.pilihan.tersediaTanpaVarian;
  return k.pilihan.varian.find((v) => v.sku === sku)?.tersedia ?? 0;
}

/** Varian yang bisa dipilih: hanya yang ada stoknya (yang kosong pasti ditolak penulis). */
export function varianBisaDipilih(pilihan: PilihanVarianKirim): { tampil: PilihanVarianKirim["varian"]; tersembunyi: number } {
  const tampil = pilihan.varian.filter((v) => v.tersedia > 0);
  return { tampil, tersembunyi: pilihan.varian.length - tampil.length };
}

/** Satu-satunya varian yang akan dipotong penulis tanpa harus dipilih — diisikan otomatis. */
export function varianOtomatis(pilihan: PilihanVarianKirim): string | null {
  return !pilihan.perluVarian && pilihan.varian.length === 1 ? pilihan.varian[0].sku : null;
}

/** Baris ini termasuk barang/varian yang dilaporkan kurang oleh server. */
export function barisKurang(b: BarisKirim, kurang: BarisKurangKirim[]): boolean {
  if (!b.itemId) return false;
  const sku = b.variantSku?.trim() ?? "";
  return kurang.some((k) => k.itemId === b.itemId && k.variantSku === sku);
}

/** Bentuk yang dikirim ke server: tanpa `uid` layar. */
export function untukServer(baris: BarisKirimIsian[]): BarisKirim[] {
  return baris.map(({ itemId, variantSku, itemName, qty, price }) => ({
    itemId: itemId ?? null,
    variantSku: variantSku?.trim() || null,
    itemName,
    qty,
    price: Number.isFinite(price) ? price : 0,
  }));
}
