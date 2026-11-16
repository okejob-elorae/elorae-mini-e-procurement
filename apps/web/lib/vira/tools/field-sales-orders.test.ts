import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ listFieldSalesOrders: vi.fn(), getFieldSalesOrderById: vi.fn() }));
vi.mock("@/lib/field-sales/queries", () => ({
  listFieldSalesOrders: m.listFieldSalesOrders,
  getFieldSalesOrderById: m.getFieldSalesOrderById,
}));

import { getFieldSalesOrderInput, parityCases, tools } from "./field-sales-orders";

const list = tools.find((t) => t.name === "list_field_sales_orders")!;
const detail = tools.find((t) => t.name === "get_field_sales_order")!;
const listSchema = z.object(list.inputShape);
const ctx: ViraToolContext = {
  actor: { id: "u1", name: "Uji", permissions: ["field_sales_orders:view"] },
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
    expect(parityCases.map((c) => c.tool)).toEqual(["list_field_sales_orders", "get_field_sales_order"]);
  });
});
