import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  listFieldSalesOrders: vi.fn(),
  getFieldSalesOrderById: vi.fn(),
  approveFieldSalesOrder: vi.fn(),
  rejectFieldSalesOrder: vi.fn(),
  computeStoreCreditExposure: vi.fn(),
  bacaAturanKreditDb: vi.fn(),
  batasKreditBerlaku: vi.fn(),
  lewatBatasNilai: vi.fn(),
  prismaOrderFind: vi.fn(),
  prismaStoreFind: vi.fn(),
}));
vi.mock("@/lib/field-sales/queries", () => ({
  listFieldSalesOrders: m.listFieldSalesOrders,
  getFieldSalesOrderById: m.getFieldSalesOrderById,
}));
vi.mock("@/lib/field-sales/writer", () => ({
  approveFieldSalesOrder: m.approveFieldSalesOrder,
  rejectFieldSalesOrder: m.rejectFieldSalesOrder,
}));
vi.mock("@/lib/finance/ar/credit-exposure", () => ({
  computeStoreCreditExposure: m.computeStoreCreditExposure,
}));
vi.mock("@/lib/salesman/tagihan-toko", () => ({
  bacaAturanKreditDb: m.bacaAturanKreditDb,
}));
vi.mock("@/lib/salesman/kredit", () => ({
  batasKreditBerlaku: m.batasKreditBerlaku,
  lewatBatasNilai: m.lewatBatasNilai,
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: {
      fieldSalesOrder: { findUnique: (...a: unknown[]) => m.prismaOrderFind(...a) },
      store: { findUnique: (...a: unknown[]) => m.prismaStoreFind(...a) },
    },
  };
});

import {
  __sampleInput,
  getFieldSalesOrderInput,
  parityCases,
  tools,
  writeTools,
} from "./field-sales-orders";
import {
  CreditLimitExceededError,
  InsufficientStockError,
  InvalidOrderTransitionError,
} from "@/lib/field-sales/errors";
import { KreditBelumDiperiksaError } from "@/lib/field-sales/kredit-pesanan";

const list = tools.find((t) => t.name === "list_field_sales_orders")!;
const detail = tools.find((t) => t.name === "get_field_sales_order")!;
const approve = writeTools.find((t) => t.name === "approve_field_sales_order")!;
const reject = writeTools.find((t) => t.name === "reject_field_sales_order")!;
const listSchema = z.object(list.inputShape);
const approveSchema = z.object(approve.inputShape);
const rejectSchema = z.object(reject.inputShape);
const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["field_sales_orders:view"] },
  baseUrl: "https://e.test",
};
const writeCtx: ViraToolContext = {
  actor: { id: "u-admin", name: "Admin", permissions: ["field_sales_orders:approve", "vira:write"] },
  baseUrl: "https://e.test",
};

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

function listRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    orderNo: `FSO-${id}`,
    orderType: "PUTUS",
    origin: "FIELD",
    storeName: "Toko Melati",
    salesmanName: "Budi",
    status: "APPROVED",
    total: 250000,
    createdAt: new Date("2026-11-12T02:00:00Z"),
    creditHoldAtCreate: false,
    deliveryStatus: "PARTIAL",
    remoteChannel: null,
    preorder: null,
    ...extra,
  };
}

function detailRow() {
  return {
    ...listRow("o1"),
    note: "titip ke satpam",
    subtotal: 260000,
    markupPercent: 20,
    paymentTempo: 30,
    rejectReason: null,
    cancelledByName: null,
    lines: [
      {
        id: "l1",
        itemId: "it1",
        productName: "Kaos Polos",
        variantSku: "KAOS-01-M",
        variantLabel: "M",
        qty: 5,
        unitPrice: 50000,
        lineTotal: 250000,
        available: 40,
        onHand: 50,
        outstanding: 2,
        discountAmount: 0,
        belowCost: false,
        requestedUnitPrice: null,
        appealReason: null,
      },
    ],
    deliveries: [
      {
        id: "d1",
        docNo: "NT-001",
        deliveredAt: new Date("2026-11-13T03:00:00Z"),
        invoiceDate: new Date("2026-11-13T03:00:00Z"),
        dueDate: new Date("2026-12-13T03:00:00Z"),
        subtotal: 150000,
        total: 150000,
        deliveredByName: "Andi",
        receivedByName: "Ibu Sari",
        receivedAt: new Date("2026-11-13T04:00:00Z"),
        podPhotoUrl: "https://files.example/pod/d1.jpg",
        signatureUrl: "https://files.example/sig/d1.png",
        lat: -6.9,
        lng: 107.6,
        lines: [{ id: "dl1", productName: "Kaos Polos", qty: 3 }],
        receivable: { id: "r1", invoiceNo: "INV-1" },
        taxInvoice: { status: "ISSUED", invoiceNo: "010.000-26.00000001" },
        voidedAt: null,
      },
    ],
  };
}

