import { z } from "zod";
import { prisma } from "@elorae/db";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { getActorName } from "@/lib/notifications/actor-name";
import { notifyPOStatusUpdated } from "@/lib/notifications/events";
import { STATUS_PO_BISA_TERLAMBAT } from "@/lib/purchase-orders/overdue";
import { getPOById, listPOs } from "@/lib/purchase-orders/queries";
import { PESAN_TOLAK_TUTUP_PO, tutupPurchaseOrder } from "@/lib/purchase-orders/tutup";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraTool,
  type ViraToolContext,
  type ViraWriteTool,
} from "./types";

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

function formatRp(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
}

type PoDetail = PoRow & { items: Array<{ qty?: unknown; receivedQty?: unknown }> };

/** Map `getPOById` / serializePODetail into the close-tool row (dates already ISO). */
function mapPoDetail(byId: NonNullable<Awaited<ReturnType<typeof getPOById>>>): PoDetail {
  const nama =
    byId.supplier && typeof byId.supplier === "object" && "name" in byId.supplier
      ? String((byId.supplier as { name?: unknown }).name ?? "—")
      : "—";
  return {
    id: byId.id,
    docNumber: byId.docNumber,
    supplierId: byId.supplierId,
    supplier: { name: nama },
    status: byId.status,
    createdAt: byId.createdAt ?? null,
    etaDate: byId.etaDate ?? null,
    grandTotal: Number(byId.grandTotal ?? 0),
    items: byId.items ?? [],
  };
}

/** Resolve PO id or unique docNumber — one detail fetch (FSO-style exact lookup). */
async function resolvePoDetail(po: string): Promise<PoDetail> {
  const byId = await getPOById(po);
  if (byId) return mapPoDetail(byId);
  const byDoc = await prisma.purchaseOrder.findUnique({
    where: { docNumber: po },
    select: { id: true },
  });
  if (!byDoc) throw new ViraNotFoundError("PO tidak ditemukan");
  const detail = await getPOById(byDoc.id);
  if (!detail) throw new ViraNotFoundError("PO tidak ditemukan");
  return mapPoDetail(detail);
}

type CloseArgs = { poId: string; reason: string };

/**
 * Mirrors `tutupPO` in `app/actions/purchase-orders.ts` (~L552–572) and
 * `tutupPurchaseOrder` in `lib/purchase-orders/tutup.ts`.
 */
const closePurchaseOrderTool = defineWriteTool({
  kind: "write",
  name: "close_purchase_order",
  title: "Close purchase order",
  description:
    "Prepares closing a purchase order (no more goods expected) with a reason. The user must press the confirm button.",
  gate: { kind: "code", code: "purchase_orders:approve" },
  destructive: true,
  inputShape: {
    po: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("The purchase order id or PO number."),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Why the PO is closed early."),
  },
  argsSchema: z.object({
    poId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  }),
  __sampleInput: { po: "PO-1", reason: "x" },
  prepare: async (input, ctx) => {
    const row = await resolvePoDetail(input.po);
    // Writer refuses DRAFT / CANCELLED / CLOSED / OVER (`tutup.ts`).
    if (["DRAFT", "CANCELLED", "CLOSED", "OVER"].includes(row.status)) {
      throw new ViraInputError(`PO ${row.docNumber} berstatus ${row.status}, tidak bisa ditutup.`);
    }
    const items = row.items;
    const received = items.reduce(
      (n: number, it: { receivedQty?: unknown }) => n + Number(it.receivedQty ?? 0),
      0,
    );
    // Mirror writer refusals in prepare so confirm is never offered for dead ends (`tutup.ts`).
    if (received === 0) {
      throw new ViraInputError(PESAN_TOLAK_TUTUP_PO.BELUM_ADA_PENERIMAAN);
    }
    const sisa = items.filter(
      (it: { qty?: unknown; receivedQty?: unknown }) =>
        Number(it.qty ?? 0) - Number(it.receivedQty ?? 0) > 0,
    );
    if (items.length > 0 && sisa.length === 0) {
      throw new ViraInputError(PESAN_TOLAK_TUTUP_PO.SUDAH_LENGKAP);
    }
    // Same gate as `tutupPurchaseOrder` (~L93–96).
    const grnMenunggu = await prisma.gRN.count({
      where: {
        poId: row.id,
        requiresOwnerApproval: true,
        ownerApprovedAt: null,
        ownerDeclinedAt: null,
      },
    });
    if (grnMenunggu > 0) {
      throw new ViraInputError(PESAN_TOLAK_TUTUP_PO.GRN_MENUNGGU_PEMILIK);
    }
    const url = recordUrl(ctx.baseUrl, `/backoffice/purchase-orders/${row.id}`);
    return {
      preview: {
        title: `Tutup PO ${row.docNumber}`,
        summary: `${row.supplier.name} · ${row.status} · ${formatRp(row.grandTotal)}`,
        details: [
          { label: "Pemasok", value: row.supplier.name },
          { label: "Status", value: row.status },
          { label: "Total", value: formatRp(row.grandTotal) },
          { label: "Sudah diterima", value: String(received) },
          { label: "Alasan", value: input.reason },
        ],
        confirmLabel: "Tutup PO",
        cancelLabel: "Batal",
        destructive: true,
        target: { type: "purchase_order", id: row.id, url },
      },
      args: { poId: row.id, reason: input.reason },
    };
  },
  execute: async (args, ctx) => {
    const url = recordUrl(ctx.baseUrl, `/backoffice/purchase-orders/${args.poId}`);
    // Mirror `tutupPO` try/catch → GAGAL so confirm does not burn jti as INTERNAL.
    let hasil;
    try {
      hasil = await tutupPurchaseOrder({
        poId: args.poId,
        userId: ctx.actor.id,
        alasan: args.reason,
      });
    } catch {
      return { ok: false, code: "GAGAL", message: "Gagal menyimpan. Coba lagi.", url };
    }
    if (!hasil.ok) {
      // PESAN_TOLAK_TUTUP_PO from lib/purchase-orders/tutup.ts (~L34–43).
      return {
        ok: false,
        code: hasil.code,
        message: PESAN_TOLAK_TUTUP_PO[hasil.code] ?? hasil.code,
        url,
      };
    }
    return {
      ok: true,
      message: `PO ${hasil.docNumber} ditutup.`,
      url,
      entityType: "PurchaseOrder",
      entityId: args.poId,
      extra: { docNumber: hasil.docNumber, statusSebelum: hasil.statusSebelum },
    };
  },
  revalidate: (args) => ["/backoffice/purchase-orders", `/backoffice/purchase-orders/${args.poId}`],
  // Action private `kabariPoDitutup` ~L528–532.
  afterSuccess: async (args, result, ctx) => {
    try {
      const name = await getActorName(ctx.actor.id);
      await notifyPOStatusUpdated(
        args.poId,
        result.extra!.docNumber,
        result.extra!.statusSebelum,
        "CLOSED",
        name,
      );
    } catch {
      /* never throw from afterSuccess */
    }
  },
});

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

export const writeTools: ViraWriteTool[] = [closePurchaseOrderTool];

export const __sampleInput = {
  close_purchase_order: { po: "PO-1", reason: "x" },
};

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
  {
    tool: "close_purchase_order",
    kind: "writeAction",
    actionModule: "@/app/actions/purchase-orders",
    actionExport: "tutupPO",
    writerModule: "@/lib/purchase-orders/tutup",
    writerExport: "tutupPurchaseOrder",
    args: ["po-1", "alasan"],
  },
];
