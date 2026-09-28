import { prisma, Prisma } from "@elorae/db";
import type { ItemImportPlan } from "./types";

export class ItemImportSkuTakenError extends Error {
  constructor() {
    super("An artikel SKU in this import was created by someone else after validation");
    this.name = "ItemImportSkuTakenError";
  }
}

const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * All-or-nothing: every item of the plan is created in ONE transaction, or none is. Each item
 * gets the same zero-quantity variantless `InventoryValue` row the single-item form provisions
 * (`variantSku: null`, matching `lib/items/mutations.ts`). That create is row PROVISIONING, not a
 * stock movement — no ledger entry — which is why this file sits on the balance-write guard's
 * ALLOWED list; it must never gain a quantity move. A unique violation means a concurrent create
 * took one of the SKUs after validation; the caller re-validates to say which.
 */
export async function createItemsFromImport(
  plan: ItemImportPlan,
): Promise<Array<{ id: string; sku: string; nameId: string }>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const created: Array<{ id: string; sku: string; nameId: string }> = [];
        for (const planned of plan.items) {
          const item = await tx.item.create({
            data: {
              sku: planned.sku,
              nameId: planned.nameId,
              nameEn: planned.nameEn,
              type: "FINISHED_GOOD",
              source: "ERP",
              uomId: planned.uomId,
              categoryId: planned.categoryId,
              sellingPrice: planned.sellingPrice,
              description: planned.description,
              variants: planned.variants,
              reorderPoint: 0,
              overReceiveThreshold: 0,
            },
            select: { id: true, sku: true, nameId: true },
          });
          await tx.inventoryValue.create({
            data: { itemId: item.id, variantSku: null, qtyOnHand: 0, avgCost: 0, totalValue: 0 },
          });
          created.push(item);
        }
        return created;
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ItemImportSkuTakenError();
    }
    throw e;
  }
}
