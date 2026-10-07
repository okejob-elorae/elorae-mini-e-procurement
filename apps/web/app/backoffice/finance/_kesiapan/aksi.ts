"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaKesiapanBukuBesar } from "./baca";

export type KesiapanCetak = { aktif: boolean; jurnalTertunda: number };

/**
 * Kesiapan buku besar untuk versi cetak laporan (halaman klien di
 * `/print/finance/*`): hanya dua angka yang dibutuhkan catatannya. Null bila
 * pembaca tidak berhak atau pembacaan gagal — laporan tetap dicetak tanpa catatan.
 */
export async function bacaKesiapanCetakAction(): Promise<KesiapanCetak | null> {
  const session = await auth();
  if (!session?.user) return null;
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.FINANCE_REPORTS_VIEW) && !hasPermission(perms, PERMISSIONS.JOURNALS_VIEW)) {
    return null;
  }
  const k = await bacaKesiapanBukuBesar();
  return k ? { aktif: k.aktif, jurnalTertunda: k.jurnalTertunda } : null;
}
