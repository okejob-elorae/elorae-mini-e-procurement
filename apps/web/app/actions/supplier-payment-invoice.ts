"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaInvoiceUntukBayar, type DataBayarInvoice } from "@/lib/vendor-billing/invoice-bayar-queries";

/*
 * Kartu "Bayar per invoice" di Pembayaran pemasok → Bayar (Q19, P20): invoice terbuka pemasok dan
 * penerimaan yang disebutnya. Butuh `supplier_payments:view` (yang dipegang setiap pembayar), jadi Keuangan
 * bisa memilih invoice tanpa `vendor_bills:view`; tautan ke tagihannya sendiri hanya tampil bagi pembaca
 * tagihan. Penulis pembayaran tetap memeriksa ulang setiap alokasi.
 */

export async function invoiceUntukBayarAction(input: { pemasokId: string }): Promise<{ ok: true; data: DataBayarInvoice } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const s = await auth();
  if (!s?.user?.id || !hasPermission(s.user.permissions ?? [], PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) return { ok: false, kode: "TANPA_AKSES" };
  const id = z.string().min(1).max(64).safeParse(input?.pemasokId);
  if (!id.success) return { ok: false, kode: "GAGAL" };
  try {
    return { ok: true, data: await bacaInvoiceUntukBayar(id.data) };
  } catch (e) {
    // Basis data tanpa tabel tagihan vendor (PostgreSQL): formulir tetap jalan tanpa kartunya.
    console.error("[invoiceUntukBayarAction]", e);
    return { ok: false, kode: "GAGAL" };
  }
}
