"use server";

import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kunciHariSah } from "@/lib/salesman/jadwal";
import type { KodeTolakPengunjung } from "@/lib/spg/pengunjung";
import { pengunjungUntukHp, type PengunjungHp } from "@/lib/spg/pengunjung-queries";
import { catatPengunjung } from "@/lib/spg/pengunjung-writer";

/**
 * Penghitung pengunjung dari HP SPG. Toko SELALU toko tetap SPG dari server
 * (`ambilTokoTetap`), tidak pernah dari isian HP. Tidak butuh check-in: SPG
 * menghitung pengunjung sejak counter buka, dan HP boleh mengirim hitungan
 * yang tertunda sesudah check-out. Hasil dikembalikan sebagai kode, tidak
 * dilempar — galat yang dilempar dibaca HP sebagai "tidak ada sinyal" dan
 * dikirim ulang tanpa henti.
 */

type KodeUmum = "FORBIDDEN" | "NO_ASSIGNED_STORE" | "GENERIC";

export type HasilKirimPengunjung =
  | ({ ok: true; diterapkan: boolean } & PengunjungHp)
  | { ok: false; code: KodeTolakPengunjung | KodeUmum };

export type HasilBacaPengunjung = ({ ok: true } & PengunjungHp) | { ok: false; code: KodeUmum | "ISIAN_TIDAK_SAH" };

async function tokoSpgSesi(): Promise<{ ok: true; userId: string; storeId: string } | { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) return { ok: false, code: "FORBIDDEN" };
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  return { ok: true, userId, storeId };
}

/** Kirim angka mutlak satu hari: `{ day, count, clientUpdatedAt }` (ISO). */
export async function kirimPengunjungAction(input: unknown): Promise<HasilKirimPengunjung> {
  const sesi = await tokoSpgSesi();
  if (!sesi.ok) return sesi;
  try {
    const hasil = await catatPengunjung({ userId: sesi.userId, storeId: sesi.storeId, isian: input });
    return hasil.ok ? hasil : { ok: false, code: hasil.kode };
  } catch (e) {
    console.error("catatPengunjung", e);
    return { ok: false, code: "GENERIC" };
  }
}

/** Angka server satu hari (milik sendiri + total toko), untuk menyegarkan layar. */
export async function bacaPengunjungAction(day: unknown): Promise<HasilBacaPengunjung> {
  const sesi = await tokoSpgSesi();
  if (!sesi.ok) return sesi;
  if (!kunciHariSah(day)) return { ok: false, code: "ISIAN_TIDAK_SAH" };
  try {
    return { ok: true, ...(await pengunjungUntukHp(sesi.userId, sesi.storeId, day)) };
  } catch (e) {
    console.error("pengunjungUntukHp", e);
    return { ok: false, code: "GENERIC" };
  }
}
