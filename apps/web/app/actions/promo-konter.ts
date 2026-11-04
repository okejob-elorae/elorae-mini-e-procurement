"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { IsianPromoKonter, MasalahIsianPromoKonter } from "@/lib/spg/promo-konter-kantor";
import { aturAktifPromoKonter, hapusPromoKonter, simpanPromoKonter } from "@/lib/spg/promo-konter-writer";

/**
 * Promo konter SPG — dikelola kantor. Melihat = `promos:view` (dijaga halaman
 * dan `ROUTE_PERMISSIONS`), mengubah = `promos:manage`, diperiksa DI SINI juga:
 * setiap ekspor "use server" adalah titik akhir yang bisa dipanggil langsung.
 * Hasil berupa kode, tidak melempar — pesan galat yang dilempar disamarkan Next
 * di produksi.
 */

type Tolak = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" };

async function pengelola(): Promise<{ userId: string } | Tolak> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)) return { ok: false, code: "FORBIDDEN" };
  return { userId };
}

const segarkan = () => {
  revalidatePath("/backoffice/promo-konter");
  // HP SPG membaca promo bersama halaman jualnya.
  revalidatePath("/pwa/spg/promo");
  revalidatePath("/pwa/spg/sale");
};

export type HasilSimpanPromoKonterAction =
  | { ok: true; id: string }
  | Tolak
  | { ok: false; code: "TIDAK_VALID"; masalah: MasalahIsianPromoKonter[] }
  | { ok: false; code: "TIDAK_ADA" | "GAGAL" };

/** Buat (tanpa `id`) atau ubah promo. `aktif` hanya berlaku saat membuat. */
export async function simpanPromoKonterAction(input: {
  id?: string | null;
  isian: IsianPromoKonter;
  aktif?: boolean;
}): Promise<HasilSimpanPromoKonterAction> {
  const p = await pengelola();
  if ("ok" in p) return p;
  if (!input || typeof input !== "object" || !input.isian || typeof input.isian !== "object") {
    return { ok: false, code: "TIDAK_VALID", masalah: [] };
  }
  try {
    const r = await simpanPromoKonter({ id: input.id ?? null, isian: input.isian, aktif: input.aktif !== false, userId: p.userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("simpanPromoKonterAction", e);
    return { ok: false, code: "GAGAL" };
  }
}

export type HasilAturAktifAction = { ok: true; berubah: boolean } | Tolak | { ok: false; code: "TIDAK_ADA" | "GAGAL" };

export async function aturAktifPromoKonterAction(id: string, aktif: boolean): Promise<HasilAturAktifAction> {
  const p = await pengelola();
  if ("ok" in p) return p;
  if (typeof id !== "string" || !id || typeof aktif !== "boolean") return { ok: false, code: "TIDAK_ADA" };
  try {
    const r = await aturAktifPromoKonter({ id, aktif, userId: p.userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("aturAktifPromoKonterAction", e);
    return { ok: false, code: "GAGAL" };
  }
}

export type HasilHapusAction = { ok: true } | Tolak | { ok: false; code: "TIDAK_ADA" | "GAGAL" } | { ok: false; code: "SUDAH_DIPAKAI"; nota: number };

/** Hapus promo yang belum pernah dipakai; yang sudah dipakai ditolak `SUDAH_DIPAKAI` — matikan saja. */
export async function hapusPromoKonterAction(id: string): Promise<HasilHapusAction> {
  const p = await pengelola();
  if ("ok" in p) return p;
  if (typeof id !== "string" || !id) return { ok: false, code: "TIDAK_ADA" };
  try {
    const r = await hapusPromoKonter({ id, userId: p.userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("hapusPromoKonterAction", e);
    return { ok: false, code: "GAGAL" };
  }
}
