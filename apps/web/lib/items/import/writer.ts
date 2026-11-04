import { prisma, Prisma } from "@elorae/db";
import { dataPengajuanJubelio } from "@/lib/jubelio/harga/pengajuan";
import { dijualDiMarketplace, type SaluranJual } from "@/lib/items/saluran-jual";
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
 *
 * `salesChannel` (the import's two ticks, owner answer P3 2026-11-02) applies to every product of
 * the import. Marketplace or both REQUESTS every created product for Jubelio inside the same
 * all-or-nothing transaction; nothing is pushed — each waits on Jubelio → Konfirmasi harga until
 * its price is confirmed. "Toko offline saja" requests none (P3a).
 */
export async function createItemsFromImport(
  plan: ItemImportPlan,
  opsi: { salesChannel: SaluranJual; olehUserId?: string | null },
): Promise<Array<{ id: string; sku: string; nameId: string }>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const created: Array<{ id: string; sku: string; nameId: string }> = [];
        const pengajuan = dijualDiMarketplace(opsi.salesChannel) ? dataPengajuanJubelio(opsi.olehUserId ?? null) : {};
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
              salesChannel: opsi.salesChannel,
              ...pengajuan,
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
