"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { putuskanSelisihHarga, type KodeGalatKoreksi } from "@/lib/vendor-billing/koreksi-utang-writer";

/*
 * Keputusan selisih harga invoice pemasok (keputusan pemilik 2026-11-02, P27 + P53): terima, atau koreksi
 * invoice turun. Izinnya `vendor_bills:decide_price` (bawaannya hanya admin) — yang SAMA dengan yang
 * diperiksa tombolnya. Pelaku dari sesi, tidak pernah dari klien. Penolakan dikembalikan sebagai kode
 * (`vendorBills.selisih.galat.<KODE>`), karena di build produksi Next menyamarkan pesan lemparan aksi.
 */

export type HasilPutuskanSelisihAksi = { ok: true; billId: string } | { ok: false; kode: KodeGalatKoreksi | "TANPA_AKSES" | "GAGAL"; peran?: string };

export async function putuskanSelisihHargaAction(input: { koreksiId: string; keputusan: string; catatan?: string }): Promise<HasilPutuskanSelisihAksi> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.VENDOR_BILLS_DECIDE_PRICE)) return { ok: false, kode: "TANPA_AKSES" };
  const id = z.string().min(1).max(64).safeParse(input?.koreksiId);
  if (!id.success) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await putuskanSelisihHarga({ koreksiId: id.data, keputusan: input.keputusan, catatan: input.catatan, olehUserId: s.user.id });
    if (r.ok) {
      revalidatePath("/backoffice/vendor-bills");
      revalidatePath(`/backoffice/vendor-bills/${r.billId}`);
      revalidatePath("/backoffice/vendor-bills/selisih-harga");
      revalidatePath("/backoffice/supplier-payments/baru");
    }
    return r;
  } catch (e) {
    console.error("[putuskanSelisihHargaAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}
