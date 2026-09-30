import { describe, it, expect } from "vitest";
import { getNotificationHref } from "./navigation";

describe("getNotificationHref — konsi count schedule and report categories", () => {
  it("opens the stocktake a count notification names, in the backoffice", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "st1" })).toBe("/backoffice/store-stocktakes/st1");
  });

  it("falls back to the store when an overdue alert names no open stocktake, and to the register when it names nothing", () => {
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", { storeId: "s1", stocktakeId: "" })).toBe("/backoffice/stores/s1");
    expect(getNotificationHref("KONSI_COUNT_OVERDUE", {})).toBe("/backoffice/store-stocktakes");
  });

  it("sends the SPG to the PWA count screen", () => {
    expect(getNotificationHref("KONSI_COUNT_DUE", { storeId: "s1", stocktakeId: "st1" }, "pwa")).toBe("/pwa/spg/stocktake");
  });

  it("opens the auto-created report for READY and HELD", () => {
    expect(getNotificationHref("KONSI_REPORT_READY", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_HELD", { sellThroughId: "slt1" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(getNotificationHref("KONSI_REPORT_READY", {})).toBe("/backoffice/konsi-sell-through");
  });

  it("opens the closing stocktake for BLOCKED, where the refusal and the create button live", () => {
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", { stocktakeId: "st1", code: "DRAFT_EXISTS" })).toBe("/backoffice/store-stocktakes/st1");
    expect(getNotificationHref("KONSI_REPORT_BLOCKED", {})).toBe("/backoffice/store-stocktakes");
  });
});

describe("getNotificationHref — order approval and store change", () => {
  it("opens the order awaiting approval, else the register", () => {
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", { orderId: "o1" })).toBe("/backoffice/field-sales-orders/o1");
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", {})).toBe("/backoffice/field-sales-orders");
    expect(getNotificationHref("PENDING_ORDER_APPROVAL", { orderId: "" })).toBe("/backoffice/field-sales-orders");
  });

  it("opens the store a change request names, else the store list", () => {
    expect(getNotificationHref("STORE_CHANGE_REQUEST", { storeId: "s1" })).toBe("/backoffice/stores/s1");
    expect(getNotificationHref("STORE_CHANGE_REQUEST", {})).toBe("/backoffice/stores");
    expect(getNotificationHref("STORE_CHANGE_REQUEST", { storeId: "" })).toBe("/backoffice/stores");
  });
});

describe("getNotificationHref — JOURNAL_PENDING", () => {
  const fallback = "/backoffice/finance/journals";
  const href = (data: Record<string, unknown>) => getNotificationHref("JOURNAL_PENDING", data);

  it("opens the sales order for a sales sweep failure", () => {
    expect(href({ orderId: "o1", kind: "revenue" })).toBe("/backoffice/sales-orders/o1");
    expect(href({ orderId: "o1", kind: "cogs" })).toBe("/backoffice/sales-orders/o1");
  });

  it("opens the sales return, not an order, when the metadata carries salesReturnId", () => {
    expect(href({ salesReturnId: "r1", kind: "revenue" })).toBe("/backoffice/returns/r1");
    expect(href({ salesReturnId: "r1", kind: "cogs" })).toBe("/backoffice/returns/r1");
  });

  it("opens the opname, which carries no kind", () => {
    expect(href({ opnameId: "op1" })).toBe("/backoffice/inventory/stock-opname/op1");
  });

  it("opens the work order for an fg_receipt", () => {
    expect(href({ woId: "w1", receiptId: "rc1", kind: "fg_receipt" })).toBe("/backoffice/work-orders/w1");
  });

  it("opens the GRN tab for receipt and reversal", () => {
    expect(href({ grnId: "g1", kind: "receipt" })).toBe("/backoffice/inventory?tab=grn");
    expect(href({ grnId: "g1", kind: "reversal" })).toBe("/backoffice/inventory?tab=grn");
  });

  it("opens the purchase order for supplier payment kinds", () => {
    expect(href({ docId: "po1", kind: "supplier_payment" })).toBe("/backoffice/purchase-orders/po1");
    expect(href({ docId: "po1", kind: "supplier_payment_reversal" })).toBe("/backoffice/purchase-orders/po1");
  });

  it("opens the payment for ar_payment kinds", () => {
    expect(href({ docId: "p1", kind: "ar_payment" })).toBe("/backoffice/finance/payments/p1");
    expect(href({ docId: "p1", kind: "ar_payment_void" })).toBe("/backoffice/finance/payments/p1");
  });

  it("opens the sell-through report for every konsi kind", () => {
    expect(href({ docId: "slt1", kind: "konsi_sell_through_revenue" })).toBe("/backoffice/konsi-sell-through/slt1");
    expect(href({ docId: "slt1", kind: "konsi_sell_through_shrinkage_void" })).toBe("/backoffice/konsi-sell-through/slt1");
  });

  it("opens the receivable for a field delivery when it is known, else the register", () => {
    expect(href({ docId: "d1", kind: "field_delivery_revenue", receivableId: "rv1" })).toBe("/backoffice/finance/piutang/rv1");
    expect(href({ docId: "d1", kind: "field_delivery_cogs", receivableId: "rv1" })).toBe("/backoffice/finance/piutang/rv1");
    expect(href({ docId: "d1", kind: "field_delivery_revenue" })).toBe("/backoffice/finance/piutang");
    expect(href({ docId: "d1", kind: "field_delivery_revenue", receivableId: "" })).toBe("/backoffice/finance/piutang");
  });

  it("opens the van sale and the van reconcile", () => {
    expect(href({ docId: "vs1", kind: "van_sale" })).toBe("/backoffice/van-sales/vs1");
    expect(href({ docId: "vr1", kind: "van_reconcile" })).toBe("/backoffice/canvassing/reconcile/vr1");
  });

  it("opens the canvasser for a van_load when known, else the canvassing list", () => {
    expect(href({ docId: "vl1", kind: "van_load", canvasserId: "c1" })).toBe("/backoffice/canvassing/c1");
    expect(href({ docId: "vl1", kind: "van_load" })).toBe("/backoffice/canvassing");
  });

  it("falls back to the journal register for an unknown kind or a missing id", () => {
    expect(href({ docId: "x1", kind: "something_new" })).toBe(fallback);
    expect(href({})).toBe(fallback);
    expect(href({ kind: "van_sale" })).toBe(fallback);
    expect(href({ docId: "", kind: "ar_payment" })).toBe(fallback);
    expect(href({ orderId: "", kind: "revenue" })).toBe(fallback);
    expect(href({ grnId: "", kind: "receipt" })).toBe(fallback);
  });
});
