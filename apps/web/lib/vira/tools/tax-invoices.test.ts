import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ listTaxInvoices: vi.fn() }));
vi.mock("@/lib/tax-invoices/queries", () => ({ listTaxInvoices: m.listTaxInvoices }));

import { parityCases, tools } from "./tax-invoices";

const tool = tools[0];
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["tax_invoices:view"] }, baseUrl: "https://e.test" };

const NPWP = "01.234.567.8-901.000";
const NIK = "3273012345670001";

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "CREATED",
    invoiceNo: `010.000-26.0000000${id}`,
    buyerNpwp: NPWP,
    taxableAmount: 100000,
    ppnAmount: 11000,
    notaPrintedAt: null,
    docNo: `NT-${id}`,
    storeId: "s1",
    storeName: "Toko Melati",
    storeNpwp: NIK,
    orderId: "o1",
    sourceKind: "DELIVERY",
    sellThroughId: null,
    invoiceDate: new Date("2026-11-10T00:00:00.000Z"),
    dueDate: new Date("2026-12-10T00:00:00.000Z"),
    total: 111000,
    ...extra,
  };
}

beforeEach(() => {
  m.listTaxInvoices.mockReset().mockResolvedValue({ rows: [row("1")], total: 1, counts: {} });
});

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as { items: Array<Record<string, unknown>> };
}

describe("list_tax_invoices", () => {
  it("input: the page's status enum, 1–100 search", () => {
    for (const status of ["PENDING", "CREATED", "SENT_TO_STORE", "NOT_REQUIRED", "CANCELLED"]) {
      expect(schema.safeParse({ status }).success).toBe(true);
    }
    expect(schema.safeParse({ status: "ALL" }).success).toBe(false);
    expect(schema.safeParse({ search: "" }).success).toBe(false);
  });

  it("passes status and search (as q) with page/perPage", async () => {
    await run({ status: "PENDING", search: "melati", limit: 10, offset: 20 });
    expect(m.listTaxInvoices).toHaveBeenCalledWith({ status: "PENDING", q: "melati", page: 3, perPage: 10 });
  });

  it("maps exactly the listed fields; NPWP / NIK-like fields never appear", async () => {
    const out = await run({});
    expect(out.items).toEqual([
      {
        id: "1",
        fakturNo: "010.000-26.00000001",
        store: { id: "s1", name: "Toko Melati" },
        status: "CREATED",
        date: "2026-11-10T00:00:00.000Z",
        dpp: 100000,
        ppn: 11000,
        total: 111000,
        url: "https://e.test/backoffice/finance/faktur-pajak?q=010.000-26.00000001",
      },
    ]);
    const json = JSON.stringify(out);
    expect(json).not.toContain(NPWP);
    expect(json).not.toContain(NIK);
    expect(json.toLowerCase()).not.toContain("npwp");
    expect(json.toLowerCase()).not.toContain("nik");
  });

  it("a pending faktur without a number links by its id", async () => {
    m.listTaxInvoices.mockResolvedValue({ rows: [row("p 1", { status: "PENDING", invoiceNo: null })], total: 1, counts: {} });
    const out = await run({ status: "PENDING" });
    expect(out.items[0]).toMatchObject({
      fakturNo: null,
      url: "https://e.test/backoffice/finance/faktur-pajak?q=p%201",
    });
  });

  it("reports paging and refuses an offset that is not a multiple of limit", async () => {
    m.listTaxInvoices.mockResolvedValue({ rows: [row("1"), row("2")], total: 3, counts: {} });
    expect(await run({ limit: 2 })).toMatchObject({ total: 3, offset: 0, limit: 2, hasMore: true });
    await expect(tool.handler(schema.parse({ limit: 2, offset: 1 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("is gated on tax_invoices:view with one pageCode parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "tax_invoices:view" });
    expect(parityCases).toHaveLength(1);
  });
});
