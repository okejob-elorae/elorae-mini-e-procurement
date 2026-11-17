import { z } from "zod";
import { listStoreStocktakes } from "@/lib/stores/stocktake/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { resolveStore } from "./_resolve-store";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/** `StoreStocktakeStatusValue` from lib/stores/stocktake/queries.ts. */
export const STOCKTAKE_STATUSES = ["DRAFT", "PENDING_VERIFICATION", "APPROVED", "CANCELLED"] as const;

const listStoreStocktakesShape = {
  store: z.string().trim().min(1).max(100).optional().describe("Only stocktakes of this store (id, code or name)."),
  status: z.enum(STOCKTAKE_STATUSES).optional().describe("Only stocktakes in this status."),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the document number or store name."),
  ...listInputShape,
};

export const tools: ViraTool[] = [
  defineTool({
    name: "list_store_stocktakes",
    title: "Store stocktakes",
    description:
      "Lists store stocktakes (stock opname toko) with status and variance. Filter by store, status or document number.",
    gate: { kind: "code", code: "stores:view" },
    inputShape: listStoreStocktakesShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const store = input.store === undefined ? undefined : await resolveStore(input.store);
      const { rows, total } = await listStoreStocktakes({
        storeId: store?.id,
        status: input.status,
        q: input.search,
        page: offset / limit + 1,
        perPage: limit,
      });
      const items = rows.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        // The list rows carry the store's name only; its id is known when the caller filtered by store.
        store: { id: store?.id, name: r.storeName },
        status: r.status,
        date: r.countedAt,
        varianceQty: r.netVarianceQty,
        url: recordUrl(ctx.baseUrl, `/backoffice/store-stocktakes/${r.id}`),
      }));
      return toPage(items, total, offset, limit);
    },
  }),
];

export const parityCases: ParityCase[] = [
  {
    tool: "list_store_stocktakes",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/store-stocktakes/page.tsx",
    codes: ["stores:view"],
  },
];
