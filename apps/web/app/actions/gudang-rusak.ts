"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { BATAS_CATATAN_GUDANG_RUSAK, KEPUTUSAN_GUDANG_RUSAK } from "@/lib/spg/gudang-rusak";
import { putuskanGudangRusak } from "@/lib/spg/gudang-rusak-writer";
import { kaitGudangRusak } from "@/lib/finance/operasional/kait";

/**
 * Kantor memutuskan barang di gudang barang rusak: PERBAIKI (kembali ke stok
 * jual), JUAL_OBRAL (nilai jual dicatat), atau MUSNAHKAN.
 *
 * Hanya `inventory:manage`; yang hanya `inventory:view` melihat daftarnya.
 * Hasil dikembalikan sebagai kode, bukan dilempar, supaya pesan galat tidak
 * disamarkan Next di produksi.
 */

export type HasilGudangRusakAksi = { ok: true; saldoSesudah: number } | { ok: false; code: string };

const skema = z.object({
  itemId: z.string().min(1).max(64),
  variantSku: z.string().max(191).default(""),
  keputusan: z.enum(KEPUTUSAN_GUDANG_RUSAK),
  qty: z.number().int().positive().max(1_000_000),
  catatan: z.string().max(BATAS_CATATAN_GUDANG_RUSAK * 4),
  nilai: z.number().nonnegative().max(1_000_000_000_000).nullable().optional(),
});

export async function putuskanGudangRusakAction(input: unknown): Promise<HasilGudangRusakAksi> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.INVENTORY_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const isi = skema.safeParse(input);
  if (!isi.success) return { ok: false, code: "VALIDATION" };
  try {
    const hasil = await putuskanGudangRusak({ ...isi.data, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, code: hasil.alasan };
    // Nilai gudang rusak yang keluar ke buku besar (sesudah commit, tidak pernah melempar).
    await kaitGudangRusak(hasil.gerakId, session.user.id);
    revalidatePath("/backoffice/gudang-rusak");
    if (isi.data.keputusan === "PERBAIKI") revalidatePath("/backoffice/inventory");
    return { ok: true, saldoSesudah: hasil.saldoSesudah };
  } catch (err) {
    console.error("putuskanGudangRusak gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}
