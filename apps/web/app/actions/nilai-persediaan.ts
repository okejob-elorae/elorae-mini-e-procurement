"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS, requirePermission } from "@/lib/rbac";
import {
  getInventorySnapshot as bacaRingkasanStok,
  getInventoryValue as bacaNilaiBarang,
  type GetInventorySnapshotOpts,
} from "@/lib/inventory/costing";

/**
 * Pintu klien untuk membaca nilai persediaan.
 *
 * `lib/inventory/costing.ts` dulu ber-"use server": setiap ekspornya — termasuk
 * penulis `InventoryValue` (`calculateMovingAverage`, `reverseInventoryValue`,
 * `reverseMovingAverage`) — bisa dipanggil siapa pun yang masuk. Pustakanya
 * kini biasa; yang boleh dipanggil komponen klien hanya dua bacaan di bawah,
 * dan keduanya memeriksa sesi + izin inventori dulu.
 *
 * Melempar seperti `requirePermission` (pola aksi baca inventori), jadi bentuk
 * kembalian sama persis dengan fungsi pustakanya — pemanggil cukup mengganti
 * alamat impor.
 */
async function wajibBolehLihatNilai() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const izin = session.user.permissions ?? [];
  // Penyesuai stok (`inventory:manage`) membaca stok saat ini di formulirnya.
  if (hasPermission(izin, PERMISSIONS.INVENTORY_MANAGE)) return;
  requirePermission(izin, PERMISSIONS.INVENTORY_VIEW);
}

/** Nilai persediaan satu barang (atau satu varian). */
export async function getInventoryValue(itemId: string, variantSku?: string | null) {
  await wajibBolehLihatNilai();
  if (typeof itemId !== "string" || !itemId) throw new Error("Invalid item");
  if (variantSku != null && typeof variantSku !== "string") throw new Error("Invalid variant");
  return bacaNilaiBarang(itemId, variantSku);
}

/** Ringkasan stok per barang untuk halaman Inventori. */
export async function getInventorySnapshot(opts?: GetInventorySnapshotOpts) {
  await wajibBolehLihatNilai();
  if (opts != null && typeof opts !== "object") throw new Error("Invalid options");
  return bacaRingkasanStok(opts);
}
