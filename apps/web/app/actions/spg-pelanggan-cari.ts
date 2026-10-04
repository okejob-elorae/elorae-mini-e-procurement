"use server";

import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Cari pelanggan toko SPG dari layar jual (nama atau nomor HP). Hanya
 * pelanggan TOKO SPG itu sendiri — tokonya diturunkan di server dari
 * `User.assignedStoreId`, tidak pernah dari layar.
 */
export type PelangganCari = { id: string; name: string; phone: string };

export async function cariPelangganSpgAction(
  q: string,
): Promise<{ ok: true; hasil: PelangganCari[] } | { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };

  const teks = String(q ?? "").trim().slice(0, 60);
  const angka = teks.replace(/\D/g, "");
  // "0812…" dan "812…" dicari sebagai "62812…", bentuk yang disimpan.
  const hp = angka.startsWith("0") ? `62${angka.slice(1)}` : angka.startsWith("8") ? `62${angka}` : angka;
  const atau = [
    ...(teks ? [{ name: cariTeks(teks) }] : []),
    ...(hp.length >= 4 ? [{ phone: { contains: hp } }] : []),
  ];
  const hasil = await prisma.storeCustomer.findMany({
    where: { storeId, ...(atau.length ? { OR: atau } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, name: true, phone: true },
  });
  return { ok: true, hasil };
}
