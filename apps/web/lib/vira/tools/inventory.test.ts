import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  getItemById: vi.fn(),
  listItems: vi.fn(),
  getStockAcrossLocations: vi.fn(),
  getItemAvailabilityBySku: vi.fn(),
  getItemMovementCard: vi.fn(),
}));
vi.mock("@/lib/items/queries", () => ({ getItemById: m.getItemById, listItems: m.listItems }));
vi.mock("@/lib/inventory/stock-across-locations", () => ({ getStockAcrossLocations: m.getStockAcrossLocations }));
vi.mock("@/lib/field-sales/queries", () => ({ getItemAvailabilityBySku: m.getItemAvailabilityBySku }));
vi.mock("@/lib/inventory/stock-ledger-card", () => ({ getItemMovementCard: m.getItemMovementCard }));

import { getItemStockInput, LEDGER_NOTE, parityCases, tools } from "./inventory";

const tool = tools.find((t) => t.name === "get_item_stock")!;
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["inventory:view"] },
  baseUrl: "https://elorae.test/",
};

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

const ITEM = { id: "it1", sku: "KAOS-01", nameId: "Kaos Polos", nameEn: "Plain Tee", sellingPrice: 90000, fgConsumptions: [] };

function entries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    refType: "VAN_LOAD",
    refId: `r${i}`,
    refDocNumber: `DOC-${i}`,
    qty: 1,
    balanceQty: i + 1,
    unitCost: 40000,
    createdById: "admin-1",
    createdAt: new Date("2026-11-01T00:00:00Z"),
  }));
}

function section(
  locationType: "MAIN" | "STORE" | "VAN",
  locationId: string,
  locationLabel: string,
  variantSku: string,
  closingBalance: number,
  extra: Record<string, unknown> = {},
) {
  return {
    locationType,
    locationId,
    locationLabel,
    locationResolved: true,
    variantSku,
    closingBalance,
    entries: entries(2),
    truncated: false,
    ...extra,
  };
}

function card(sections: unknown[]) {
  return { sections, hasAnyHistory: true, sectionLimit: 500, queryTruncated: false };
}

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as Record<string, unknown> & {
    locations: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getItemById.mockResolvedValue(ITEM);
  m.listItems.mockResolvedValue([ITEM, { ...ITEM, id: "it2", sku: "KAOS-010" }]);
  m.getStockAcrossLocations.mockResolvedValue(
    new Map([
      ["it1::kaos-01-s", { main: 10, van: 4, store: 6, total: 20 }],
      ["it1::kaos-01-m", { main: 0, van: 0, store: 2, total: 2 }],
    ]),
  );
  m.getItemAvailabilityBySku.mockResolvedValue({ "kaos-01-s": 7, "kaos-01-m": 0 });
  m.getItemMovementCard.mockResolvedValue(
    card([
      section("VAN", "user-9", "Budi", "kaos-01-s", 4),
      section("STORE", "store-1", "Toko Melati", "kaos-01-s", 6),
      section("STORE", "store-1", "Toko Melati", "kaos-01-m", 2),
      section("STORE", "store-2", "Toko Lama", "kaos-01-s", 0),
    ]),
  );
});

describe("get_item_stock input", () => {
  it("exactly one of sku / itemId", () => {
    expect(getItemStockInput.safeParse({ sku: "KAOS-01" }).success).toBe(true);
    expect(getItemStockInput.safeParse({ itemId: "it1", variantSku: "kaos-01-s" }).success).toBe(true);
    expect(getItemStockInput.safeParse({}).success).toBe(false);
    expect(getItemStockInput.safeParse({ sku: "KAOS-01", itemId: "it1" }).success).toBe(false);
  });
  it("the handler refuses neither / both as an input error before reading anything", async () => {
    await expect(tool.handler({}, ctx)).rejects.toBeInstanceOf(ViraInputError);
    await expect(tool.handler({ sku: "KAOS-01", itemId: "it1" }, ctx)).rejects.toBeInstanceOf(ViraInputError);
    expect(m.getItemById).not.toHaveBeenCalled();
    expect(m.listItems).not.toHaveBeenCalled();
  });
});

