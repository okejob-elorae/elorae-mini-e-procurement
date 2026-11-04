"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { buatTitipan, catatDicariDenganTitip, tandaiDikabari, tutupTitipan, type PembeliTitip } from "@/lib/spg/titip-writer";

/**
 * Titip pesan dari HP SPG: buat (juga dari layar barang dicari), tandai
 * dikabari, tutup. Toko SELALU toko tetap SPG, tidak pernah dari layar.
 * Tidak butuh check-in: pembeli bisa menitip pesan saat SPG baru datang, dan
 * mengabari pembeli bisa dilakukan dari mana saja.
 */

export type HasilTitipAksi =
  | { ok: true; id: string; customerId?: string; ulang?: boolean; holdUntil?: string }
  | { ok: false; code: string };

async function konteks(): Promise<{ userId: string; storeId: string } | { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  return { userId: session.user.id, storeId };
}

const segarkan = (id?: string, customerId?: string) => {
  revalidatePath("/pwa/spg/titip");
  if (id) revalidatePath(`/pwa/spg/titip/${id}`);
  revalidatePath("/pwa/spg/pelanggan");
  if (customerId) revalidatePath(`/pwa/spg/pelanggan/${customerId}`);
  revalidatePath("/backoffice/spg-pelanggan");
};

const pembeliSchema = z.union([
  z.object({ id: z.string().min(1).max(100) }).strict(),
  z.object({ nama: z.string().max(200), hp: z.string().max(40), setuju: z.boolean() }).strict(),
]);

const barangSchema = {
  itemId: z.string().min(1).max(100).nullable().optional(),
  variantSku: z.string().max(200).nullable().optional(),
  qty: z.number().int().min(1).max(999),
  idempotencyKey: z.string().min(1).max(100),
  pembeli: pembeliSchema,
};

const buatSchema = z.object({ ...barangSchema, keterangan: z.string().max(400).nullable().optional() });

export async function buatTitipanAction(input: unknown): Promise<HasilTitipAksi> {
  const parsed = buatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const hasil = await buatTitipan({ ...parsed.data, pembeli: parsed.data.pembeli as PembeliTitip, storeId: k.storeId, userId: k.userId });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  segarkan(hasil.id, hasil.customerId);
  return { ok: true, id: hasil.id, customerId: hasil.customerId, ulang: hasil.ulang };
}

const dicariSchema = z.object({ ...barangSchema, description: z.string().min(1).max(200) });

/** Barang dicari + "pembeli ingin dikabari kalau barangnya datang". */
export async function catatDicariDenganTitipAction(input: unknown): Promise<HasilTitipAksi> {
  const parsed = dicariSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const hasil = await catatDicariDenganTitip({ ...parsed.data, pembeli: parsed.data.pembeli as PembeliTitip, storeId: k.storeId, userId: k.userId });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  segarkan(hasil.id, hasil.customerId);
  revalidatePath("/pwa/spg/dicari");
  revalidatePath("/backoffice/spg-lost-sales");
  return { ok: true, id: hasil.id, customerId: hasil.customerId, ulang: hasil.ulang };
}

const idSchema = z.object({ requestId: z.string().min(1).max(100) });

export async function tandaiDikabariAction(input: unknown): Promise<HasilTitipAksi> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const hasil = await tandaiDikabari({ storeId: k.storeId, userId: k.userId, requestId: parsed.data.requestId });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  segarkan(parsed.data.requestId);
  return { ok: true, id: parsed.data.requestId, holdUntil: hasil.holdUntil, ulang: hasil.ulang };
}

const tutupSchema = idSchema.extend({ hasil: z.enum(["SELESAI", "BATAL"]), alasan: z.string().max(1000).nullable().optional() });

export async function tutupTitipanAction(input: unknown): Promise<HasilTitipAksi> {
  const parsed = tutupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks();
  if ("ok" in k) return k;
  const hasil = await tutupTitipan({ storeId: k.storeId, userId: k.userId, ...parsed.data });
  if (!hasil.ok) return { ok: false, code: hasil.code };
  segarkan(parsed.data.requestId);
  return { ok: true, id: parsed.data.requestId };
}
