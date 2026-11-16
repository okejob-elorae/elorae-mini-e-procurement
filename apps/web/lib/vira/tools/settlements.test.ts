import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ listSettlements: vi.fn() }));
vi.mock("@/lib/finance/settlement/queries", () => ({ listSettlements: m.listSettlements }));

import { parityCases, tools } from "./settlements";

const tool = tools[0];
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["finance:settlements:view"] },
  baseUrl: "https://e.test",
};

function row(id: string) {
  return {
    id,
    marketplace: "SHOPEE",
    seller: "elorae.official",
    periodFromIso: "2026-10-01T00:00:00.000Z",
    periodToIso: "2026-10-15T00:00:00.000Z",
    status: "PARSED",
    checksumOk: false,
    checksumVariance: 1500,
    lineCount: 40,
    matchedCount: 38,
    createdAtIso: "2026-10-16T00:00:00.000Z",
    fetchInProgress: false,
  };
}

beforeEach(() => {
  m.listSettlements.mockReset().mockResolvedValue({ items: [row("st1")], totalCount: 1 });
});

describe("list_marketplace_settlements", () => {
  it("input is limit/offset only — no filters", () => {
    expect(Object.keys(tool.inputShape).sort()).toEqual(["limit", "offset"]);
    expect(schema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("description promises only what the tool returns — no totals or fees", () => {
    expect(tool.description).toMatch(/id, channel, period/);
    expect(tool.description).toMatch(/Does not return totals, fees, or net amounts/);
    expect(tool.description).not.toMatch(/compared with Jubelio/);
  });

  it("maps the fields the source has, and nothing else", async () => {
    const out = serialize(await tool.handler(schema.parse({}), ctx)) as { items: unknown[] };
    expect(m.listSettlements).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(out.items).toEqual([
      {
        id: "st1",
        channel: "SHOPEE",
        periodStart: "2026-10-01T00:00:00.000Z",
        periodEnd: "2026-10-15T00:00:00.000Z",
        status: "PARSED",
        url: "https://e.test/backoffice/finance/settlements/st1",
      },
    ]);
  });

  it("pages with page/pageSize, and refuses an offset that is not a multiple of limit", async () => {
    m.listSettlements.mockResolvedValue({ items: [row("a")], totalCount: 12 });
    const out = (await tool.handler(schema.parse({ limit: 5, offset: 5 }), ctx)) as Record<string, unknown>;
    expect(m.listSettlements).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
    expect(out).toMatchObject({ total: 12, offset: 5, limit: 5, hasMore: true });
    await expect(tool.handler(schema.parse({ limit: 5, offset: 2 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("is gated on finance:settlements:view with one pageCode parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "finance:settlements:view" });
    expect(parityCases).toHaveLength(1);
  });
});
