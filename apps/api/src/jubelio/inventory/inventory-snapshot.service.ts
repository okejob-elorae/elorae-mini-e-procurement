import { Inject, Injectable, Logger } from "@nestjs/common";
import { parseJubelioQty } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import type { JubelioItemsPayload } from "../catalog/catalog.types";

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

/* Jubelio documents 200 as the ceiling for pageSize. */
const PAGE_SIZE = 200;
/*
 * A hard ceiling, because some Jubelio list endpoints ignore paging entirely (see
 * categories.service.ts) and would otherwise loop forever. 100 pages is 20,000 item groups.
 */
const MAX_PAGES = 100;

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
   * Pages through `GET /inventory/items/` until a short page, the envelope's `totalCount`, a page
   * that repeats the previous one, or the page ceiling. Reads `end_qty` ONLY — `available_qty` is
   * `end_qty − order_qty` and is never a stand-in for on-hand. A variant on no page read simply has
   * no entry, which the caller reads as `null`.
   */
  private async fetchAllEndQty(): Promise<Map<number, number | null>> {
    const byItemId = new Map<number, number | null>();
    let fetchedGroups = 0;
    let expected: number | null = null;
    let previousFirstGroupId: number | null = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const payload = await this.http.get<JubelioItemsPayload>("/inventory/items/", {
        query: { page, pageSize: PAGE_SIZE },
      });
      const groups = Array.isArray(payload?.data) ? payload.data : [];

      const firstGroupId = groups[0]?.item_group_id ?? null;
      if (page > 1 && firstGroupId !== null && firstGroupId === previousFirstGroupId) {
        this.logger.warn(
          `/inventory/items/ returned the same page again at page ${page}; it looks like paging is ignored, stopping`,
        );
        break;
      }
      previousFirstGroupId = firstGroupId;

      for (const group of groups) {
        for (const variant of group.variants ?? []) {
          if (typeof variant?.item_id !== "number") continue;
          byItemId.set(variant.item_id, parseJubelioQty(variant.end_qty));
        }
      }

      fetchedGroups += groups.length;
      if (expected === null) {
        const total = Number(payload?.totalCount);
        expected = Number.isFinite(total) ? total : null;
      }
      const done = groups.length < PAGE_SIZE || (expected !== null && fetchedGroups >= expected);
      if (done) break;
      if (page === MAX_PAGES) {
        this.logger.warn(
          `Stopped after ${MAX_PAGES} pages of /inventory/items/ with ${fetchedGroups} groups; variants beyond read as no figure`,
        );
      }
    }

    if (expected !== null && fetchedGroups < expected) {
      this.logger.warn(`Jubelio reports ${expected} item groups but only ${fetchedGroups} were read`);
    }

    return byItemId;
  }
}
