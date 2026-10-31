"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { periodeSah } from "@/lib/spg/komisi";
import { tandaiKomisiDibayar, tetapkanKomisiToko, type KodeTolakTetapkan } from "@/lib/spg/komisi-writer";
import { kaitBayarKomisiSpg, kaitKomisiSpg } from "@/lib/finance/operasional/kait";

/**
 * Komisi SPG toko putus — kantor. Melihat = `spg_sales:view` (halamannya);
 * menetapkan dan menandai dibayar = `receivables:manage`, keuangan yang juga
 * membayar gaji & komisi konsinyasi. Tidak ada izin baru.
 */

type Gagal<K extends string> = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | K };

export type HasilTetapkanKomisiAction = { ok: true; ulang: boolean; ditulis: number; dihapus: number } | Gagal<KodeTolakTetapkan>;
export type HasilBayarKomisiAction = { ok: true } | Gagal<"TIDAK_DITEMUKAN" | "SUDAH_DIBAYAR" | "CATATAN_TERLALU_PANJANG">;

async function penggunaKeuangan(): Promise<{ ok: true; userId: string } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  return { ok: true, userId: session.user.id };
}

function segarkan() {
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa");
}

export async function tetapkanKomisiSpgAction(isi: { storeId: unknown; periode: unknown }): Promise<HasilTetapkanKomisiAction> {
  const g = await penggunaKeuangan();
  if (!g.ok) return g;
  if (typeof isi?.storeId !== "string" || !isi.storeId || !periodeSah(isi.periode)) return { ok: false, code: "INVALID" };
  const h = await tetapkanKomisiToko({ storeId: isi.storeId, periode: isi.periode, olehUserId: g.userId });
  if (!h.ok) return h;
  // Komisi toko × bulan ini ke buku besar (diselaraskan: penetapan ulang membuat penyesuaian).
  await kaitKomisiSpg(isi.storeId, isi.periode, g.userId);
  segarkan();
  return { ok: true, ulang: h.ulang, ditulis: h.ditulis, dihapus: h.dihapus };
}

export async function tandaiKomisiSpgDibayarAction(isi: { commissionId: unknown; catatan?: unknown }): Promise<HasilBayarKomisiAction> {
  const g = await penggunaKeuangan();
  if (!g.ok) return g;
  if (typeof isi?.commissionId !== "string" || !isi.commissionId) return { ok: false, code: "INVALID" };
  if (isi.catatan !== undefined && isi.catatan !== null && typeof isi.catatan !== "string") return { ok: false, code: "INVALID" };
  const h = await tandaiKomisiDibayar({ commissionId: isi.commissionId, olehUserId: g.userId, catatan: isi.catatan });
  if (!h.ok) return h;
  await kaitBayarKomisiSpg(isi.commissionId, g.userId);
  segarkan();
  return { ok: true };
}
