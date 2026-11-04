"use server";

import { revalidatePath } from "next/cache";
import type { OversellAlert } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rilisJendelaInden, simpanJendelaInden } from "@/lib/field-sales/inden-writer";
import { bacaIdInden, type BarisBelumTercatat, type GalatJendela, type GalatSimpanJendela } from "@/lib/field-sales/inden";

/**
 * Aksi pre-order (inden) untuk kantor. Mengelola dan merilis jendela memakai
 * izin yang sama dengan menyetujui pesanan lapangan (`field_sales_orders:approve`):
 * keduanya keputusan atas pesanan toko, dan rilis memegang stok seperti
 * persetujuan. Tidak ada izin baru, jadi tidak ada yang perlu di-seed.
 *
 * Mengembalikan `{ ok: false, kode }`, tidak melempar — galat yang dilempar
 * disamarkan menjadi digest di produksi.
 */

export type HasilSimpanJendelaAksi =
  | { ok: true; id: string }
  | { ok: false; kode: "TANPA_IZIN" }
  | { ok: false; kode: "TIDAK_SAH"; galat: GalatJendela[] }
  | { ok: false; kode: GalatSimpanJendela; itemIds?: string[] };

export type HasilRilisAksi =
  | { ok: true; sudahDirilis: boolean; pesanan: number; baris: number; oversell: OversellAlert[] }
  | { ok: false; kode: "TANPA_IZIN" | "TIDAK_ADA" }
  | { ok: false; kode: "BARANG_BELUM_TERCATAT"; baris: BarisBelumTercatat[] };

async function penjaga(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return null;
  return session.user.id;
}

function segarkan(id?: string) {
  revalidatePath("/backoffice/inden");
  if (id) revalidatePath(`/backoffice/inden/${id}`);
  revalidatePath("/backoffice/field-sales-orders");
}

/**
 * Simpan jendela pre-order: tanpa `id` = buat baru, dengan `id` = ubah.
 * Isiannya divalidasi ulang di penulis (`validasiJendela`) — formulir hanya
 * membantu, bukan penjaga.
 */
export async function simpanJendelaIndenAction(input: {
  id?: string | null;
  name: unknown;
  note?: unknown;
  opensOn: unknown;
  closesOn: unknown;
  shipFrom?: unknown;
  shipTo?: unknown;
  isActive?: unknown;
  items: unknown;
}): Promise<HasilSimpanJendelaAksi> {
  const userId = await penjaga();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  let id: string | undefined;
  if (input.id !== undefined && input.id !== null) {
    const v = bacaIdInden(input.id);
    if (!v) return { ok: false, kode: "TIDAK_ADA" };
    id = v;
  }
  const hasil = await simpanJendelaInden({
    id,
    userId,
    isian: {
      name: input.name,
      note: input.note,
      opensOn: input.opensOn,
      closesOn: input.closesOn,
      shipFrom: input.shipFrom,
      shipTo: input.shipTo,
      isActive: input.isActive,
      items: input.items,
    },
  });
  if (hasil.ok) segarkan(hasil.id);
  return hasil;
}

/** "Rilis — barang sudah datang". Idempoten: rilis kedua melaporkan `sudahDirilis`. */
export async function rilisJendelaIndenAction(id: unknown): Promise<HasilRilisAksi> {
  const userId = await penjaga();
  if (!userId) return { ok: false, kode: "TANPA_IZIN" };
  const windowId = bacaIdInden(id);
  if (!windowId) return { ok: false, kode: "TIDAK_ADA" };
  const hasil = await rilisJendelaInden({ id: windowId, userId });
  if (hasil.ok) segarkan(windowId);
  return hasil;
}
