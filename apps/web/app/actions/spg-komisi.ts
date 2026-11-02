"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { periodeSah } from "@/lib/spg/komisi";
import {
  batalkanTandaDicek,
  tandaiKomisiDibayar,
  tandaiLaporanDicek,
  tetapkanKomisiToko,
  type KodeTolakBatalCek,
  type KodeTolakBayar,
  type KodeTolakCek,
  type KodeTolakTetapkan,
} from "@/lib/spg/komisi-writer";
import { kaitBayarKomisiSpg, kaitKomisiSpg } from "@/lib/finance/operasional/kait";

/**
 * Komisi SPG toko putus — kantor. Melihat = `spg_sales:view` (halamannya);
 * menandai laporan dicek, membatalkannya, dan menetapkan = `receivables:manage`;
 * menandai dibayar = `spg_commission:pay` (keputusan pemilik 2026-11-01), izin
 * yang sama dengan menandai gaji & komisi konsinyasi dibayar — bawaannya hanya
 * admin. Tombol di halaman memakai izin yang sama.
 */

type Gagal<K extends string> = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" | K };

export type HasilTetapkanKomisiAction = { ok: true; ulang: boolean; ditulis: number; dihapus: number } | Gagal<KodeTolakTetapkan>;
export type HasilBayarKomisiAction = { ok: true } | Gagal<KodeTolakBayar>;
export type HasilCekLaporanAction = { ok: true; bulanBayar: string } | Gagal<KodeTolakCek>;
export type HasilBatalCekAction = { ok: true; dihapus: number } | Gagal<KodeTolakBatalCek>;

async function penggunaKeuangan(
  izin: string = PERMISSIONS.RECEIVABLES_MANAGE,
): Promise<{ ok: true; userId: string } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], izin)) return { ok: false, code: "FORBIDDEN" };
  return { ok: true, userId: session.user.id };
}

function segarkan() {
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/backoffice/spg-commission");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa");
}

const tokoDanBulan = (isi: { storeId: unknown; periode: unknown } | null | undefined): isi is { storeId: string; periode: string } =>
  typeof isi?.storeId === "string" && Boolean(isi.storeId) && periodeSah(isi?.periode);

export async function tandaiLaporanDicekAction(isi: { storeId: unknown; periode: unknown }): Promise<HasilCekLaporanAction> {
  const g = await penggunaKeuangan();
  if (!g.ok) return g;
  if (!tokoDanBulan(isi)) return { ok: false, code: "INVALID" };
  const h = await tandaiLaporanDicek({ storeId: isi.storeId, periode: isi.periode, olehUserId: g.userId });
  if (!h.ok) return h;
  segarkan();
  return { ok: true, bulanBayar: h.bulanBayar };
}

export async function batalkanTandaDicekAction(isi: { storeId: unknown; periode: unknown; alasan: unknown }): Promise<HasilBatalCekAction> {
  const g = await penggunaKeuangan();
  if (!g.ok) return g;
  if (!tokoDanBulan(isi)) return { ok: false, code: "INVALID" };
  const h = await batalkanTandaDicek({ storeId: isi.storeId, periode: isi.periode, olehUserId: g.userId, alasan: isi.alasan });
  if (!h.ok) return h;
  // Komisi yang dihapus bersama tanda dicek keluar dari buku besar (diselaraskan, tidak dihapus).
  if (h.dihapus > 0) await kaitKomisiSpg(isi.storeId, isi.periode, g.userId);
  segarkan();
  return { ok: true, dihapus: h.dihapus };
}

export async function tetapkanKomisiSpgAction(isi: { storeId: unknown; periode: unknown }): Promise<HasilTetapkanKomisiAction> {
  const g = await penggunaKeuangan();
  if (!g.ok) return g;
  if (!tokoDanBulan(isi)) return { ok: false, code: "INVALID" };
  const h = await tetapkanKomisiToko({ storeId: isi.storeId, periode: isi.periode, olehUserId: g.userId });
  if (!h.ok) return h;
  // Komisi toko × bulan ini ke buku besar (diselaraskan: penetapan ulang membuat penyesuaian).
  await kaitKomisiSpg(isi.storeId, isi.periode, g.userId);
  segarkan();
  return { ok: true, ulang: h.ulang, ditulis: h.ditulis, dihapus: h.dihapus };
}

export async function tandaiKomisiSpgDibayarAction(isi: { commissionId: unknown; catatan?: unknown }): Promise<HasilBayarKomisiAction> {
  const g = await penggunaKeuangan(PERMISSIONS.SPG_COMMISSION_PAY);
  if (!g.ok) return g;
  if (typeof isi?.commissionId !== "string" || !isi.commissionId) return { ok: false, code: "INVALID" };
  if (isi.catatan !== undefined && isi.catatan !== null && typeof isi.catatan !== "string") return { ok: false, code: "INVALID" };
  const h = await tandaiKomisiDibayar({ commissionId: isi.commissionId, olehUserId: g.userId, catatan: isi.catatan });
  if (!h.ok) return h;
  await kaitBayarKomisiSpg(isi.commissionId, g.userId);
  segarkan();
  return { ok: true };
}
