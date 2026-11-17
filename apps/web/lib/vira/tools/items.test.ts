import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const listItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/items/queries", () => ({ listItems }));

import { parityCases, tools } from "./items";

const tool = tools.find((t) => t.name === "search_items")!;
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["items:view"] },
  baseUrl: "https://elorae.test",
};

/** Every key anywhere in a JSON value. */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

/** A row as listItems returns it on the paged path, including the fields VIRA must drop. */
function listedRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    sku: `SKU-${id}`,
    nameId: `Kaos ${id}`,
    nameEn: `Shirt ${id}`,
    type: "FINISHED_GOOD",
    isActive: true,
    uom: { code: "PCS", nameId: "Pcs", nameEn: "Pcs" },
    category: { id: "c1", name: "Atasan", code: "ATS" },
    sellingPrice: 120000,
    additionalCost: 5000,
    commissionPerPcs: 1000,
    supplierId: "sup-1",
    inventoryValue: { qtyOnHand: 10, reservedQty: 3, available: 7, avgCost: 40000, totalValue: 400000 },
    fgConsumptions: [{ qtyRequired: 1, wastePercent: 0, material: { sku: "KAIN-1" } }],
    variants: [{ sku: "V1" }],
    ...extra,
  };
}

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as {
    items: Array<Record<string, unknown>>;
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

beforeEach(() => {
  listItems.mockReset();
  listItems.mockResolvedValue({ items: [listedRow("a")], totalCount: 1 });
});

describe("search_items input", () => {
  it("accepts a query and fills the defaults", () => {
    expect(schema.parse({ query: "  kaos " })).toEqual({ query: "kaos", activeOnly: true, limit: 20, offset: 0 });
  });
  it("rejects an empty query, a blank query and a 101-char query", () => {
    expect(schema.safeParse({ query: "" }).success).toBe(false);
    expect(schema.safeParse({ query: "   " }).success).toBe(false);
    expect(schema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ query: "x".repeat(100) }).success).toBe(true);
  });
  it("accepts the listItems type enum only", () => {
    for (const type of ["FABRIC", "ACCESSORIES", "FINISHED_GOOD", "raw"]) {
      expect(schema.safeParse({ query: "a", type }).success).toBe(true);
    }
    expect(schema.safeParse({ query: "a", type: "SERVICE" }).success).toBe(false);
  });
  it("rejects limits outside 1–50 and negative offsets", () => {
    expect(schema.safeParse({ query: "a", limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ query: "a", limit: 51 }).success).toBe(false);
    expect(schema.safeParse({ query: "a", offset: -1 }).success).toBe(false);
  });
});

describe("search_items handler", () => {
  it("passes the query, type and activeOnly to listItems as the items page does", async () => {
    await run({ query: "kaos", type: "raw" });
    expect(listItems).toHaveBeenCalledWith({ search: "kaos", type: "raw", isActive: true }, { page: 1, pageSize: 20 });
    await run({ query: "kaos", activeOnly: false });
    expect(listItems).toHaveBeenLastCalledWith(
      { search: "kaos", type: undefined, isActive: undefined },
      { page: 1, pageSize: 20 },
    );
  });

  it("returns exactly the listed fields, and no cost, price, supplier or BOM data anywhere", async () => {
    const page = await run({ query: "kaos" });
    expect(page.items).toEqual([
      {
        id: "a",
        sku: "SKU-a",
        name: "Kaos a",
        type: "FINISHED_GOOD",
        active: true,
        unit: "PCS",
        gudangUtama: { onHand: 10, reserved: 3, available: 7 },
        url: "https://elorae.test/backoffice/items/a",
      },
    ]);
    const keys = allKeys(page);
    for (const banned of [
      "avgCost",
      "totalValue",
      "sellingPrice",
      "additionalCost",
      "commissionPerPcs",
      "supplierId",
      "fgConsumptions",
      "material",
      "variants",
      "category",
    ]) {
      expect(keys.has(banned), banned).toBe(false);
    }
  });

  it("an item with no inventory rows shows zero stock", async () => {
    listItems.mockResolvedValue({ items: [listedRow("b", { inventoryValue: null })], totalCount: 1 });
    const page = await run({ query: "kaos" });
    expect(page.items[0].gudangUtama).toEqual({ onHand: 0, reserved: 0, available: 0 });
  });

  it("pages with page/pageSize and reports hasMore", async () => {
    listItems.mockResolvedValue({ items: [listedRow("c"), listedRow("d")], totalCount: 7 });
    const page = await run({ query: "kaos", limit: 2, offset: 4 });
    expect(listItems).toHaveBeenCalledWith(expect.anything(), { page: 3, pageSize: 2 });
    expect(page).toMatchObject({ total: 7, offset: 4, limit: 2, hasMore: true });
    expect(page.items.map((i) => i.id)).toEqual(["c", "d"]);

    listItems.mockResolvedValue({ items: [listedRow("e")], totalCount: 7 });
    expect(await run({ query: "kaos", limit: 2, offset: 6 })).toMatchObject({ hasMore: false });
  });

  it("an offset that is not a multiple of limit is an input error", async () => {
    await expect(tool.handler(schema.parse({ query: "a", limit: 20, offset: 5 }), ctx)).rejects.toBeInstanceOf(
      ViraInputError,
    );
    expect(listItems).not.toHaveBeenCalled();
  });
});

describe("search_items registry entry", () => {
  it("is gated on items:view with one route parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "items:view" });
    expect(parityCases).toEqual([{ tool: "search_items", kind: "route", path: "/backoffice/items" }]);
  });
});
