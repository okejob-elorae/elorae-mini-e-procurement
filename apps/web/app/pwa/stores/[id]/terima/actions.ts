"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { terimaKirimanPemegang } from "@/lib/spg/stok-writer-pemegang";
import type { HasilTerimaKiriman } from "@/lib/spg/stok-writer";

/**
 * Penerimaan kiriman gudang oleh SALESMAN PEMEGANG toko yang SPG-nya sudah berhenti (P45/P45a,
 * "benar": penanggung jawab toko menerima, salesman pemegang mencatatnya saat berkunjung — nama
 * penanggung jawab + foto).
 *
 * Aksi ini hanya memeriksa sesi dan bentuk isian. `storeId` dari alamat halaman diperiksa ULANG
 * oleh penulisnya (`terimaKirimanPemegang`): pemegang toko itu, sedang check-in di sana, toko tanpa
 * SPG, pengirimannya sudah diserahkan, foto milik dokumen ini. SPG (toko tetap) menerima lewat
 * layarnya sendiri, jadi ditolak di sini.
 */

const Isian = z.object({
  storeId: z.string().min(1).max(64),
  sourceType: z.enum(["KONSI_TRANSFER", "PUTUS_DELIVERY"]),
  sourceId: z.string().min(1).max(64),
  diterima: z
    .array(z.object({ lineId: z.string().min(1).max(64), qtyReceived: z.number().int().min(0).max(999_999) }))
    .min(1)
    .max(500),
  picName: z.string().max(200),
  photoUrl: z.string().min(1).max(2000),
  photoR2Key: z.string().min(1).max(300),
  idempotencyKey: z.string().min(1).max(64),
});

export type HasilTerimaPemegang = HasilTerimaKiriman | { ok: false; alasan: "TANPA_AKSES" | "ISIAN_TIDAK_VALID" | "GAGAL" };

export async function terimaKirimanPemegangAction(input: unknown): Promise<HasilTerimaPemegang> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, alasan: "TANPA_AKSES" };
  if (pwaAccessGuard(session.user.permissions) !== "render") return { ok: false, alasan: "TANPA_AKSES" };
  if (await ambilTokoTetap(session.user.id)) return { ok: false, alasan: "TANPA_AKSES" };

  const isian = Isian.safeParse(input);
  if (!isian.success) return { ok: false, alasan: "ISIAN_TIDAK_VALID" };

  try {
    const hasil = await terimaKirimanPemegang({ ...isian.data, userId: session.user.id });
    if (hasil.ok) {
      revalidatePath(`/pwa/stores/${isian.data.storeId}`);
      revalidatePath("/pwa");
    }
    return hasil;
  } catch (err) {
    console.error("[terima-pemegang] gagal", err);
    return { ok: false, alasan: "GAGAL" };
  }
}
