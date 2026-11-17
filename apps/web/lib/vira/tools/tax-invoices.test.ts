import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  listTaxInvoices: vi.fn(),
  markTaxInvoiceSentToStore: vi.fn(),
  taxFindUnique: vi.fn(),
  taxFindMany: vi.fn(),
}));
vi.mock("@/lib/tax-invoices/queries", () => ({ listTaxInvoices: m.listTaxInvoices }));
vi.mock("@/lib/tax-invoices/writer", () => ({
  markTaxInvoiceSentToStore: m.markTaxInvoiceSentToStore,
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: {
      ...actual.prisma,
      taxInvoice: {
        findUnique: (...a: unknown[]) => m.taxFindUnique(...a),
        findMany: (...a: unknown[]) => m.taxFindMany(...a),
      },
    },
  };
});

function prismaTax(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "CREATED",
    invoiceNo: `010.000-26.0000000${id}`,
    delivery: {
      docNo: `NT-${id}`,
      invoiceDate: new Date(),
      dueDate: new Date(),
      total: 1,
      orderId: "o1",
      order: { store: { id: "s1", name: "Toko Melati", npwp: null } },
    },
    sellThrough: null,
    ...extra,
  };
}

import { TaxInvoiceError } from "@/lib/tax-invoices/errors";
import { __sampleInput, parityCases, tools, writeTools } from "./tax-invoices";

const tool = tools[0];
const mark = writeTools.find((t) => t.name === "mark_tax_invoice_sent_to_store")!;
const schema = z.object(tool.inputShape);
const markSchema = z.object(mark.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["tax_invoices:view"] }, baseUrl: "https://e.test" };
const writeCtx: ViraToolContext = {
  actor: { id: "u-tax", name: "Pajak", permissions: ["tax_invoices:manage", "vira:write"] },
  baseUrl: "https://e.test",
};

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
  m.markTaxInvoiceSentToStore.mockReset().mockResolvedValue({ ok: true });
  m.taxFindUnique.mockReset().mockResolvedValue(null);
  m.taxFindMany.mockReset().mockImplementation(async () => [prismaTax("1")]);
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

  it("a pending faktur without a number links by its source document number, which the page search matches", async () => {
    m.listTaxInvoices.mockResolvedValue({ rows: [row("p 1", { status: "PENDING", invoiceNo: null })], total: 1, counts: {} });
    const out = await run({ status: "PENDING" });
    expect(out.items[0]).toMatchObject({
      fakturNo: null,
      url: "https://e.test/backoffice/finance/faktur-pajak?q=NT-p%201",
    });
  });

  it("reports paging and refuses an offset that is not a multiple of limit", async () => {
    m.listTaxInvoices.mockResolvedValue({ rows: [row("1"), row("2")], total: 3, counts: {} });
    expect(await run({ limit: 2 })).toMatchObject({ total: 3, offset: 0, limit: 2, hasMore: true });
    await expect(tool.handler(schema.parse({ limit: 2, offset: 1 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("is gated on tax_invoices:view with one pageCode parity case", () => {
    expect(tool.gate).toEqual({ kind: "code", code: "tax_invoices:view" });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "list_tax_invoices", kind: "pageCode" }),
      ]),
    );
  });
});

describe("mark_tax_invoice_sent_to_store", () => {
  it("__sampleInput + parity", () => {
    expect(__sampleInput.mark_tax_invoice_sent_to_store).toEqual({ invoice: "t-1" });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "mark_tax_invoice_sent_to_store",
          kind: "writeAction",
          args: [{ taxInvoiceId: "t-1" }],
        }),
      ]),
    );
  });

  it("prepare CREATED only; execute maps TaxInvoiceError; note max 191", async () => {
    expect(markSchema.safeParse({ invoice: "1", note: "x".repeat(191) }).success).toBe(true);
    expect(markSchema.safeParse({ invoice: "1", note: "x".repeat(192) }).success).toBe(false);

    const prepared = await mark.prepare(
      markSchema.parse({ invoice: "1", note: "serahkan ke kasir" }),
      writeCtx,
    );
    expect(prepared.preview.title).toContain("terkirim ke toko");
    expect(prepared.preview.details.find((d) => d.label === "Catatan")?.value).toBe("serahkan ke kasir");
    expect(prepared.args).toEqual({ taxInvoiceId: "1", note: "serahkan ke kasir" });
    expect(m.taxFindMany).toHaveBeenCalled();

    m.taxFindUnique.mockResolvedValueOnce(prismaTax("1", { status: "PENDING" }));
    await expect(mark.prepare(markSchema.parse({ invoice: "1" }), writeCtx)).rejects.toBeInstanceOf(ViraInputError);

    m.taxFindUnique.mockResolvedValueOnce(prismaTax("t-1"));
    const byId = await mark.prepare(markSchema.parse({ invoice: "t-1" }), writeCtx);
    expect(byId.args).toEqual({ taxInvoiceId: "t-1" });
    expect(m.taxFindMany).toHaveBeenCalledTimes(1); // id hit skips findMany

    const ok = await mark.execute({ taxInvoiceId: "1" }, writeCtx);
    expect(m.markTaxInvoiceSentToStore).toHaveBeenCalledWith({
      taxInvoiceId: "1",
      reason: undefined,
      userId: "u-tax",
    });
    expect(ok).toMatchObject({ ok: true, entityType: "TaxInvoice" });

    m.markTaxInvoiceSentToStore.mockRejectedValueOnce(new TaxInvoiceError("INVALID_STATE"));
    expect(await mark.execute({ taxInvoiceId: "1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "INVALID_STATE",
    });
  });
});
