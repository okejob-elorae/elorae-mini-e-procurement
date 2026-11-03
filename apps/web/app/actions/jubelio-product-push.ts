"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ajukanKeJubelio } from "@/lib/jubelio/harga/pengajuan";
import {
  jubelioCreateEligibility,
  type JubelioCreateEligibility,
} from "@/lib/items/jubelio-create-eligibility";

/*
 * The item page's "Ajukan ke Jubelio" button — for ERP finished goods that never reached Jubelio
 * (e.g. imported with the Jubelio box unticked, or a request someone cancelled). It REQUESTS
 * creation and pushes nothing: the product waits on Jubelio → Konfirmasi harga and is created in
 * Jubelio once its price is confirmed (owner decision 2026-11-02). Never for a "Toko offline saja"
 * item (owner answer P3a, `offline_channel`): whether an item goes to Jubelio is its sales channel.
 * Name kept for its callers.
 */
export async function createItemInJubelio(
  itemId: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | Exclude<JubelioCreateEligibility, "eligible"> }> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.permissions, PERMISSIONS.ITEMS_EDIT)) {
    return { ok: false, reason: "forbidden" };
  }
  if (typeof itemId !== "string") return { ok: false, reason: "not_found" };
  const eligibility = await jubelioCreateEligibility(itemId);
  if (eligibility !== "eligible") return { ok: false, reason: eligibility };

  const [hasil] = await ajukanKeJubelio([itemId], session.user.id);
  revalidatePath(`/backoffice/items/${itemId}`);
  revalidatePath("/backoffice/jubelio/harga");
  switch (hasil?.hasil) {
    case "DIAJUKAN":
      return { ok: true };
    case "SUDAH_DIAJUKAN":
      return { ok: false, reason: "already_requested" };
    case "SEDANG_DIKIRIM":
      return { ok: false, reason: "already_queued" };
    case "SUDAH_DI_JUBELIO":
      return { ok: false, reason: "already_mapped" };
    case "BUKAN_BARANG_JADI_ERP":
      return { ok: false, reason: "not_erp_finished_good" };
    case "SALURAN_OFFLINE":
      return { ok: false, reason: "offline_channel" };
    default:
      return { ok: false, reason: "not_found" };
  }
}
