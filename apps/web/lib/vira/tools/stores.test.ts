import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ resolveStore: vi.fn(), getStoreStockCard: vi.fn() }));
vi.mock("./_resolve-store", () => ({ resolveStore: m.resolveStore }));
vi.mock("@/lib/inventory/store-stock-card", () => ({ getStoreStockCard: m.getStoreStockCard }));

import { parityCases, tools } from "./stores";

const tool = tools.find((t) => t.name === "get_store_stock")!;
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["stores:view"] }, baseUrl: "https://e.test" };

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

function baris(i: number, extra: Record<string, unknown> = {}) {
  return {
    itemId: `it${i}`,
    variantSku: `KAOS-${i}-M`,
    itemName: `Kaos ${i}`,
    qty: i,
    mainQty: 100,
    vanQty: 7,
    uncountedInLastCount: false,
    dalamPerjalanan: 0,
    ...extra,
  };
}

function gerakan(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `mv${i}`,
    refType: "SpgSale",
    docNo: `SPG-${i}`,
    href: `/backoffice/spg-sales/${i}`,
    occurredAt: new Date("2026-11-01T00:00:00Z"),
    itemName: "Kaos",
    variantSku: "KAOS-1-M",
    qty: -1,
  }));
}

function kartu(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    rows,
    dalamPerjalananTanpaStok: [],
    negativeCount: 0,
    lastPartialCount: null,
    movements: gerakan(3),
    movementsTruncated: false,
    movementLimit: 500,
    ...extra,
  };
}

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as Record<string, unknown> & {
    items: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  m.resolveStore.mockReset().mockResolvedValue({ id: "s1", code: "TK-MEL", name: "Toko Melati" });
  m.getStoreStockCard.mockReset().mockResolvedValue(
    kartu([baris(1, { dalamPerjalanan: 4 }), baris(2)], {
      dalamPerjalananTanpaStok: [{ itemId: "it9", variantSku: "TOPI-9", itemName: "Topi", dalamPerjalanan: 6 }],
    }),
  );
});

describe("get_store_stock input", () => {
  it("store is required, 1–100 chars", () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ store: "" }).success).toBe(false);
    expect(schema.safeParse({ store: "x".repeat(101) }).success).toBe(false);
    expect(schema.parse({ store: " TK-MEL " })).toEqual({ store: "TK-MEL", limit: 20, offset: 0 });
  });
});

describe("get_store_stock handler", () => {
  it("returns the store and stock rows with exactly the listed fields, in-transit-only rows included", async () => {
    const out = await run({ store: "melati" });
    expect(m.resolveStore).toHaveBeenCalledWith("melati");
    expect(m.getStoreStockCard).toHaveBeenCalledWith("s1");
    expect(out).toEqual({
      store: { id: "s1", code: "TK-MEL", name: "Toko Melati", url: "https://e.test/backoffice/stores/s1" },
      items: [
        { name: "Kaos 1", variantSku: "KAOS-1-M", quantity: 1, inTransit: 4 },
        { name: "Kaos 2", variantSku: "KAOS-2-M", quantity: 2, inTransit: 0 },
        { name: "Topi", variantSku: "TOPI-9", quantity: 0, inTransit: 6 },
      ],
      total: 3,
      offset: 0,
      limit: 20,
      hasMore: false,
    });
  });

  it("never includes movement data, even when the source returns 500 movements", async () => {
    m.getStoreStockCard.mockResolvedValue(kartu([baris(1)], { movements: gerakan(500), movementsTruncated: true }));
    const out = await run({ store: "s1" });
    const keys = allKeys(out);
    for (const banned of ["movements", "movementsTruncated", "movementLimit", "refType", "docNo", "href", "occurredAt", "mainQty", "vanQty"]) {
      expect(keys.has(banned), banned).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain("SPG-");
  });

  it("query filters by variant SKU or item name, case-insensitively, before paging", async () => {
    expect((await run({ store: "s1", query: "kaos-2" })).items.map((i) => i.name)).toEqual(["Kaos 2"]);
    expect((await run({ store: "s1", query: "TOPI" })).items.map((i) => i.name)).toEqual(["Topi"]);
    expect((await run({ store: "s1", query: "sepatu" })).total).toBe(0);
  });

  it("pages the filtered rows with sliceToPage", async () => {
    m.getStoreStockCard.mockResolvedValue(kartu(Array.from({ length: 5 }, (_, i) => baris(i))));
    const out = await run({ store: "s1", limit: 2, offset: 3 });
    expect(out).toMatchObject({ total: 5, offset: 3, limit: 2, hasMore: false });
    expect(out.items.map((i) => i.name)).toEqual(["Kaos 3", "Kaos 4"]);
    expect(await run({ store: "s1", limit: 2, offset: 1 })).toMatchObject({ hasMore: true });
  });

  it("passes resolveStore's not-found and ambiguous errors through", async () => {
    m.resolveStore.mockRejectedValueOnce(new ViraNotFoundError("Store not found"));
    await expect(tool.handler(schema.parse({ store: "x" }), ctx)).rejects.toBeInstanceOf(ViraNotFoundError);
    m.resolveStore.mockRejectedValueOnce(new ViraInputError("Several stores match: …"));
    await expect(tool.handler(schema.parse({ store: "x" }), ctx)).rejects.toBeInstanceOf(ViraInputError);
    expect(m.getStoreStockCard).not.toHaveBeenCalled();
  });

  it("is gated on stores:view with one pageCode parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "stores:view" });
    expect(parityCases).toHaveLength(1);
  });
});
