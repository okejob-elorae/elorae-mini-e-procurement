"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { terapkanUsulanKelas } from "@/lib/stores/queries";

type Hasil = { ok: true; diubah: number } | { ok: false; code: "FORBIDDEN" | "INVALID" };

/** Batas wajar satu kali terapkan — jauh di atas jumlah toko aktif. */
const MAKS_TOKO = 5000;

/**
 * Terapkan usulan kelas ke toko terpilih. Dijaga `stores:manage` — kelas
 * adalah data master toko, sama dengan area dan pemegangnya. Usulannya
 * dihitung ulang di server (`terapkanUsulanKelas`); yang dikirim layar hanya
 * pilihan tokonya. Setiap perubahan tercatat di jejak audit.
 */
export async function terapkanUsulanKelasAction(storeIds: string[]): Promise<Hasil> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (
    !Array.isArray(storeIds) ||
    storeIds.length === 0 ||
    storeIds.length > MAKS_TOKO ||
    !storeIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
  ) {
    return { ok: false, code: "INVALID" };
  }
  const { diubah } = await terapkanUsulanKelas(storeIds, session.user.id);
  revalidatePath("/backoffice/stores");
  revalidatePath("/backoffice/stores/kelas");
  revalidatePath("/backoffice/settings/salesman");
  // Kelas mengubah jarak kunjungan di rencana beranda sales dan lencana di daftar tokonya.
  revalidatePath("/pwa");
  revalidatePath("/pwa/stores");
  return { ok: true, diubah };
}
