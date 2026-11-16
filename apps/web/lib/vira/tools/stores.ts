import { z } from "zod";
import { getStoreStockCard } from "@/lib/inventory/store-stock-card";
import { listInputShape, recordUrl, sliceToPage } from "../output";
import { resolveStore } from "./_resolve-store";
import { defineTool, type ParityCase, type ViraTool } from "./types";

const getStoreStockShape = {
  store: z.string().trim().min(1).max(100).describe("The store's id, code or name."),
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Only rows whose variant SKU or item name contains this text (case-insensitive)."),
  ...listInputShape,
};

type StockRow = { name: string; variantSku: string; quantity: number; inTransit: number };

export const tools: ViraTool[] = [
  defineTool({
    name: "get_store_stock",
    title: "Store stock",
    description:
      "Shows the current stock at one store (toko), including consignment (konsinyasi) shipments still in transit. Give the store's id, code or name.",
    gate: { kind: "code", code: "stores:view" },
    inputShape: getStoreStockShape,
    handler: async (input, ctx) => {
      const store = await resolveStore(input.store);
      const card = await getStoreStockCard(store.id);
      // Stock rows only: card.movements (and its limit / truncation flags) are never read.
      const rows: StockRow[] = [
        ...card.rows.map((r) => ({
          name: r.itemName,
          variantSku: r.variantSku,
          quantity: r.qty,
          inTransit: r.dalamPerjalanan,
        })),
        // First shipments still on the road: no StoreStock row yet, so nothing on hand.
        ...card.dalamPerjalananTanpaStok.map((r) => ({
          name: r.itemName,
          variantSku: r.variantSku,
          quantity: 0,
          inTransit: r.dalamPerjalanan,
        })),
      ];
      const q = input.query?.toLowerCase();
      const filtered = q
        ? rows.filter((r) => r.variantSku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
        : rows;
      return {
        store: { ...store, url: recordUrl(ctx.baseUrl, `/backoffice/stores/${store.id}`) },
        ...sliceToPage(filtered, input.offset, input.limit),
      };
    },
  }),
];

export const parityCases: ParityCase[] = [
  {
    tool: "get_store_stock",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/stores/[id]/page.tsx",
    codes: ["stores:view"],
  },
];
