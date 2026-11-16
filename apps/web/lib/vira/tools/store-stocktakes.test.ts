import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ resolveStore: vi.fn(), listStoreStocktakes: vi.fn() }));
vi.mock("./_resolve-store", () => ({ resolveStore: m.resolveStore }));
vi.mock("@/lib/stores/stocktake/queries", () => ({ listStoreStocktakes: m.listStoreStocktakes }));

import { parityCases, tools } from "./store-stocktakes";

const tool = tools.find((t) => t.name === "list_store_stocktakes")!;
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["stores:view"] }, baseUrl: "https://e.test" };

function baris(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `st${i}`,
    docNo: `SO-TK-${i}`,
    storeName: "Toko Melati",
    status: "APPROVED",
    countedAt: new Date("2026-11-0" + (i + 1) + "T03:00:00Z"),
    isFullCount: true,
    lineCount: 10,
    countedLineCount: 10,
    netVarianceQty: -2,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...extra,
  };
}

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as {
    items: Array<Record<string, unknown>>;
    total: number;
    hasMore: boolean;
  };
}

beforeEach(() => {
  m.resolveStore.mockReset().mockResolvedValue({ id: "s1", code: "TK-MEL", name: "Toko Melati" });
  m.listStoreStocktakes.mockReset().mockResolvedValue({ rows: [baris(1)], total: 1 });
});

describe("list_store_stocktakes input", () => {
  it("accepts the listStoreStocktakes status enum only, and a 1–100 search", () => {
    for (const status of ["DRAFT", "PENDING_VERIFICATION", "APPROVED", "CANCELLED"]) {
      expect(schema.safeParse({ status }).success).toBe(true);
    }
    expect(schema.safeParse({ status: "VERIFIED" }).success).toBe(false);
    expect(schema.safeParse({ search: "" }).success).toBe(false);
    expect(schema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
    expect(schema.parse({})).toEqual({ limit: 20, offset: 0 });
  });
});

describe("list_store_stocktakes handler", () => {
  it("without a store: passes status and search, no store id, and maps exactly the listed fields", async () => {
    const out = await run({ status: "APPROVED", search: "SO-TK" });
    expect(m.resolveStore).not.toHaveBeenCalled();
    expect(m.listStoreStocktakes).toHaveBeenCalledWith({
      storeId: undefined,
      status: "APPROVED",
      q: "SO-TK",
      page: 1,
      perPage: 20,
    });
    expect(out.items).toEqual([
      {
        id: "st1",
        docNo: "SO-TK-1",
        store: { name: "Toko Melati" },
        status: "APPROVED",
        date: "2026-11-02T03:00:00.000Z",
        varianceQty: -2,
        url: "https://e.test/backoffice/store-stocktakes/st1",
      },
    ]);
  });

  it("with a store: resolves it and returns its id on each row", async () => {
    const out = await run({ store: "melati" });
    expect(m.resolveStore).toHaveBeenCalledWith("melati");
    expect(m.listStoreStocktakes).toHaveBeenCalledWith(expect.objectContaining({ storeId: "s1" }));
    expect(out.items[0].store).toEqual({ id: "s1", name: "Toko Melati" });
  });

  it("a stocktake with no counted line keeps varianceQty null", async () => {
    m.listStoreStocktakes.mockResolvedValue({ rows: [baris(1, { countedLineCount: 0, netVarianceQty: null })], total: 1 });
    expect((await run({})).items[0].varianceQty).toBeNull();
  });

  it("pages with page/perPage and reports hasMore", async () => {
    m.listStoreStocktakes.mockResolvedValue({ rows: [baris(1), baris(2)], total: 5 });
    const out = await run({ limit: 2, offset: 2 });
    expect(m.listStoreStocktakes).toHaveBeenCalledWith(expect.objectContaining({ page: 2, perPage: 2 }));
    expect(out).toMatchObject({ total: 5, offset: 2, limit: 2, hasMore: true });
  });

  it("an offset that is not a multiple of limit is an input error", async () => {
    await expect(tool.handler(schema.parse({ limit: 10, offset: 3 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("an unknown or ambiguous store surfaces resolveStore's error", async () => {
    m.resolveStore.mockRejectedValueOnce(new ViraNotFoundError("Store not found"));
    await expect(tool.handler(schema.parse({ store: "x" }), ctx)).rejects.toBeInstanceOf(ViraNotFoundError);
    m.resolveStore.mockRejectedValueOnce(new ViraInputError("Several stores match"));
    await expect(tool.handler(schema.parse({ store: "x" }), ctx)).rejects.toBeInstanceOf(ViraInputError);
    expect(m.listStoreStocktakes).not.toHaveBeenCalled();
  });

  it("is gated on stores:view with one pageCode parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "stores:view" });
    expect(parityCases).toHaveLength(1);
  });
});
