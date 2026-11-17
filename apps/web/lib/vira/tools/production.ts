import { z } from "zod";
import { listWorkOrders } from "@/lib/work-orders/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

// Copied from IZIN_BACA_WO + vendor_returns:view in app/actions/production.ts (getWorkOrders). Pinned by parity.spec.ts.
export const WO_READ_CODES = ["work_orders:view", "work_orders:create", "work_orders:manage", "vendor_returns:view"] as const;

/** `WOStatus` (packages/db schema); `ListWorkOrdersFilters.status` is a plain string matched against it. */
export const WO_STATUSES = ["DRAFT", "ISSUED", "IN_PRODUCTION", "PARTIAL", "COMPLETED", "CANCELLED"] as const;

const listShape = {
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the WO number, vendor name or code, or the finished good's name or SKU."),
  status: z.enum(WO_STATUSES).optional().describe("Only work orders in this status."),
  late: z
    .boolean()
    .optional()
    .describe("Only active work orders whose target date has passed."),
  ...listInputShape,
};

type WoRow = {
  id: string;
  docNumber: string;
  plannedQty: number;
  targetDate: Date | null;
  status: string;
  finishedGood: { sku: string; nameId: string };
};

export const tools: ViraTool[] = [
  defineTool({
    name: "list_work_orders",
    title: "Work orders (SPK)",
    description: "Lists production work orders (SPK). Filter by status or search.",
    gate: { kind: "anyOf", codes: [...WO_READ_CODES] },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const hasil = await listWorkOrders(
        {
          ...(input.status ? { status: input.status } : {}),
          ...(input.search ? { q: input.search } : {}),
          ...(input.late ? { terlambat: true } : {}),
        },
        { page: offset / limit + 1, pageSize: limit },
      );
      const rows = (Array.isArray(hasil) ? hasil : hasil.items) as unknown as WoRow[];
      const total = Array.isArray(hasil) ? hasil.length : hasil.totalCount;
      const items = rows.map((wo) => ({
        id: wo.id,
        woNo: wo.docNumber,
        item: { sku: wo.finishedGood.sku, name: wo.finishedGood.nameId },
        qty: wo.plannedQty,
        status: wo.status,
        dueDate: wo.targetDate,
        url: recordUrl(ctx.baseUrl, `/backoffice/work-orders/${wo.id}`),
      }));
      return toPage(items, total, offset, limit);
    },
  }),
];

/** Module ids are written with the "@/" alias the action itself imports with, so the mock lands. */
export const parityCases: ParityCase[] = [
  {
    tool: "list_work_orders",
    kind: "action",
    actionModule: "@/app/actions/production",
    actionExport: "getWorkOrders",
    libModule: "@/lib/work-orders/queries",
    libExport: "listWorkOrders",
    args: [],
  },
];
