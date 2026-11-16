import { z } from "zod";
import { listItems } from "@/lib/items/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/** The `type` values `listItems` accepts (`ListItemsFilters["type"]`: ItemType or "raw" = fabric + accessories). */
export const ITEM_TYPES = ["FABRIC", "ACCESSORIES", "FINISHED_GOOD", "raw"] as const;

const searchItemsShape = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("Text to match against the item SKU or name (1–100 characters)."),
  type: z
    .enum(ITEM_TYPES)
    .optional()
    .describe('Only items of this type. "raw" means fabric and accessories together.'),
  activeOnly: z.boolean().default(true).describe("Only active items. Default true."),
  ...listInputShape,
};

type ListedItem = {
  id: string;
  sku: string;
  nameId: string;
  type: string;
  isActive: boolean;
  uom?: { code?: string | null } | null;
  inventoryValue?: { qtyOnHand: number; reservedQty: number; available: number } | null;
};

export const tools: ViraTool[] = [
  defineTool({
    name: "search_items",
    title: "Search items",
    description:
      "Search products and materials by SKU or name. Returns stock in Gudang Utama (the main warehouse) only. For stock in vans and stores, use get_item_stock.",
    gate: { kind: "code", code: "items:view" },
    inputShape: searchItemsShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const hasil = await listItems(
        {
          // The items page passes its search box trimmed, and undefined when empty; zod already trimmed it.
          search: input.query,
          type: input.type,
          isActive: input.activeOnly ? true : undefined,
        },
        { page: offset / limit + 1, pageSize: limit },
      );
      const rows = ("items" in hasil ? hasil.items : hasil) as unknown as ListedItem[];
      const total = "totalCount" in hasil ? hasil.totalCount : rows.length;
      // listItems already folds each item's InventoryValue rows (Gudang Utama only) with
      // aggregateInventoryValues into `inventoryValue`; no item with no rows → zeros.
      const items = rows.map((it) => {
        const inv = it.inventoryValue;
        return {
          id: it.id,
          sku: it.sku,
          name: it.nameId,
          type: it.type,
          active: it.isActive,
          unit: it.uom?.code ?? undefined,
          gudangUtama: {
            onHand: inv?.qtyOnHand ?? 0,
            reserved: inv?.reservedQty ?? 0,
            available: inv?.available ?? 0,
          },
          url: recordUrl(ctx.baseUrl, `/backoffice/items/${it.id}`),
        };
      });
      return toPage(items, total, offset, limit);
    },
  }),
];

export const parityCases: ParityCase[] = [{ tool: "search_items", kind: "route", path: "/backoffice/items" }];
