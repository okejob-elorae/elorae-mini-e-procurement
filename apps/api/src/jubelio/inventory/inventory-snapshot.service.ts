import { Inject, Injectable, Logger } from "@nestjs/common";
import { parseJubelioQty } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { fetchItemGroups } from "./fetch-item-groups";

/**
 * `jubelioQty` is Jubelio's `end_qty` for the mapped variant, or `null` when Jubelio gave no
 * usable figure — the variant is absent from every page read, or its `end_qty` is not a valid
 * quantity. `null` means "no figure", never zero: a caller must not compare or write it as 0.
 */
export type InventorySnapshotRow = {
  itemId: string;
  variantSku: string;
  jubelioItemId: number;
  jubelioQty: number | null;
};

/** One variant of one item group, read live from `GET /inventory/items/group/{id}`. */
export type GroupSnapshotRow = {
  jubelioItemId: number;
  endQty: number | null;
};

type GroupDetailResponse = {
  item_group_id?: number;
  product_skus?: Array<{ item_id?: unknown; end_qty?: unknown }>;
};

@Injectable()
export class InventorySnapshotService {
  private readonly logger = new Logger(InventorySnapshotService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async getSnapshot(): Promise<InventorySnapshotRow[]> {
    const mappings = await this.prisma.jubelioProductMapping.findMany({
      select: {
        itemId: true,
        jubelioItemId: true,
        erpVariantSku: true,
      },
    });

    if (mappings.length === 0) return [];

    const endQtyByJubelioItemId = await this.fetchAllEndQty();

    return mappings.map((m) => ({
      itemId: m.itemId,
      variantSku: m.erpVariantSku ?? "",
      jubelioItemId: m.jubelioItemId,
      jubelioQty: endQtyByJubelioItemId.get(m.jubelioItemId) ?? null,
    }));
  }

  /**
   * Reads ONE item group's variants from the endpoint the stock webhook already trusts. No
   * pagination is involved, so a variant it does not list is genuinely absent from Jubelio.
   */
  async getGroupSnapshot(groupId: number): Promise<GroupSnapshotRow[]> {
    const detail = await this.http.get<GroupDetailResponse>(`/inventory/items/group/${groupId}`);
    const skus = Array.isArray(detail?.product_skus) ? detail.product_skus : [];
    const rows: GroupSnapshotRow[] = [];
    for (const sku of skus) {
      if (typeof sku?.item_id !== "number") continue;
      rows.push({ jubelioItemId: sku.item_id, endQty: parseJubelioQty(sku.end_qty) });
    }
    return rows;
  }

  /**
   * Reads `end_qty` ONLY — `available_qty` is `end_qty − order_qty` and is never a stand-in for
   * on-hand. A variant on no page read simply has no entry, which the caller reads as `null`.
   */
  private async fetchAllEndQty(): Promise<Map<number, number | null>> {
    const byItemId = new Map<number, number | null>();
    const { data: groups } = await fetchItemGroups(this.http, this.logger);

    for (const group of groups) {
      for (const variant of group.variants ?? []) {
        if (typeof variant?.item_id !== "number") continue;
        byItemId.set(variant.item_id, parseJubelioQty(variant.end_qty));
      }
    }

    return byItemId;
  }
}
