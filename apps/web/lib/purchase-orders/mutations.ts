import { prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { poSchema } from "@/lib/validations";
import { assertLinesVariantSkusMatchItemDefinitions } from "@/lib/items/validate-variant-lines";
import { resolvePoLeadTimeFields } from "@/lib/leadtime/po-snapshot";
import { getPpnRatePercent } from "@/app/actions/settings/ppn";
import { bulatkanTarifPpn, hitungTotalPo } from "@/lib/purchase-orders/ppn";
import type { z } from "zod";

export type POFormData = z.infer<typeof poSchema>;

export type OfflinePOCreatePayload = {
  supplierId: string;
  etaDate?: Date | string | null;
  paymentDueDate?: Date | string | null;
  notes?: string;
  terms?: string;
  items: Array<{
    itemId: string;
    variantSku?: string | null;
    qty: number;
    price: number;
    ppnIncluded?: boolean;
    uomId?: string;
    notes?: string | null;
  }>;
};

/** Full PO create (backoffice) — matches createPO action transaction */
export async function createPurchaseOrder(
  data: POFormData,
  userId: string,
  options?: { applyLeadTime?: boolean }
) {
  const validated = poSchema.parse(data);
  const applyLeadTime = options?.applyLeadTime !== false;
  // Tarif dibekukan di PO: ganti tarif di Pengaturan tidak mengubah PO yang sudah ada.
  // Dibulatkan ke presisi kolom supaya PPN yang disimpan = PPN yang dihitung ulang saat PO disunting.
  const ppnRatePercent = bulatkanTarifPpn(await getPpnRatePercent());

  return prisma.$transaction(async (tx) => {
    await assertLinesVariantSkusMatchItemDefinitions(tx.item, validated.items);

    const docNumber = await generateDocNumber("PO", tx);
    const total = hitungTotalPo(validated.items, ppnRatePercent);

    let etaDate = validated.etaDate ?? null;
    let chainSnapshot: object | null = null;
    let chainTotalDays: number | null = null;

    if (applyLeadTime) {
      const lt = await resolvePoLeadTimeFields(
        tx,
        validated.supplierId,
        validated.items,
        etaDate
      );
      chainSnapshot = lt.chainSnapshot;
      chainTotalDays = lt.chainTotalDays;
      etaDate = lt.etaDate ?? null;
    }

    const created = await tx.purchaseOrder.create({
      data: {
        docNumber,
        supplierId: validated.supplierId,
        etaDate,
        paymentDueDate: validated.paymentDueDate ?? undefined,
        notes: validated.notes,
        terms: validated.terms,
        totalAmount: total.subtotal,
        taxAmount: total.taxAmount,
        grandTotal: total.grandTotal,
        ppnRatePercent,
        createdById: userId,
        chainSnapshot: chainSnapshot ?? undefined,
        chainTotalDays: chainTotalDays ?? undefined,
        items: {
          create: validated.items.map((i) => ({
            itemId: i.itemId,
            variantSku: i.variantSku?.trim() || null,
            qty: i.qty,
            price: i.price,
            ppnIncluded: i.ppnIncluded,
            uomId: i.uomId,
            notes: i.notes ?? null,
          })),
        },
      },
      include: { items: true },
    });

    await tx.pOStatusHistory.create({
      data: {
        poId: created.id,
        status: "DRAFT",
        changedById: userId,
        notes: "PO Created",
      },
    });

    return created;
  });
}
