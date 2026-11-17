import { z } from "zod";
import { listTaxInvoices, type TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/** The values app/backoffice/finance/faktur-pajak/page.tsx accepts (STATUS_VALUES = TaxInvoiceStatusFilter). */
export const TAX_INVOICE_STATUSES = [
  "PENDING",
  "CREATED",
  "SENT_TO_STORE",
  "NOT_REQUIRED",
  "CANCELLED",
] as const satisfies readonly TaxInvoiceStatusFilter[];

const listShape = {
  status: z
    .enum(TAX_INVOICE_STATUSES)
    .optional()
    .describe("PENDING = not created yet, CREATED, SENT_TO_STORE, NOT_REQUIRED, CANCELLED."),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the tax invoice number, the nota/report number or the store name."),
  ...listInputShape,
};

export const tools: ViraTool[] = [
  defineTool({
    name: "list_tax_invoices",
    title: "Tax invoices (faktur pajak)",
    description:
      "Lists tax invoices (faktur pajak): pending, created, or sent to the store. Filter by status or search by invoice number or store.",
    gate: { kind: "code", code: "tax_invoices:view" },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const { rows, total } = await listTaxInvoices({
        status: input.status,
        q: input.search,
        page: offset / limit + 1,
        perPage: limit,
      });
      // Never buyerNpwp / storeNpwp (or any NIK): only the fields below leave this function.
      const items = rows.map((r) => ({
        id: r.id,
        fakturNo: r.invoiceNo,
        store: { id: r.storeId, name: r.storeName },
        status: r.status,
        date: r.invoiceDate,
        dpp: r.taxableAmount,
        ppn: r.ppnAmount,
        total: r.total,
        // There is no faktur detail page; the list page's q matches the faktur number or the source
        // document number (delivery or sell-through docNo), never the id. A pending faktur has no number yet.
        url: recordUrl(ctx.baseUrl, `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(r.invoiceNo ?? r.docNo)}`),
      }));
      return toPage(items, total, offset, limit);
    },
  }),
];

export const parityCases: ParityCase[] = [
  {
    tool: "list_tax_invoices",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/finance/faktur-pajak/page.tsx",
    codes: ["tax_invoices:view"],
  },
];
