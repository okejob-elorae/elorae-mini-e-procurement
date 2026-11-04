"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { KEPUTUSAN_RUSAK } from "@/lib/spg/rusak";
import { putuskanBarangRusak } from "@/lib/spg/rusak-writer";

/**
 * Gudang memutuskan barang rusak yang dicatat SPG saat menerima kiriman.
 *
 * Hanya `inventory:manage` yang memutuskan; pengawas SPG (`spg_sales:view`)
 * boleh melihat daftarnya tapi tidak memutuskan. Hasil dikembalikan sebagai
 * kode, bukan dilempar, supaya pesan galat tidak disamarkan Next di produksi.
 */

export type HasilRusakAksi = { ok: true } | { ok: false; code: string };

const skema = z.object({
  lineId: z.string().min(1).max(64),
  keputusan: z.enum(KEPUTUSAN_RUSAK),
  catatan: z.string().max(1000),
});

export async function putuskanBarangRusakAction(input: unknown): Promise<HasilRusakAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.INVENTORY_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const isi = skema.safeParse(input);
  if (!isi.success) return { ok: false, code: "VALIDATION" };
  try {
    const hasil = await putuskanBarangRusak({ ...isi.data, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, code: hasil.alasan };
    revalidatePath("/backoffice/spg-kiriman-rusak");
    revalidatePath("/pwa/spg/terima");
    revalidatePath("/pwa/spg/stok");
    return { ok: true };
  } catch (err) {
    console.error("putuskanBarangRusak gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}