beforeEach(() => {
  m.listFieldSalesOrders.mockReset().mockResolvedValue({ orders: [listRow("o1")], totalCount: 1 });
  m.getFieldSalesOrderById.mockReset().mockResolvedValue(detailRow());
  m.approveFieldSalesOrder.mockReset().mockResolvedValue({ ok: true });
  m.rejectFieldSalesOrder.mockReset().mockResolvedValue({ ok: true });
  m.prismaOrderFind.mockReset().mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
    if (args?.where && "orderNo" in args.where) return { id: "o1" };
    return { storeId: "s1", kreditDitahan: false };
  });
  m.prismaStoreFind.mockReset().mockResolvedValue({ creditLimit: 1_000_000, noCreditLimit: false });
  m.bacaAturanKreditDb.mockReset().mockResolvedValue({});
  m.batasKreditBerlaku.mockReset().mockReturnValue({
    nilai: { nilai: 1_000_000, sumber: "TOKO" },
  });
  m.computeStoreCreditExposure.mockReset().mockResolvedValue({
    receivableOutstanding: 100_000,
    undeliveredOrderResidual: 0,
    openInvoiceCount: 1,
    total: 100_000,
  });
  m.lewatBatasNilai.mockReset().mockReturnValue(false);
});

describe("list_field_sales_orders", () => {
  it("input: copies the page's enums", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "AKTIF"]) {
      expect(listSchema.safeParse({ status }).success).toBe(true);
    }
    expect(listSchema.safeParse({ status: "DONE" }).success).toBe(false);
    expect(listSchema.safeParse({ orderType: "konsi" }).success).toBe(false);
    expect(listSchema.safeParse({ deliveryStatus: "OPEN", orderType: "KONSI" }).success).toBe(true);
    expect(listSchema.safeParse({ deliveryStatus: "SHIPPED" }).success).toBe(false);
    expect(listSchema.safeParse({ search: "" }).success).toBe(false);
  });

  it("passes the filters, and maps exactly the listed fields", async () => {
    const out = serialize(
      await list.handler(listSchema.parse({ search: "melati", status: "APPROVED", orderType: "PUTUS", storeId: "s1" }), ctx),
    ) as { items: unknown[] };
    expect(m.listFieldSalesOrders).toHaveBeenCalledWith(
      { search: "melati", status: "APPROVED", orderType: "PUTUS", storeId: "s1", deliveryStatus: undefined },
      { page: 1, pageSize: 20 },
    );
    expect(out.items).toEqual([
      {
        id: "o1",
        docNo: "FSO-o1",
        orderType: "PUTUS",
        status: "APPROVED",
        deliveryStatus: "PARTIAL",
        store: { id: "s1", name: "Toko Melati" },
        salesman: { name: "Budi" },
        total: 250000,
        orderDate: "2026-11-12T02:00:00.000Z",
        url: "https://e.test/backoffice/field-sales-orders/o1",
      },
    ]);
  });

  it("a deliveryStatus pins the status to APPROVED, as the page does; no storeId → store has no id", async () => {
    const out = serialize(await list.handler(listSchema.parse({ status: "REJECTED", deliveryStatus: "OPEN" }), ctx)) as {
      items: Array<{ store: unknown }>;
    };
    expect(m.listFieldSalesOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: "APPROVED", deliveryStatus: "OPEN" }),
      expect.anything(),
    );
    expect(out.items[0].store).toEqual({ name: "Toko Melati" });
  });

  it("pages with page/pageSize, and refuses an offset that is not a multiple of limit", async () => {
    m.listFieldSalesOrders.mockResolvedValue({ orders: [listRow("a")], totalCount: 11 });
    const page = (await list.handler(listSchema.parse({ limit: 5, offset: 10 }), ctx)) as Record<string, unknown>;
    expect(m.listFieldSalesOrders).toHaveBeenCalledWith(expect.anything(), { page: 3, pageSize: 5 });
    expect(page).toMatchObject({ total: 11, offset: 10, limit: 5, hasMore: false });
    await expect(list.handler(listSchema.parse({ limit: 5, offset: 7 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });
});

describe("get_field_sales_order", () => {
  it("exactly one of id / docNo", async () => {
    expect(getFieldSalesOrderInput.safeParse({ docNo: "FSO-1" }).success).toBe(true);
    expect(getFieldSalesOrderInput.safeParse({}).success).toBe(false);
    expect(getFieldSalesOrderInput.safeParse({ id: "a", docNo: "b" }).success).toBe(false);
    await expect(detail.handler({}, ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("returns exactly the listed fields", async () => {
    expect(serialize(await detail.handler({ id: "o1" }, ctx))).toEqual({
      id: "o1",
      docNo: "FSO-o1",
      orderType: "PUTUS",
      status: "APPROVED",
      deliveryStatus: "PARTIAL",
      orderDate: "2026-11-12T02:00:00.000Z",
      store: { name: "Toko Melati" },
      salesman: { name: "Budi" },
      lines: [{ sku: "KAOS-01-M", name: "Kaos Polos", qty: 5, price: 50000, subtotal: 250000 }],
      deliveries: [{ id: "d1", docNo: "NT-001", date: "2026-11-13T03:00:00.000Z" }],
      total: 250000,
      url: "https://e.test/backoffice/field-sales-orders/o1",
    });
  });

  it("delivery photo, GPS, signature and receiver fields never appear", async () => {
    const out = serialize(await detail.handler({ id: "o1" }, ctx));
    const json = JSON.stringify(out);
    expect(json).not.toContain("files.example");
    expect(json).not.toContain("Ibu Sari");
    expect(json).not.toContain("-6.9");
    const keys = allKeys(out);
    for (const banned of ["podPhotoUrl", "signatureUrl", "lat", "lng", "receivedByName", "deliveredByName", "receivable", "taxInvoice", "note", "markupPercent", "available", "onHand"]) {
      expect(keys.has(banned), banned).toBe(false);
    }
  });

  it("finds by exact docNo; a partial match → Order not found", async () => {
    m.listFieldSalesOrders.mockResolvedValue({ orders: [listRow("o2", { orderNo: "FSO-o1-X" }), listRow("o1")], totalCount: 2 });
    await detail.handler({ docNo: "FSO-o1" }, ctx);
    expect(m.listFieldSalesOrders).toHaveBeenCalledWith({ search: "FSO-o1" }, { page: 1, pageSize: 50 });
    expect(m.getFieldSalesOrderById).toHaveBeenCalledWith("o1");

    m.listFieldSalesOrders.mockResolvedValue({ orders: [listRow("o2", { orderNo: "FSO-o1-X" })], totalCount: 1 });
    await expect(detail.handler({ docNo: "FSO-o1" }, ctx)).rejects.toEqual(new ViraNotFoundError("Order not found"));
  });

  it("unknown id → Order not found", async () => {
    m.getFieldSalesOrderById.mockResolvedValue(null);
    await expect(detail.handler({ id: "x" }, ctx)).rejects.toEqual(new ViraNotFoundError("Order not found"));
  });

  it("a KONSI order not yet approved carries no money, as the UI hides it; approved KONSI and PUTUS do", async () => {
    for (const status of ["PENDING_APPROVAL", "REJECTED", "CANCELLED"]) {
      m.listFieldSalesOrders.mockResolvedValue({
        orders: [listRow("k1", { orderType: "KONSI", status, total: 0 })],
        totalCount: 1,
      });
      const l = serialize(await list.handler(listSchema.parse({}), ctx)) as { items: { total: unknown }[] };
      expect(l.items[0].total).toBeNull();

      m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), orderType: "KONSI", status, total: 0 });
      const d = serialize(await detail.handler({ id: "o1" }, ctx)) as {
        total: unknown;
        lines: { price: unknown; subtotal: unknown }[];
      };
      expect(d.total).toBeNull();
      expect(d.lines).toEqual([expect.objectContaining({ price: null, subtotal: null, qty: 5 })]);
    }

    m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), orderType: "KONSI", status: "APPROVED" });
    const approved = serialize(await detail.handler({ id: "o1" }, ctx)) as {
      total: unknown;
      lines: { price: unknown; subtotal: unknown }[];
    };
    expect(approved.total).toBe(250000);
    expect(approved.lines[0]).toMatchObject({ price: 50000, subtotal: 250000 });

    m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), status: "PENDING_APPROVAL" });
    const putus = serialize(await detail.handler({ id: "o1" }, ctx)) as { total: unknown };
    expect(putus.total).toBe(250000);
  });

  it("both tools are gated on field_sales_orders:view with a route parity case each", () => {
    expect(list.gate).toEqual({ kind: "code", code: "field_sales_orders:view" });
    expect(detail.gate).toEqual({ kind: "code", code: "field_sales_orders:view" });
    expect(parityCases.filter((c) => c.kind === "route").map((c) => c.tool)).toEqual([
      "list_field_sales_orders",
      "get_field_sales_order",
    ]);
  });
});

