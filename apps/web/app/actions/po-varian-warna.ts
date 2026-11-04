"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { MAKS_PANJANG_WARNA } from "@/lib/purchase-orders/varian-warna";
import { hexPantone, tambahVarianWarna, type HasilTambahVarianWarna } from "@/lib/purchase-orders/varian-warna-writer";

/**
 * "+ Warna baru" di formulir PO: menambah varian warna ke bahan non-barang-jadi.
 * Boleh bagi yang membuat/mengubah PO atau mengelola barang. Pengguna diambil
 * dari sesi, tidak pernah dari klien. Penolakan dikembalikan sebagai kode.
 */
export async function tambahVarianWarnaBahanAction(
  itemId: string,
  isi: { warna: string; pantone?: string | null },
): Promise<HasilTambahVarianWarna | { ok: false; kode: "TANPA_AKSES" | "ISIAN_TIDAK_SAH" }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const izin = session.user.permissions ?? [];
  if (
    !hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_CREATE) &&
    !hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_EDIT) &&
    !hasPermission(izin, PERMISSIONS.ITEMS_MANAGE)
  ) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const id = typeof itemId === "string" ? itemId.trim() : "";
  const warna = typeof isi?.warna === "string" ? isi.warna : "";
  const pantone = typeof isi?.pantone === "string" ? isi.pantone : null;
  if (!id || id.length > 64 || warna.length > MAKS_PANJANG_WARNA * 2 || (pantone?.length ?? 0) > 40) {
    return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  }
  const hasil = await tambahVarianWarna({ itemId: id, warna, pantone, userId });
  if (hasil.ok) revalidatePath(`/backoffice/items/${id}`);
  return hasil;
}

/** Hex swatch untuk kode Pantone yang tersimpan di varian bahan (kunci = kode TCX "19-4005"). */
export async function hexPantoneAction(kode: string[]): Promise<Record<string, string>> {
  const session = await auth();
  if (!session?.user?.id || !Array.isArray(kode)) return {};
  return hexPantone(kode.filter((k): k is string => typeof k === "string" && k.length <= 40));
}
