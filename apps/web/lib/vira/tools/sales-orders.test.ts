import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ listSalesOrders: vi.fn(), getSalesOrderById: vi.fn() }));
vi.mock("@/lib/sales-orders/queries", () => ({
  listSalesOrders: m.listSalesOrders,
  getSalesOrderById: m.getSalesOrderById,
}));

import { getMarketplaceOrderInput, parityCases, stripBuyerPii, tools } from "./sales-orders";

const list = tools.find((t) => t.name === "list_marketplace_orders")!;
const detail = tools.find((t) => t.name === "get_marketplace_order")!;
const listSchema = z.object(list.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["sales_orders:view"] }, baseUrl: "https://e.test" };

const PII = ["0812-3456-7890", "budi@example.com", "Jl. Melati No. 7", "RT 02/RW 03"];

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
    salesorderNo: `SO-${id}`,
    channel: "SHOPEE",
    status: "SHIPPED",
    customerName: "Budi",
    trackingNumber: "JNE123",
    grandTotal: "150000.00",
    transactionDate: new Date("2026-11-10T05:00:00Z"),
    // Not in the real list select, but the rule must hold if it ever is.
    customerPhone: PII[0],
    ...extra,
  };
}

function detailRow(id = "o1") {
  return {
    order: {
      id,
      salesorderId: 99,
      salesorderNo: "SO-o1",
      channel: "TOKOPEDIA",
      sourceName: "Tokopedia",
      status: "SHIPPED",
      customerName: "Budi",
      customerPhone: PII[0],
      customerEmail: PII[1],
      shippingProvince: "Jawa Barat",
      shippingCity: "Bandung",
      shippingAddress: { address: PII[2], line2: PII[3], postalCode: "40111" },
      subTotal: "140000.00",
      shippingCost: "10000.00",
      grandTotal: "150000.00",
      feeBreakdown: { admin: "5000" },
      paymentMethod: "COD",
      transactionDate: new Date("2026-11-10T05:00:00Z"),
      trackingNumber: "JNE123",
      courier: "jne",
      courierName: "JNE Reguler",
      fulfillmentStatus: "SHIPPED",
      pickedByName: "Andi",
      revenueJournalId: "j1",
      packingVideoUrl: "https://video",
    },
    items: [
      {
        id: "l1",
        jubelioItemCode: "KAOS-01-M",
        productName: "Kaos Polos M",
        qty: "2.00",
        unitPrice: "70000.00",
        pricePaid: "65000.00",
        lineTotal: "140000.00",
        discMarketplace: "0",
        weightInGram: "200",
      },
    ],
  };
}

beforeEach(() => {
  m.listSalesOrders.mockReset().mockResolvedValue({ orders: [listRow("o1")], totalCount: 1 });
  m.getSalesOrderById.mockReset().mockResolvedValue(detailRow());
});

describe("stripBuyerPii", () => {
  it("removes phone, email and address keys at every depth and keeps city/province/postal code", () => {
    const out = stripBuyerPii({
      customerName: "Budi",
      customerPhone: PII[0],
      customerEmail: PII[1],
      shippingAddress: { street: PII[2] },
      shippingCity: "Bandung",
      shippingProvince: "Jawa Barat",
      postalCode: "40111",
      nested: [{ buyerPhoneNumber: PII[0], emailAddress: PII[1], ok: 1 }],
      when: new Date("2026-01-01T00:00:00Z"),
    });
    const json = JSON.stringify(out);
    for (const p of PII) expect(json).not.toContain(p);
    expect(out).toEqual({
      customerName: "Budi",
      shippingCity: "Bandung",
      shippingProvince: "Jawa Barat",
      postalCode: "40111",
      nested: [{ ok: 1 }],
      when: new Date("2026-01-01T00:00:00Z"),
    });
  });
});

