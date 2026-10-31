"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  markTaxInvoiceCreated,
  markTaxInvoiceNotRequired,
  markTaxInvoiceSentToStore,
  revertTaxInvoiceToCreated,
  revertTaxInvoiceToPending,
} from "@/lib/tax-invoices/writer";
import { penolakanNomorFaktur, TaxInvoiceError, type KodeNomorFaktur } from "@/lib/tax-invoices/errors";

export type TaxInvoiceActionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "INVALID_REQUEST"
        | "CONFLICT"
        | "REASON_TOO_LONG"
        | "ERROR"
        | KodeNomorFaktur;
      /** Hanya pada NOMOR_FAKTUR_GANDA, bila ketemu: nomor nota (atau laporan sell-through) yang sudah memegang nomor itu. */
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
    const dipakaiDi = await nomorDokumenPemegang(nomor.dipakaiDeliveryId, nomor.dipakaiSellThroughId);
    return dipakaiDi ? { ok: false, code: nomor.code, dipakaiDi } : { ok: false, code: nomor.code };
  }
  if (e instanceof TaxInvoiceError) return { ok: false, code: e.code };
  return { ok: false, code: "ERROR" };
}

/**
 * Nomor dokumen yang memegang NSFP ganda: nota pengiriman, atau laporan sell-through konsi
 * (faktur pajaknya bersumber dari salah satu). Hanya pelengkap pesan: gagal mencari tidak
 * mengubah penolakannya.
 */
async function nomorDokumenPemegang(deliveryId: string | null, sellThroughId: string | null): Promise<string | null> {
  try {
    if (deliveryId) {
      const nota = await prisma.fieldSalesDelivery.findUnique({ where: { id: deliveryId }, select: { docNo: true } });
      return nota?.docNo ?? null;
    }
    if (sellThroughId) {
      const laporan = await prisma.konsiSellThrough.findUnique({ where: { id: sellThroughId }, select: { docNo: true } });
      return laporan?.docNo ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function markCreatedAction(input: {
  taxInvoiceId: string;
  invoiceNo: string;
  buyerNpwp: string;
  taxableAmount: number;
  ppnAmount: number;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (
    typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "" ||
    typeof input?.invoiceNo !== "string" ||
    typeof input?.buyerNpwp !== "string" ||
    typeof input?.taxableAmount !== "number" || !Number.isFinite(input.taxableAmount) ||
    typeof input?.ppnAmount !== "number" || !Number.isFinite(input.ppnAmount)
  ) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await markTaxInvoiceCreated({
      taxInvoiceId: input.taxInvoiceId,
      invoiceNo: input.invoiceNo,
      buyerNpwp: input.buyerNpwp,
      taxableAmount: input.taxableAmount,
      ppnAmount: input.ppnAmount,
      userId: g.userId,
    });
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

/**
 * `reason` is optional here, unlike `markNotRequiredAction`/`revertToPendingAction` — see the
 * writer's own comment on `markTaxInvoiceSentToStore` for why. `typeof input?.reason !== "string"`
 * is only checked as an INVALID_REQUEST when `reason` is present but not a string (e.g. a number
 * slipped through); `undefined`/missing is fine and passed through as-is.
 */
export async function markSentToStoreAction(input: {
  taxInvoiceId: string;
  reason?: string | null;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await markTaxInvoiceSentToStore({ taxInvoiceId: input.taxInvoiceId, reason: input.reason, userId: g.userId });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/finance/faktur-pajak");
  return { ok: true };
}

export async function revertToCreatedAction(input: {
  taxInvoiceId: string;
  reason: string;
}): Promise<TaxInvoiceActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof input?.taxInvoiceId !== "string" || input.taxInvoiceId === "" || typeof input?.reason !== "string") {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  try {
    await revertTaxInvoiceToCreated({ taxInvoiceId: input.taxInvoiceId, reason: input.reason, userId: g.userId });
  } catch (e) {
    return toResult(e);
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
