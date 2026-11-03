"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  batalkanPermintaanInvoice,
  mintaInvoice,
  mintaUlangInvoice,
  type HasilPermintaan,
  type KodeGalatPermintaan,
} from "@/lib/vendor-billing/permintaan-invoice-writer";
import { batalkanTidakPerluInvoice, tandaiTidakPerluInvoice, type HasilTidakPerlu, type KodeGalatTidakPerlu } from "@/lib/vendor-billing/tidak-perlu-invoice-writer";

/*
 * "Invoice belum ditagih": minta invoice, minta ulang, batalkan permintaan, "tidak perlu invoice" dan
 * pembatalannya (Q18, P19, P52). Semuanya `vendor_bills:manage` — yang SAMA dengan yang diperiksa
 * tombolnya. Pelaku dari sesi. Penolakan sebagai kode (`vendorBills.permintaan.galat.<KODE>` /
 * `vendorBills.tidakPerlu.galat.<KODE>`).
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

async function pelaku(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.VENDOR_BILLS_MANAGE)) return null;
  return s.user.id;
}

function segarkan() {
  revalidatePath("/backoffice/vendor-bills");
  revalidatePath("/backoffice/vendor-bills/belum-ditagih");
  revalidatePath("/backoffice/supplier-payments/baru");
}

const id64 = z.string().min(1).max(64);

export async function mintaInvoiceAction(input: {
  supplierId: string;
  sumber: Array<{ jenis: string; id: string }>;
  saluran: string;
  catatan?: string;
  idempotencyKey?: string;
}): Promise<HasilPermintaan | Gagal> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const supplierId = id64.safeParse(input?.supplierId);
  if (!supplierId.success) return { ok: false, kode: "SUMBER_TIDAK_DITEMUKAN" as KodeGalatPermintaan };
  try {
    const r = await mintaInvoice({ supplierId: supplierId.data, sumber: input.sumber, saluran: input.saluran, catatan: input.catatan, idempotencyKey: input.idempotencyKey, olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("[mintaInvoiceAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function mintaUlangInvoiceAction(input: { requestId: string; saluran: string; catatan?: string }): Promise<HasilPermintaan | Gagal> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const requestId = id64.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await mintaUlangInvoice({ requestId: requestId.data, saluran: input.saluran, catatan: input.catatan, olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("[mintaUlangInvoiceAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function batalkanPermintaanInvoiceAction(input: { requestId: string; alasan: string }): Promise<HasilPermintaan | Gagal> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const requestId = id64.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await batalkanPermintaanInvoice({ requestId: requestId.data, alasan: input.alasan, olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("[batalkanPermintaanInvoiceAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}

const sumberTidakPerlu = z
  .array(z.object({ jenis: z.enum(["GRN", "WO_STEP"]), id: id64, itemId: z.string().max(191).nullish(), variantSku: z.string().max(191).nullish() }))
  .max(200);

export async function tidakPerluInvoiceAction(input: {
  supplierId: string;
  sumber: Array<{ jenis: string; id: string; itemId?: string | null; variantSku?: string | null }>;
  alasan: string;
}): Promise<HasilTidakPerlu | Gagal> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const supplierId = id64.safeParse(input?.supplierId);
  const sumber = sumberTidakPerlu.safeParse(input?.sumber);
  if (!supplierId.success || !sumber.success) return { ok: false, kode: "SUMBER_KOSONG" as KodeGalatTidakPerlu };
  try {
    const r = await tandaiTidakPerluInvoice({ supplierId: supplierId.data, sumber: sumber.data, alasan: input.alasan, olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("[tidakPerluInvoiceAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function batalkanTidakPerluInvoiceAction(input: { waiverId: string; alasan: string }): Promise<HasilTidakPerlu | Gagal> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const waiverId = id64.safeParse(input?.waiverId);
  if (!waiverId.success) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await batalkanTidakPerluInvoice({ waiverId: waiverId.data, alasan: input.alasan, olehUserId: userId });
    if (r.ok) segarkan();
    return r;
  } catch (e) {
    console.error("[batalkanTidakPerluInvoiceAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}
