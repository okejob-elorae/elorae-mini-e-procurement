import { z } from "zod";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { STATUS_PO_BISA_TERLAMBAT } from "@/lib/purchase-orders/overdue";
import { listPOs } from "@/lib/purchase-orders/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

// Copied from IZIN_BACA_PO in app/actions/purchase-orders.ts. Pinned by parity.spec.ts.
export const PO_READ_CODES = [
  "purchase_orders:view",
  "supplier_payments:view",
  "inventory:manage",
  "work_orders:create",
  "work_orders:manage",
] as const;

/** `POStatus` (packages/db schema), the values `ListPOsFilters.status` accepts. */
export const PO_STATUSES = ["DRAFT", "SUBMITTED", "PARTIAL", "CLOSED", "OVER", "CANCELLED"] as const;

const listShape = {
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the PO number or the supplier's name or code."),
  status: z.enum(PO_STATUSES).optional().describe("Only POs in this status."),
  overdue: z
    .boolean()
    .optional()
    .describe("Only overdue POs: expected date before today (WIB), still SUBMITTED or PARTIAL."),
  ...listInputShape,
};

type PoRow = {
  id: string;
  docNumber: string;
  supplierId: string;
  supplier: { name: string };
  status: string;
  createdAt: string | null;
  etaDate: string | null;
  grandTotal: number;
};

/** The same rule as `overduePOWhere` (the list's `overdue` filter, the dashboard and the menu badge). */
function isOverdue(row: PoRow, startOfTodayWib: Date): boolean {
  return (
    (STATUS_PO_BISA_TERLAMBAT as readonly string[]).includes(row.status) &&
    row.etaDate !== null &&
    new Date(row.etaDate) < startOfTodayWib
  );
}

export const tools: ViraTool[] = [
  defineTool({
    name: "list_purchase_orders",
    title: "Purchase orders",
    description:
      "Lists purchase orders (PO) to suppliers. Filter by status or supplier search, or show only overdue POs (expected date passed, not fully received).",
    gate: { kind: "anyOf", codes: [...PO_READ_CODES] },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const hasil = await listPOs(
        {
          ...(input.status ? { status: input.status } : {}),
          ...(input.overdue ? { overdue: true } : {}),
          ...(input.search ? { cari: input.search } : {}),
        },
        { page: offset / limit + 1, pageSize: limit },
      );
      const rows = (Array.isArray(hasil) ? hasil : hasil.items) as unknown as PoRow[];
      const total = Array.isArray(hasil) ? hasil.length : hasil.totalCount;
      const awal = batasHariIniWib().awal;
      const items = rows.map((po) => ({
        id: po.id,
        poNo: po.docNumber,
        supplier: { id: po.supplierId, name: po.supplier.name },
        status: po.status,
        orderDate: po.createdAt,
        expectedDate: po.etaDate,
        total: po.grandTotal,
        isOverdue: isOverdue(po, awal),
        url: recordUrl(ctx.baseUrl, `/backoffice/purchase-orders/${po.id}`),
      }));
      return toPage(items, total, offset, limit);
    },
  }),
];

/** Module ids are written with the "@/" alias the action itself imports with, so the mock lands. */
export const parityCases: ParityCase[] = [
  {
    tool: "list_purchase_orders",
    kind: "action",
    actionModule: "@/app/actions/purchase-orders",
    actionExport: "getPOs",
    libModule: "@/lib/purchase-orders/queries",
    libExport: "listPOs",
    args: [],
  },
];
