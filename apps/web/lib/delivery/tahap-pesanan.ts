/**
 * Tahap pengiriman sebuah pesanan dibaca dari surat jalannya yang MASIH TERBUKA. Import-free supaya
 * HP salesman, portal toko, dan daftar pesanan memakai satu definisi.
 *
 * Sejak stok (putus: nota; konsi: transfer ke Gudang Toko) keluar saat pengiriman DIBUAT,
 * `deliveryStatus` pesanan sudah DELIVERED begitu barangnya dikemas. Tanpa tahap ini HP akan
 * menulis "Terkirim" padahal barangnya masih di gudang atau di mobil.
 *
 * - `DALAM_PERJALANAN` — ada surat jalan IN_TRANSIT (didahulukan: barang yang sudah berangkat).
 * - `DIKEMAS` — ada surat jalan PACKED dan tidak ada yang IN_TRANSIT.
 * - `null` — tidak ada surat jalan terbuka; pemanggil memakai `deliveryStatus` seperti biasa.
 *
 * Surat jalan selesai (DELIVERED/PARTIALLY_DELIVERED) dan batal (CANCELLED) tidak dihitung.
 */
export type TahapPengirimanPesanan = "DIKEMAS" | "DALAM_PERJALANAN";

export function tahapPengirimanPesanan(
  shipments: ReadonlyArray<{ status: string }> | null | undefined,
): TahapPengirimanPesanan | null {
  if (!shipments || shipments.length === 0) return null;
  if (shipments.some((s) => s.status === "IN_TRANSIT")) return "DALAM_PERJALANAN";
  if (shipments.some((s) => s.status === "PACKED")) return "DIKEMAS";
  return null;
}
