"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ubahStatusPermintaan } from "@/lib/spg/stok-writer";

/**
 * Kotak masuk salesman (`/pwa/permintaan`): menolak atau menandai selesai
 * permintaan barang SPG.
 *
 * Boleh: pemegang toko permintaan itu (`Store.salesmanId`, dengan `pwa:access`),
 * atau kantor (`stores:manage`). SPG TIDAK boleh — ia yang meminta, dan
 * memutuskan permintaan sendiri meruntuhkan gunanya. Logika status (urutan
 * yang sah, bandingkan-lalu-tukar di `runSerializable`, jejak `AuditLog`, kabar
 * ke SPG) seluruhnya milik `ubahStatusPermintaan` — aksi ini hanya penjaga pintu.
 *
 * Membuatkan pesanan bukan lewat sini: katalog `?isi=permintaan:<id>` mengisi
 * keranjang, dan pesanan yang tercatat menautkan permintaannya sendiri.
 */

export type HasilPermintaanSpg =
  | { ok: true }
  | {
      ok: false;
      code:
        | "VALIDATION"
        | "UNAUTHORIZED"
        | "TANPA_AKSES"
        | "TIDAK_DITEMUKAN"
        | "BUKAN_PEMEGANG"
        | "STATUS_TIDAK_BOLEH"
        | "ALASAN_WAJIB";
    };

const schema = z.object({
  requestId: z.string().min(1).max(64),
  status: z.enum(["SELESAI", "DITOLAK"]),
  note: z.string().max(500).optional(),
});

export async function ubahPermintaanSpgAction(input: unknown): Promise<HasilPermintaanSpg> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;
  const izin = session.user.permissions ?? [];

  // SPG dikenali dari toko tetapnya, bukan dari izinnya.
  if (await ambilTokoTetap(userId)) return { ok: false, code: "TANPA_AKSES" };
  const kantor = hasPermission(izin, PERMISSIONS.STORES_MANAGE);
  if (!kantor && !izin.includes("pwa:access")) return { ok: false, code: "TANPA_AKSES" };

  const req = await prisma.stockRequest.findUnique({
    where: { id: parsed.data.requestId },
    select: { storeId: true, store: { select: { salesmanId: true } } },
  });
  if (!req) return { ok: false, code: "TIDAK_DITEMUKAN" };
  const pemegang = req.store.salesmanId === userId;
  if (!pemegang && !kantor) return { ok: false, code: "BUKAN_PEMEGANG" };

  const hasil = await ubahStatusPermintaan({
    requestId: parsed.data.requestId,
    status: parsed.data.status,
    userId,
    note: parsed.data.note,
    oleh: pemegang ? "SALESMAN" : "KANTOR",
  });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };

  revalidatePath("/pwa/permintaan");
  revalidatePath(`/pwa/permintaan/${parsed.data.requestId}`);
  revalidatePath("/pwa/spg/stok");
  revalidatePath("/backoffice/spg-requests");
  return { ok: true };
}