describe("list_marketplace_orders", () => {
  it("input: copies the status/channel enums, YYYY-MM-DD dates, 1–100 search", () => {
    expect(listSchema.safeParse({ status: "RETURNED", channel: "TIKTOK" }).success).toBe(true);
    expect(listSchema.safeParse({ status: "PAID" }).success).toBe(false);
    expect(listSchema.safeParse({ channel: "LAZADA" }).success).toBe(false);
    expect(listSchema.safeParse({ dateFrom: "10/11/2026" }).success).toBe(false);
    expect(listSchema.safeParse({ search: "" }).success).toBe(false);
    expect(listSchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });

  it("passes filters with the page's WIB date parsing, and maps exactly the listed fields", async () => {
    const out = serialize(
      await list.handler(
        listSchema.parse({ search: "budi", status: "SHIPPED", channel: "SHOPEE", dateFrom: "2026-11-01", dateTo: "2026-11-15" }),
        ctx,
      ),
    ) as { items: unknown[] };
    expect(m.listSalesOrders).toHaveBeenCalledWith(
      {
        search: "budi",
        status: "SHIPPED",
        channel: "SHOPEE",
        dateFrom: parseDateOnly("2026-11-01"),
        dateTo: parseDateOnlyEnd("2026-11-15"),
      },
      { page: 1, pageSize: 20 },
    );
    expect(out.items).toEqual([
      {
        id: "o1",
        salesorderNo: "SO-o1",
        channel: "SHOPEE",
        status: "SHIPPED",
        customerName: "Budi",
        total: 150000,
        orderDate: "2026-11-10T05:00:00.000Z",
        url: "https://e.test/backoffice/sales-orders/o1",
      },
    ]);
    expect(JSON.stringify(out)).not.toContain(PII[0]);
  });

  it("dateFrom after dateTo → ViraInputError, before any read", async () => {
    await expect(
      list.handler(listSchema.parse({ dateFrom: "2026-11-16", dateTo: "2026-11-01" }), ctx),
    ).rejects.toBeInstanceOf(ViraInputError);
    await expect(list.handler(listSchema.parse({ dateFrom: "2026-13-40" }), ctx)).rejects.toBeInstanceOf(ViraInputError);
    expect(m.listSalesOrders).not.toHaveBeenCalled();
  });

  it("pages with page/pageSize, and refuses an offset that is not a multiple of limit", async () => {
    m.listSalesOrders.mockResolvedValue({ orders: [listRow("a"), listRow("b")], totalCount: 9 });
    const page = (await list.handler(listSchema.parse({ limit: 2, offset: 6 }), ctx)) as Record<string, unknown>;
    expect(m.listSalesOrders).toHaveBeenCalledWith(expect.anything(), { page: 4, pageSize: 2 });
    expect(page).toMatchObject({ total: 9, offset: 6, limit: 2, hasMore: true });
    await expect(list.handler(listSchema.parse({ limit: 2, offset: 3 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });
});

describe("get_marketplace_order", () => {
  it("exactly one of id / salesorderNo", async () => {
    expect(getMarketplaceOrderInput.safeParse({ id: "o1" }).success).toBe(true);
    expect(getMarketplaceOrderInput.safeParse({}).success).toBe(false);
    expect(getMarketplaceOrderInput.safeParse({ id: "o1", salesorderNo: "SO-o1" }).success).toBe(false);
    await expect(detail.handler({}, ctx)).rejects.toBeInstanceOf(ViraInputError);
    await expect(detail.handler({ id: "o1", salesorderNo: "SO-o1" }, ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("returns exactly the listed fields and never the buyer's phone, email or street address", async () => {
    const out = serialize(await detail.handler({ id: "o1" }, ctx));
    expect(out).toEqual({
      id: "o1",
      salesorderNo: "SO-o1",
      channel: "TOKOPEDIA",
      status: "SHIPPED",
      fulfilmentStatus: "SHIPPED",
      orderDate: "2026-11-10T05:00:00.000Z",
      customerName: "Budi",
      shippingCity: "Bandung",
      shippingProvince: "Jawa Barat",
      courier: "JNE Reguler",
      trackingNo: "JNE123",
      lines: [{ sku: "KAOS-01-M", name: "Kaos Polos M", qty: 2, price: 70000, subtotal: 140000 }],
      total: 150000,
      url: "https://e.test/backoffice/sales-orders/o1",
    });
    const json = JSON.stringify(out);
    for (const p of PII) expect(json).not.toContain(p);
    const keys = allKeys(out);
    for (const banned of ["customerPhone", "customerEmail", "shippingAddress", "feeBreakdown", "paymentMethod", "pickedByName", "revenueJournalId", "packingVideoUrl"]) {
      expect(keys.has(banned), banned).toBe(false);
    }
  });

  it("finds by exact salesorderNo", async () => {
    m.listSalesOrders.mockResolvedValue({ orders: [listRow("o2", { salesorderNo: "SO-o1-B" }), listRow("o1")], totalCount: 2 });
    await detail.handler({ salesorderNo: "SO-o1" }, ctx);
    expect(m.listSalesOrders).toHaveBeenCalledWith({ search: "SO-o1" }, { page: 1, pageSize: 50 });
    expect(m.getSalesOrderById).toHaveBeenCalledWith("o1");
  });

  it("a partial salesorderNo match → Order not found", async () => {
    m.listSalesOrders.mockResolvedValue({ orders: [listRow("o1", { salesorderNo: "SO-o1-LONGER" })], totalCount: 1 });
    await expect(detail.handler({ salesorderNo: "SO-o1" }, ctx)).rejects.toEqual(new ViraNotFoundError("Order not found"));
    expect(m.getSalesOrderById).not.toHaveBeenCalled();
  });

  it("unknown id → Order not found", async () => {
    m.getSalesOrderById.mockResolvedValue(null);
    await expect(detail.handler({ id: "nope" }, ctx)).rejects.toEqual(new ViraNotFoundError("Order not found"));
  });

  it("falls back to the raw courier code when there is no courier name", async () => {
    const d = detailRow();
    m.getSalesOrderById.mockResolvedValue({ ...d, order: { ...d.order, courierName: null } });
    expect(((await detail.handler({ id: "o1" }, ctx)) as { courier: string }).courier).toBe("jne");
  });
});

describe("registry entries", () => {
  it("both tools are gated on sales_orders:view with a route parity case each", () => {
    expect(list.gate).toEqual({ kind: "code", code: "sales_orders:view" });
    expect(detail.gate).toEqual({ kind: "code", code: "sales_orders:view" });
    expect(parityCases.map((c) => c.tool)).toEqual(["list_marketplace_orders", "get_marketplace_order"]);
  });
});
