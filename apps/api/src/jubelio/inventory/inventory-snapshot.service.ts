import { Inject, Injectable } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import type { JubelioItemsPayload } from "../catalog/catalog.types";

export type InventorySnapshotRow = {
  itemId: string;
  variantSku: string;
  jubelioItemId: number;
  jubelioQty: number;
};

@Injectable()
export class InventorySnapshotService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async getSnapshot(itemGroupIds?: number[]): Promise<InventorySnapshotRow[]> {
    const mappings = await this.prisma.jubelioProductMapping.findMany({
      where: itemGroupIds?.length
        ? { jubelioItemGroupId: { in: itemGroupIds } }
        : undefined,
      select: {
        itemId: true,
        jubelioItemId: true,
        jubelioItemGroupId: true,
        erpVariantSku: true,
      },
    });

    if (mappings.length === 0) return [];

    const payload = await this.http.get<JubelioItemsPayload>("/inventory/items/");
    const qtyByJubelioItemId = new Map<number, number>();

    for (const group of payload.data ?? []) {
      if (itemGroupIds?.length && !itemGroupIds.includes(group.item_group_id)) continue;
      for (const variant of group.variants ?? []) {
        const qty = variant.end_qty ?? variant.available_qty ?? 0;
        qtyByJubelioItemId.set(variant.item_id, Number(qty));
      }
    }

    return mappings.map((m) => ({
      itemId: m.itemId,
      variantSku: m.erpVariantSku ?? "",
      jubelioItemId: m.jubelioItemId,
      jubelioQty: qtyByJubelioItemId.get(m.jubelioItemId) ?? 0,
    }));
  }
}
