import { z } from "zod";
import { getItemAvailabilityBySku } from "@/lib/field-sales/queries";
import { getStockAcrossLocations } from "@/lib/inventory/stock-across-locations";
import { getItemMovementCard } from "@/lib/inventory/stock-ledger-card";
import { getItemById, listItems } from "@/lib/items/queries";
import { matchKey } from "@/lib/items/match-key";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { recordUrl } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

export const MAX_LOCATION_ROWS = 50;
export const LEDGER_NOTE =
  "Rows marked source=ledger come from the stock ledger closing balance and can differ slightly from balance totals.";

const getItemStockShape = {
  sku: z.string().trim().min(1).max(100).optional().describe("The item's SKU. Give this or itemId, not both."),
  itemId: z.string().trim().min(1).max(100).optional().describe("The item's id. Give this or sku, not both."),
  variantSku: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Only show locations holding this variant SKU."),
};

const EXACTLY_ONE = "Give exactly one of sku or itemId.";

/** The full input schema, with the exactly-one-of rule. `inputShape` is a raw shape (the MCP
 *  registry cannot carry a cross-field refine), so the handler re-checks with this schema. */
export const getItemStockInput = z
  .object(getItemStockShape)
  .refine((v) => (v.sku === undefined) !== (v.itemId === undefined), { message: EXACTLY_ONE });

type LocationRow = {
  type: "gudang" | "van" | "store";
  id?: string;
  name?: string;
  variantSku: string;
  quantity: number;
  source: "balance" | "ledger";
};

async function findItem(input: { sku?: string; itemId?: string }): Promise<{ id: string; sku: string; name: string }> {
  if (input.itemId !== undefined) {
    const item = await getItemById(input.itemId);
    if (!item) throw new ViraNotFoundError("Item not found");
    return { id: item.id, sku: item.sku, name: item.nameId };
  }
  const sku = input.sku!;
  const rows = (await listItems({ search: sku })) as unknown as Array<{ id: string; sku: string; nameId: string }>;
  const found = (Array.isArray(rows) ? rows : []).filter((r) => r.sku.toLowerCase() === sku.toLowerCase());
  if (found.length === 0) throw new ViraNotFoundError("Item not found");
  if (found.length > 1) throw new ViraInputError(`Several items have SKU ${sku}. Use itemId instead.`);
  return { id: found[0].id, sku: found[0].sku, name: found[0].nameId };
}

export const tools: ViraTool[] = [
  defineTool({
    name: "get_item_stock",
    title: "Item stock by location",
    description:
      "Shows where one item's stock is: Gudang Utama (on hand, reserved, available), each sales van (kanvas), and each store, per variant. Give either sku or itemId.",
    gate: { kind: "code", code: "inventory:view" },
    inputShape: getItemStockShape,
    handler: async (raw, ctx) => {
      const parsed = getItemStockInput.safeParse(raw);
      if (!parsed.success) throw new ViraInputError(parsed.error.issues[0]?.message ?? EXACTLY_ONE);
      const input = parsed.data;
      const item = await findItem(input);

      const [across, availableBySku, card] = await Promise.all([
        getStockAcrossLocations([item.id]),
        getItemAvailabilityBySku(item.id),
        // Only for the per-van / per-store split, which getStockAcrossLocations folds into one
        // number per variant. Main stock comes from the balance tables, never from here.
        getItemMovementCard({ itemId: item.id, variantSku: input.variantSku, locationTypes: ["STORE", "VAN"] }),
      ]);

      let onHand = 0;
      const locations: LocationRow[] = [];
      const prefix = `${item.id}::`;
      for (const [key, row] of across) {
        if (!key.startsWith(prefix)) continue;
        onHand += row.main;
        const variantSku = key.slice(prefix.length);
        if (row.main !== 0) {
          locations.push({ type: "gudang", name: "Gudang Utama", variantSku, quantity: row.main, source: "balance" });
        }
      }
      const available = Object.values(availableBySku).reduce((a, b) => a + b, 0);

      // Closing balance per location only — the movement rows (`entries`) are never read out.
      for (const s of card.sections) {
        if (s.locationType === "MAIN" || s.closingBalance === 0) continue;
        // A van's label is its salesman's name, or their email when the name is empty: never
        // send an email address, and never pass a raw id off as a name.
        const name = s.locationResolved && !s.locationLabel.includes("@") ? s.locationLabel : undefined;
        locations.push({
          type: s.locationType === "VAN" ? "van" : "store",
          id: s.locationId,
          name,
          variantSku: s.variantSku,
          quantity: s.closingBalance,
          source: "ledger",
        });
      }

      const wanted = input.variantSku === undefined ? undefined : matchKey(input.variantSku);
      const filtered = wanted === undefined ? locations : locations.filter((l) => matchKey(l.variantSku) === wanted);
      const truncated = filtered.length > MAX_LOCATION_ROWS;

      return {
        item: { ...item, url: recordUrl(ctx.baseUrl, `/backoffice/items/${item.id}`) },
        gudangUtama: { onHand, reserved: onHand - available, available, source: "balance" as const },
        locations: filtered.slice(0, MAX_LOCATION_ROWS),
        ...(truncated ? { truncated: true as const } : {}),
        note: LEDGER_NOTE,
      };
    },
  }),
];

/** getItemMovementsAction denies with Error("FORBIDDEN"), not requirePermission's 403 shape, so
 *  the "action" parity kind cannot read it; its page's route rule (inventory:view) is used instead. */
export const parityCases: ParityCase[] = [
  { tool: "get_item_stock", kind: "route", path: "/backoffice/inventory/movements" },
];
