"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pesanWaLaporan } from "@/lib/spg/tutup-hari-queries";
import { kirimTutupHari, type KodeGagalTutup } from "@/lib/spg/tutup-hari-writer";

/**
 * Laporan tutup hari dari HP SPG. Toko SELALU toko tetap SPG dari server
 * (`ambilTokoTetap`), tidak pernah dari isian HP. Tidak butuh check-in aktif:
 * SPG boleh check-out dulu lalu melapor dari jalan pulang. Hasil dikembalikan
 * sebagai kode, tidak dilempar.
 */

export type HasilTutupHariAction =
  | { ok: true; diperbarui: boolean; teksWa: string | null }
  | { ok: false; code: KodeGagalTutup | "FORBIDDEN" | "NO_ASSIGNED_STORE" | "VALIDATION" | "GENERIC" };

const skema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pengunjung: z.number().nullable().optional(),
  totalKasir: z.number().nullable().optional(),
  catatan: z.string().max(4000).nullable().optional(),
  foto: z.array(z.string().max(200)).max(10).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function kirimTutupHariAction(input: unknown): Promise<HasilTutupHariAction> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) return { ok: false, code: "FORBIDDEN" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  const parsed = skema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const p = parsed.data;

  let hasil: Awaited<ReturnType<typeof kirimTutupHari>>;
  try {
    hasil = await kirimTutupHari({
      userId,
      storeId,
      day: p.day,
      isi: { pengunjung: p.pengunjung, totalKasir: p.totalKasir, catatan: p.catatan, foto: p.foto },
      idempotencyKey: p.idempotencyKey,
    });
  } catch (e) {
    // Galat server dikembalikan sebagai kode: kalau dilempar, HP membacanya
    // sebagai "tidak ada sinyal" dan SPG mengulang tanpa tahu sebabnya.
    console.error("kirimTutupHari", e);
    return { ok: false, code: "GENERIC" };
  }
  if (!hasil.ok) return { ok: false, code: hasil.kode };

  revalidatePath("/pwa/spg/tutup");
  revalidatePath("/backoffice/spg-tutup-hari");
  // Teks WhatsApp gagal dirakit bukan alasan menggagalkan laporan yang sudah tersimpan.
  const teksWa = await pesanWaLaporan(storeId, p.day).catch((e: unknown) => {
    console.error("pesanWaLaporan", e);
    return null;
  });
  return { ok: true, diperbarui: hasil.diperbarui, teksWa };
}
