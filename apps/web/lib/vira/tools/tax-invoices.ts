import { z } from "zod";
import { prisma } from "@elorae/db";
import { TAX_INVOICE_SOURCE_SELECT, resolveTaxInvoiceSource } from "@/lib/finance/ar/receivable-source";
import { MAX_TAX_INVOICE_REASON_LENGTH, TaxInvoiceError } from "@/lib/tax-invoices/errors";
import { listTaxInvoices, type TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import { markTaxInvoiceSentToStore } from "@/lib/tax-invoices/writer";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraTool,
  type ViraWriteTool,
} from "./types";

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

/** Copy of `fakturPajak.actionErr` in id.json. */
const PESAN: Record<string, string> = {
  FORBIDDEN: "Anda tidak memiliki izin untuk melakukan aksi ini.",
  NOT_FOUND: "Faktur pajak tidak ditemukan.",
  INVALID_STATE: "Aksi ini tidak dapat dilakukan pada status faktur saat ini.",
  INVALID_REQUEST: "Data yang dikirim tidak valid.",
  CONFLICT: "Status faktur baru saja diubah oleh pengguna lain. Muat ulang halaman dan coba lagi.",
  REASON_TOO_LONG: "Alasan terlalu panjang. Maksimal 191 karakter.",
  ERROR: "Terjadi kesalahan. Silakan coba lagi.",
};

type TaxRow = {
  id: string;
  status: string;
  invoiceNo: string | null;
  docNo: string;
  storeId: string;
  storeName: string;
};

const taxSelect = {
  id: true,
  status: true,
  invoiceNo: true,
  ...TAX_INVOICE_SOURCE_SELECT,
} as const;

function toTaxRow(row: {
  id: string;
  status: string;
  invoiceNo: string | null;
  delivery: Parameters<typeof resolveTaxInvoiceSource>[0]["delivery"];
  sellThrough: Parameters<typeof resolveTaxInvoiceSource>[0]["sellThrough"];
}): TaxRow {
  const source = resolveTaxInvoiceSource(row);
  return {
    id: row.id,
    status: row.status,
    invoiceNo: row.invoiceNo,
    docNo: source.docNo,
    storeId: source.storeId,
    storeName: source.storeName,
  };
}

async function resolveInvoice(invoice: string): Promise<TaxRow> {
  // Primary key first — list search never matches id.
  const byId = await prisma.taxInvoice.findUnique({ where: { id: invoice }, select: taxSelect });
  if (byId && (byId.delivery || byId.sellThrough)) return toTaxRow(byId);

  // Exact doc / faktur match (not contains), same idea as FSO `lookupByExactDocNo`.
  const exact = await prisma.taxInvoice.findMany({
    where: {
      OR: [
        { invoiceNo: invoice },
        { delivery: { docNo: invoice } },
        { sellThrough: { docNo: invoice } },
      ],
    },
    select: taxSelect,
    take: 5,
  });
  const hit = exact.filter((r) => r.delivery || r.sellThrough);
  if (hit.length === 0) throw new ViraNotFoundError("Faktur pajak tidak ditemukan");
  if (hit.length > 1) {
    throw new ViraInputError(
      `Beberapa faktur cocok: ${hit
        .slice(0, 5)
        .map((r) => r.invoiceNo ?? resolveTaxInvoiceSource(r).docNo)
        .join(", ")}. Lebih spesifik.`,
    );
  }
  return toTaxRow(hit[0]);
}

type MarkArgs = { taxInvoiceId: string; note?: string };

/**
 * Mirrors `markSentToStoreAction` in `app/actions/tax-invoices.ts` (~L137–156)
 * and `markTaxInvoiceSentToStore` in `lib/tax-invoices/writer.ts` (~L247–262).
 */
const markTaxInvoiceSentToStoreTool = defineWriteTool({
  kind: "write",
  name: "mark_tax_invoice_sent_to_store",
  title: "Mark tax invoice sent to store",
  description:
    "Prepares marking a faktur pajak as sent to the store. The user must press the confirm button.",
  gate: { kind: "code", code: "tax_invoices:manage" },
  destructive: false,
  inputShape: {
    invoice: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("The tax invoice id or faktur number."),
    note: z
      .string()
      .trim()
      .max(MAX_TAX_INVOICE_REASON_LENGTH)
      .optional()
      .describe("Optional note (passed as reason)."),
  },
  argsSchema: z.object({
    taxInvoiceId: z.string().min(1),
    note: z.string().trim().max(MAX_TAX_INVOICE_REASON_LENGTH).optional(),
  }),
  __sampleInput: { invoice: "t-1" },
  prepare: async (input, ctx) => {
    const row = await resolveInvoice(input.invoice);
    // Writer only accepts CREATED → SENT_TO_STORE.
    if (row.status !== "CREATED") {
      throw new ViraInputError(
        `Faktur berstatus ${row.status}, tidak bisa ditandai terkirim ke toko.`,
      );
    }
    const no = row.invoiceNo ?? row.docNo;
    const url = recordUrl(
      ctx.baseUrl,
      `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(no)}`,
    );
    return {
      preview: {
        title: `Tandai faktur ${no} terkirim ke toko`,
        summary: `${row.storeName} · ${row.status}`,
        details: [
          { label: "Toko", value: row.storeName },
          { label: "Nota asal", value: row.docNo },
          { label: "Status sekarang", value: row.status },
          ...(input.note ? [{ label: "Catatan", value: input.note }] : []),
        ],
        confirmLabel: "Tandai terkirim",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "tax_invoice", id: row.id, url },
      },
      args: {
        taxInvoiceId: row.id,
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/finance/faktur-pajak`);
    try {
      await markTaxInvoiceSentToStore({
        taxInvoiceId: args.taxInvoiceId,
        reason: args.note,
        userId: ctx.actor.id,
      });
    } catch (e) {
      // Mirror action `toResult` (TaxInvoiceError → code).
      if (e instanceof TaxInvoiceError) {
        return { ok: false, code: e.code, message: PESAN[e.code] ?? e.code, url };
      }
      return { ok: false, code: "ERROR", message: PESAN.ERROR, url };
    }
    let no = args.taxInvoiceId;
    try {
      const again = await resolveInvoice(args.taxInvoiceId);
      no = again.invoiceNo ?? again.docNo;
    } catch {
      /* keep id fallback */
    }
    return {
      ok: true,
      message: `Faktur ${no} ditandai terkirim.`,
      url: recordUrl(
        ctx.baseUrl,
        `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(no)}`,
      ),
      entityType: "TaxInvoice",
      entityId: args.taxInvoiceId,
    };
  },
  revalidate: () => ["/backoffice/finance/faktur-pajak"],
});

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

export const writeTools: ViraWriteTool[] = [markTaxInvoiceSentToStoreTool];

export const __sampleInput = {
  mark_tax_invoice_sent_to_store: { invoice: "t-1" },
};

export const parityCases: ParityCase[] = [
  {
    tool: "list_tax_invoices",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/finance/faktur-pajak/page.tsx",
    codes: ["tax_invoices:view"],
  },
  {
    tool: "mark_tax_invoice_sent_to_store",
    kind: "writeAction",
    actionModule: "@/app/actions/tax-invoices",
    actionExport: "markSentToStoreAction",
    writerModule: "@/lib/tax-invoices/writer",
    writerExport: "markTaxInvoiceSentToStore",
    args: [{ taxInvoiceId: "t-1" }],
  },
];