describe("approve_field_sales_order / reject_field_sales_order", () => {
  beforeEach(() => {
    m.getFieldSalesOrderById.mockResolvedValue({
      ...detailRow(),
      status: "PENDING_APPROVAL",
      orderNo: "SO-1",
    });
  });

  it("gates, destructive flags, sample inputs, and writeAction parity cases", () => {
    expect(approve.gate).toEqual({ kind: "code", code: "field_sales_orders:approve" });
    expect(reject.gate).toEqual({ kind: "code", code: "field_sales_orders:approve" });
    expect(approve.destructive).toBe(false);
    expect(reject.destructive).toBe(true);
    expect(__sampleInput).toEqual({
      approve_field_sales_order: { order: "SO-1" },
      reject_field_sales_order: { order: "SO-1", reason: "x" },
    });
    expect(approve.__sampleInput).toEqual({ order: "SO-1" });
    expect(reject.__sampleInput).toEqual({ order: "SO-1", reason: "x" });
    const writes = parityCases.filter((c) => c.kind === "writeAction");
    expect(writes).toEqual([
      expect.objectContaining({
        tool: "approve_field_sales_order",
        actionExport: "approveFieldSalesOrderAction",
        writerExport: "approveFieldSalesOrder",
        args: ["order-1"],
      }),
      expect.objectContaining({
        tool: "reject_field_sales_order",
        actionExport: "rejectFieldSalesOrderAction",
        writerExport: "rejectFieldSalesOrder",
        args: ["order-1", "alasan"],
      }),
    ]);
  });

  it("reject reason blank fails the schema (REASON_REQUIRED)", () => {
    expect(rejectSchema.safeParse({ order: "SO-1", reason: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ order: "SO-1", reason: "" }).success).toBe(false);
  });

  it("prepare approve: pending + credit preview; revalidate paths", async () => {
    const prepared = await approve.prepare(approveSchema.parse({ order: "SO-1" }), writeCtx);
    expect(prepared.args).toEqual({ orderId: "o1" });
    expect(prepared.preview.title).toBe("Setujui pesanan SO-1");
    expect(prepared.preview.confirmLabel).toBe("Setujui");
    expect(prepared.preview.cancelLabel).toBe("Batal");
    expect(prepared.preview.details.find((d) => d.label === "Status kredit")?.value).toBe("Aman");
    expect(approve.revalidate(prepared.args, { ok: true, message: "", url: "", entityType: "", entityId: "" })).toEqual([
      "/backoffice/field-sales-orders",
      "/backoffice/field-sales-orders/o1",
    ]);
  });

  it("over-limit order → prepare throws ViraInputError with the order URL", async () => {
    m.lewatBatasNilai.mockReturnValue(true);
    await expect(approve.prepare(approveSchema.parse({ order: "o1" }), writeCtx)).rejects.toEqual(
      new ViraInputError(
        "Toko melewati batas kredit. Buka pesanan di Elorae untuk persetujuan dengan alasan: https://e.test/backoffice/field-sales-orders/o1",
      ),
    );
  });

  it("wrong status → ViraInputError; unknown order → Pesanan tidak ditemukan", async () => {
    m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), status: "APPROVED", orderNo: "SO-9" });
    await expect(approve.prepare(approveSchema.parse({ order: "o1" }), writeCtx)).rejects.toEqual(
      new ViraInputError("Pesanan SO-9 berstatus APPROVED, tidak bisa disetujui."),
    );
    m.getFieldSalesOrderById.mockResolvedValue(null);
    m.prismaOrderFind.mockResolvedValue(null);
    await expect(approve.prepare(approveSchema.parse({ order: "missing" }), writeCtx)).rejects.toEqual(
      new ViraNotFoundError("Pesanan tidak ditemukan"),
    );
  });

  it("price appeal or kreditDitahan → prepare refuses with Elorae URL", async () => {
    m.getFieldSalesOrderById.mockResolvedValue({
      ...detailRow(),
      status: "PENDING_APPROVAL",
      orderNo: "SO-1",
      lines: [{ ...detailRow().lines[0], requestedUnitPrice: 55_000 }],
    });
    await expect(approve.prepare(approveSchema.parse({ order: "o1" }), writeCtx)).rejects.toEqual(
      new ViraInputError(
        "Pesanan punya ajuan harga. Buka pesanan di Elorae untuk menetapkan harga final: https://e.test/backoffice/field-sales-orders/o1",
      ),
    );

    m.getFieldSalesOrderById.mockResolvedValue({
      ...detailRow(),
      status: "PENDING_APPROVAL",
      orderNo: "SO-1",
    });
    m.prismaOrderFind.mockResolvedValue({ kreditDitahan: true });
    await expect(approve.prepare(approveSchema.parse({ order: "o1" }), writeCtx)).rejects.toEqual(
      new ViraInputError(
        "Kredit pesanan ditahan. Buka pesanan di Elorae untuk memeriksa dan menyetujui: https://e.test/backoffice/field-sales-orders/o1",
      ),
    );
  });

  it("approve execute passes kreditDiperiksa: true and never finalPrices/addedLines/creditOverrideReason", async () => {
    m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), orderNo: "SO-1", status: "APPROVED" });
    const res = await approve.execute({ orderId: "o1" }, writeCtx);
    expect(m.approveFieldSalesOrder).toHaveBeenCalledWith({
      orderId: "o1",
      approvedById: "u-admin",
      kreditDiperiksa: true,
    });
    const call = m.approveFieldSalesOrder.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("finalPrices");
    expect(call).not.toHaveProperty("addedLines");
    expect(call).not.toHaveProperty("creditOverrideReason");
    expect(res).toEqual({
      ok: true,
      message: "Pesanan SO-1 disetujui.",
      url: "https://e.test/backoffice/field-sales-orders/o1",
      entityType: "FieldSalesOrder",
      entityId: "o1",
    });
  });

  it("approve execute maps writer errors like the action", async () => {
    m.approveFieldSalesOrder.mockRejectedValueOnce(
      new CreditLimitExceededError(
        { receivableOutstanding: 1, undeliveredOrderResidual: 0, total: 1 },
        0,
        1,
      ),
    );
    expect(await approve.execute({ orderId: "o1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "CREDIT_LIMIT_EXCEEDED",
    });

    m.approveFieldSalesOrder.mockRejectedValueOnce(new KreditBelumDiperiksaError("o1"));
    expect(await approve.execute({ orderId: "o1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "KREDIT_BELUM_DIPERIKSA",
    });

    m.approveFieldSalesOrder.mockRejectedValueOnce(
      new InsufficientStockError([{ itemId: "i1", variantSku: "SKU-A", available: 0 }]),
    );
    expect(await approve.execute({ orderId: "o1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: expect.stringContaining("SKU-A"),
    });

    m.approveFieldSalesOrder.mockRejectedValueOnce(new InvalidOrderTransitionError("MISSING", "APPROVED"));
    expect(await approve.execute({ orderId: "o1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    m.approveFieldSalesOrder.mockRejectedValueOnce(
      new InvalidOrderTransitionError("APPROVED", "APPROVED"),
    );
    expect(await approve.execute({ orderId: "o1" }, writeCtx)).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("reject prepare + execute", async () => {
    const prepared = await reject.prepare(
      rejectSchema.parse({ order: "o1", reason: "  stok habis  " }),
      writeCtx,
    );
    expect(prepared.args).toEqual({ orderId: "o1", reason: "stok habis" });
    expect(prepared.preview.title).toBe("Tolak pesanan SO-1");
    expect(prepared.preview.confirmLabel).toBe("Tolak");
    expect(prepared.preview.destructive).toBe(true);

    m.getFieldSalesOrderById.mockResolvedValue({ ...detailRow(), orderNo: "SO-1", status: "REJECTED" });
    const res = await reject.execute(prepared.args, writeCtx);
    expect(m.rejectFieldSalesOrder).toHaveBeenCalledWith({
      orderId: "o1",
      rejectedById: "u-admin",
      reason: "stok habis",
    });
    expect(res).toEqual({
      ok: true,
      message: "Pesanan SO-1 ditolak.",
      url: "https://e.test/backoffice/field-sales-orders/o1",
      entityType: "FieldSalesOrder",
      entityId: "o1",
    });
  });
});
