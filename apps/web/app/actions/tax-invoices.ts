"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  markTaxInvoiceCreated,
  markTaxInvoiceNotRequired,
  revertTaxInvoiceToPending,
} from "@/lib/tax-invoices/writer";
import { penolakanNomorFaktur, TaxInvoiceError, type KodeNomorFaktur } from "@/lib/tax-invoices/errors";

export type TaxInvoiceActionResult =
  | { ok: true }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE" | "INVALID_REQUEST" | "CONFLICT" | "ERROR" | KodeNomorFaktur;
      /** Hanya pada NOMOR_FAKTUR_GANDA, bila ketemu: nomor nota yang sudah memegang nomor itu. */
      dipakaiDi?: string;
    };

async function guard(): Promise<{ userId: string } | { ok: false; code: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.TAX_INVOICES_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

/**
 * A caught `TaxInvoiceError` keeps its own code; anything else (a network hiccup, a programmer
 * error) becomes `ERROR` rather than leaking a thrown message — production digest-masking would
 * swallow it anyway, and letting a stray shape fall onto a code that means something else is the
 * exact mistake already on record for the delivery actions.
 */
async function toResult(e: unknown): Promise<TaxInvoiceActionResult> {
  // Penolakan nomor faktur membawa code INVALID_REQUEST yang generik; `sebab`-nya yang dipakai layar.
  const nomor = penolakanNomorFaktur(e);
  if (nomor) {
    const dipakaiDi = nomor.dipakaiDeliveryId ? await nomorNotaPemegang(nomor.dipakaiDeliveryId) : null;
    return dipakaiDi ? { ok: false, code: nomor.code, dipakaiDi } : { ok: false, code: nomor.code };
  }
  if (e instanceof TaxInvoiceError) return { ok: false, code: e.code };
  return { ok: false, code: "ERROR" };
}

/** Nomor nota yang memegang NSFP ganda. Hanya pelengkap pesan: gagal mencari tidak mengubah penolakannya. */
async function nomorNotaPemegang(deliveryId: string): Promise<string | null> {
  try {
    const nota = await prisma.fieldSalesDelivery.findUnique({ where: { id: deliveryId }, select: { docNo: true } });
    return nota?.docNo ?? null;
  } catch {
    return null;
  }
}

export async function markCreatedAction(input: {
  taxInvoiceId: string;
  invoiceNo: string;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "" || typeof input?.invoiceNo !== "string") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await markTaxInvoiceCreated({ taxInvoiceId: input.taxInvoiceId, invoiceNo: input.invoiceNo, userId: g.userId });
  } catch (e) {
    return await toResult(e);
  }
  revalidatePath("/backoffice/finance/faktur-pajak");
  return { ok: true };
}

export async function markNotRequiredAction(input: {
  taxInvoiceId: string;
  reason: string;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "" || typeof input?.reason !== "string") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await markTaxInvoiceNotRequired({ taxInvoiceId: input.taxInvoiceId, reason: input.reason, userId: g.userId });
  } catch (e) {
    return await toResult(e);
  }
  revalidatePath("/backoffice/finance/faktur-pajak");
  return { ok: true };
}

export async function revertToPendingAction(input: {
  taxInvoiceId: string;
  reason: string;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "" || typeof input?.reason !== "string") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await revertTaxInvoiceToPending({ taxInvoiceId: input.taxInvoiceId, reason: input.reason, userId: g.userId });
  } catch (e) {
    return await toResult(e);
  }
  revalidatePath("/backoffice/finance/faktur-pajak");
  return { ok: true };
}
