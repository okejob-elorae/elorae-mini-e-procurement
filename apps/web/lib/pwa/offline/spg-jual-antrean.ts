import { pwaDb, type PendingSpgSale } from "./db";
import { ubahanTanpaBagian, type NotaSpgBaru } from "./spg-jual-muatan";

/**
 * Antrean nota penjualan SPG di HP (dijual tanpa sinyal).
 *
 * `localId` = kunci idempotensi keranjang — dibuat SEKALI per keranjang, saat
 * keranjang dimulai, bukan saat tombol simpan ditekan. Nota yang gagal dikirim
 * di konter lalu masuk antrean membawa kunci yang sama, jadi kalau ternyata
 * server sudah mencatatnya, kiriman dari antrean hanya mendapat nota yang ada.
 */
export async function antreNotaSpg(n: NotaSpgBaru): Promise<void> {
  await pwaDb.pendingSpgSales.put({ ...n, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function daftarNotaSpgTertahan(): Promise<PendingSpgSale[]> {
  return pwaDb.pendingSpgSales.orderBy("capturedAt").toArray();
}

/** Nota tertahan untuk satu toko — layar jual menyebut jumlahnya. */
export async function hitungNotaSpgTertahan(storeId?: string): Promise<number> {
  return storeId ? pwaDb.pendingSpgSales.where("storeId").equals(storeId).count() : pwaDb.pendingSpgSales.count();
}

export async function hapusNotaSpgTertahan(localId: string): Promise<void> {
  await pwaDb.pendingSpgSales.delete(localId);
}

export async function ulangNotaSpgTertahan(localId: string): Promise<void> {
  await pwaDb.pendingSpgSales.update(localId, { syncState: "pending", error: undefined });
}

/** Kirim ulang tanpa diskon SPG atau tanpa data pembeli — pilihan SPG sendiri di layar. */
export async function buangBagianNotaSpg(localId: string, bagian: "diskon" | "pembeli"): Promise<void> {
  await pwaDb.pendingSpgSales.update(localId, ubahanTanpaBagian(bagian));
}