describe("get_item_stock handler", () => {
  it("returns gudang balance rows and per-location ledger rows with the right source labels", async () => {
    const out = await run({ itemId: "it1" });
    expect(out).toEqual({
      item: { id: "it1", sku: "KAOS-01", name: "Kaos Polos", url: "https://elorae.test/backoffice/items/it1" },
      gudangUtama: { onHand: 10, reserved: 3, available: 7, source: "balance" },
      locations: [
        { type: "gudang", name: "Gudang Utama", variantSku: "kaos-01-s", quantity: 10, source: "balance" },
        { type: "van", id: "user-9", name: "Budi", variantSku: "kaos-01-s", quantity: 4, source: "ledger" },
        { type: "store", id: "store-1", name: "Toko Melati", variantSku: "kaos-01-s", quantity: 6, source: "ledger" },
        { type: "store", id: "store-1", name: "Toko Melati", variantSku: "kaos-01-m", quantity: 2, source: "ledger" },
      ],
      note: LEDGER_NOTE,
    });
    expect(m.getItemMovementCard).toHaveBeenCalledWith({
      itemId: "it1",
      variantSku: undefined,
      locationTypes: ["STORE", "VAN"],
    });
  });

  it("never returns movement rows, even when the ledger card holds 2000 of them", async () => {
    m.getItemMovementCard.mockResolvedValue(
      card([section("STORE", "store-1", "Toko Melati", "kaos-01-s", 2000, { entries: entries(2000), truncated: true })]),
    );
    const out = await run({ itemId: "it1" });
    const keys = allKeys(out);
    for (const banned of ["entries", "refType", "refId", "refDocNumber", "balanceQty", "unitCost", "createdById", "createdAt"]) {
      expect(keys.has(banned), banned).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain("DOC-");
    expect(out.locations).toHaveLength(2);
  });

  it("never sends a van label that is an email, nor an unresolved id as a name", async () => {
    m.getItemMovementCard.mockResolvedValue(
      card([
        section("VAN", "user-1", "budi@example.com", "kaos-01-s", 3),
        section("STORE", "store-x", "store-x", "kaos-01-s", 1, { locationResolved: false }),
      ]),
    );
    const out = await run({ itemId: "it1" });
    expect(JSON.stringify(out)).not.toContain("@");
    expect(out.locations.slice(1)).toEqual([
      { type: "van", id: "user-1", variantSku: "kaos-01-s", quantity: 3, source: "ledger" },
      { type: "store", id: "store-x", variantSku: "kaos-01-s", quantity: 1, source: "ledger" },
    ]);
  });

  it("variantSku filters the locations (case-insensitively) and narrows the ledger read", async () => {
    const out = await run({ itemId: "it1", variantSku: "KAOS-01-M" });
    expect(out.locations).toEqual([
      { type: "store", id: "store-1", name: "Toko Melati", variantSku: "kaos-01-m", quantity: 2, source: "ledger" },
    ]);
    expect(m.getItemMovementCard).toHaveBeenCalledWith(expect.objectContaining({ variantSku: "KAOS-01-M" }));
  });

  it("more than 50 locations → 50 rows and truncated: true", async () => {
    m.getItemMovementCard.mockResolvedValue(
      card(Array.from({ length: 60 }, (_, i) => section("STORE", `store-${i}`, `Toko ${i}`, "kaos-01-s", 1))),
    );
    const out = await run({ itemId: "it1" });
    expect(out.locations).toHaveLength(50);
    expect(out.truncated).toBe(true);
  });

  it("50 or fewer locations has no truncated key", async () => {
    expect("truncated" in (await run({ itemId: "it1" }))).toBe(false);
  });

  it("finds an item by exact SKU (case-insensitive), not by a longer SKU that also matches the search", async () => {
    const out = await run({ sku: "kaos-01" });
    expect(m.listItems).toHaveBeenCalledWith({ search: "kaos-01" });
    expect((out.item as { id: string }).id).toBe("it1");
  });

  it("unknown item → ViraNotFoundError", async () => {
    m.getItemById.mockResolvedValue(null);
    await expect(tool.handler(schema.parse({ itemId: "nope" }), ctx)).rejects.toEqual(
      new ViraNotFoundError("Item not found"),
    );
    m.listItems.mockResolvedValue([{ ...ITEM, sku: "KAOS-010" }]);
    await expect(tool.handler(schema.parse({ sku: "KAOS-01" }), ctx)).rejects.toBeInstanceOf(ViraNotFoundError);
  });

  it("two items with the same SKU → ViraInputError", async () => {
    m.listItems.mockResolvedValue([ITEM, { ...ITEM, id: "it9" }]);
    await expect(tool.handler(schema.parse({ sku: "KAOS-01" }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });
});

describe("get_item_stock registry entry", () => {
  it("is gated on inventory:view with one parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "inventory:view" });
    expect(parityCases).toHaveLength(1);
  });
});
