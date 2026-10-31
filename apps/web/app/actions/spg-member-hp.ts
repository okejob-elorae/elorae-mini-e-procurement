"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaAturanMemberDb } from "@/lib/spg/member-queries";
import { daftarkanMemberPelanggan } from "@/lib/spg/member-writer";

/**
 * SPG mendaftarkan pelanggan tokonya sendiri sebagai member Elorae dari
 * rincian pelanggan. Toko TIDAK PERNAH diambil dari layar: selalu toko tetap
 * SPG, jadi pelanggan toko lain tidak bisa didaftarkan dari sini.
 *
 * Kalau kantor memasang belanja minimal untuk mendaftar, pendaftaran hanya
 * lewat nota (di sanalah belanjanya diperiksa) — dari sini ditolak dengan
 * `LEWAT_NOTA`, supaya syarat itu tidak bisa dilewati.
 */
export type KodeGagalDaftarMemberHp =
  | "FORBIDDEN"
  | "NO_ASSIGNED_STORE"
  | "VALIDATION"
  | "PROGRAM_MATI"
  | "MEMBER_NONAKTIF"
  | "PELANGGAN_TIDAK_ADA"
  | "LEWAT_NOTA";

export type HasilDaftarMemberHp = { ok: true; baru: boolean } | { ok: false; code: KodeGagalDaftarMemberHp };

const schema = z.object({ customerId: z.string().min(1).max(100) });

export async function daftarkanMemberPelangganAction(input: unknown): Promise<HasilDaftarMemberHp> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  const aturan = await bacaAturanMemberDb();
  if (!aturan.aktif) return { ok: false, code: "PROGRAM_MATI" };
  if (aturan.minBelanjaDaftar > 0) return { ok: false, code: "LEWAT_NOTA" };
  const hasil = await daftarkanMemberPelanggan({ customerId: parsed.data.customerId, storeId, userId: session.user.id });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  revalidatePath("/pwa/spg/pelanggan");
  revalidatePath(`/pwa/spg/pelanggan/${parsed.data.customerId}`);
  revalidatePath("/backoffice/spg-pelanggan");
  return { ok: true, baru: hasil.baru };
}
