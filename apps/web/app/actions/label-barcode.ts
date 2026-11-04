"use server";

import { auth } from "@/lib/auth";
import type { BarangLabel } from "@/lib/items/label";
import { barangUntukLabel, cariBarangLabel, type HasilCariLabel } from "@/lib/items/label-queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Layar label barcode kantor: mencari barang dan mengambil data labelnya.
 * Hanya membaca — mencetak terjadi di peramban. Izin: `items:view`.
 */

type Gagal = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" };

async function periksaIzin(): Promise<Gagal | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.ITEMS_VIEW)) return { ok: false, code: "FORBIDDEN" };
  return null;
}

export async function cariBarangLabelAction(q: unknown): Promise<{ ok: true; hasil: HasilCariLabel[] } | Gagal> {
  const tolak = await periksaIzin();
  if (tolak) return tolak;
  if (typeof q !== "string") return { ok: false, code: "INVALID_REQUEST" };
  return { ok: true, hasil: await cariBarangLabel(q) };
}

export async function ambilBarangLabelAction(itemIds: unknown): Promise<{ ok: true; barang: BarangLabel[] } | Gagal> {
  const tolak = await periksaIzin();
  if (tolak) return tolak;
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 50 || !itemIds.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  return { ok: true, barang: await barangUntukLabel(itemIds as string[]) };
}
