import { prisma, type Prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { poSchema } from "@/lib/validations";
import { assertLinesVariantSkusMatchItemDefinitions } from "@/lib/items/validate-variant-lines";
import { resolvePoLeadTimeFields } from "@/lib/leadtime/po-snapshot";
import { resolveCreatePaymentTerms } from "@/lib/purchase-orders/payment-terms";
import { recomputePaymentDueDate } from "@/lib/purchase-orders/payment-due";
import { getPpnRatePercent } from "@/app/actions/settings/ppn";
import { bulatkanTarifPpn, hitungTotalPo } from "@/lib/purchase-orders/ppn";
import { pastikanTahapAda } from "@/lib/purchase-orders/tahap";
import type { z } from "zod";

export type POFormData = z.infer<typeof poSchema>;

export type OfflinePOCreatePayload = {
  supplierId: string;
  etaDate?: Date | string | null;
  paymentDueDate?: Date | string | null;
  paymentTermsDays?: number | null;
  notes?: string;
  terms?: string;
  /** Tahap produksi PO ini, bila dibuat dari ruang kerja tahap. */
  planStageId?: string | null;
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
  options?: { applyLeadTime?: boolean; tx?: Prisma.TransactionClient }
) {
  const validated = poSchema.parse(data);
  const applyLeadTime = options?.applyLeadTime !== false;
  // Tarif dibekukan di PO: ganti tarif di Pengaturan tidak mengubah PO yang sudah ada.
  // Dibulatkan ke presisi kolom supaya PPN yang disimpan = PPN yang dihitung ulang saat PO disunting.
  const ppnRatePercent = bulatkanTarifPpn(await getPpnRatePercent());

  // `tx` lets a caller (Request Item → PO) create the PO inside its own transaction.
  const run = async (tx: Prisma.TransactionClient) => {
    await assertLinesVariantSkusMatchItemDefinitions(tx.item, validated.items);
    if (validated.planStageId) await pastikanTahapAda(tx, validated.planStageId);

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

    const supplier = await tx.supplier.findUnique({
      where: { id: validated.supplierId },
      select: { paymentTermsDays: true },
    });
    const paymentTermsDays = resolveCreatePaymentTerms(
      validated.paymentTermsDays,
      supplier?.paymentTermsDays ?? null
    );

    const created = await tx.purchaseOrder.create({
      data: {
        docNumber,
        supplierId: validated.supplierId,
        etaDate,
        paymentTermsDays,
        paymentDueDate: paymentTermsDays == null ? validated.paymentDueDate ?? undefined : null,
        notes: validated.notes,
        terms: validated.terms,
        planStageId: validated.planStageId ?? null,
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

    await recomputePaymentDueDate(tx, created.id);

    return created;
  };
  return options?.tx ? run(options.tx) : prisma.$transaction(run);
}

function parseDate(val: Date | string | null | undefined): Date | undefined {
  if (val == null || val === "") return undefined;
  return val instanceof Date ? val : new Date(val);
}

/** Offline sync — lead-time columns stay null (no chain load offline). */
export async function createPurchaseOrderFromOfflinePayload(
  payload: OfflinePOCreatePayload,
  userId: string
) {
  const items = payload.items.map((item) => ({
    itemId: item.itemId,
    variantSku: item.variantSku?.trim() || undefined,
    qty: item.qty,
    price: item.price,
    ppnIncluded: item.ppnIncluded ?? false,
    uomId: item.uomId ?? "",
    notes: item.notes ?? undefined,
  }));

  if (items.some((i) => !i.uomId)) {
    const itemIds = [...new Set(items.map((i) => i.itemId))];
    const dbItems = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, uomId: true },
    });
    const uomByItem = new Map(dbItems.map((r) => [r.id, r.uomId]));
    for (const line of items) {
      if (!line.uomId) line.uomId = uomByItem.get(line.itemId) ?? "";
    }
  }

  const normalized: POFormData = {
    supplierId: payload.supplierId,
    etaDate: parseDate(payload.etaDate) ?? new Date(),
    paymentDueDate: parseDate(payload.paymentDueDate),
    ...(payload.paymentTermsDays !== undefined ? { paymentTermsDays: payload.paymentTermsDays } : {}),
    notes: payload.notes,
    terms: payload.terms,
    ...(payload.planStageId ? { planStageId: payload.planStageId } : {}),
    items: items as POFormData["items"],
  };

  return createPurchaseOrder(normalized, userId, { applyLeadTime: false });
}
