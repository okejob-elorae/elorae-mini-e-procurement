import { describe, expect, it } from "vitest";
import { vanSaleNotaHtml } from "./van-sale-nota-html";
import { spgSaleNotaHtml } from "./spg-sale-nota-html";
import type { VanSaleDetail } from "@/lib/canvassing/sale-queries";
import type { SpgSaleDetail } from "@/lib/spg/sale-queries";

function van(subtotal: number, total: number): VanSaleDetail {
  return {
    id: "v1", docNo: "VAN-1", salesmanLabel: "Budi", storeName: null, buyerName: "Ani", buyerPhone: null,
    saleLat: null, saleLng: null, subtotal, total, amountPaid: 30000, changeAmount: 0,
    note: null, createdAtIso: "2026-10-01T03:00:00.000Z",
    lines: [{ productName: "Kaos", variantSku: "K-M", qty: 1, unitPrice: subtotal, unitCost: 0, lineTotal: subtotal }],
    journalId: null, hasPostableJournal: false,
  };
}

function spg(subtotal: number, total: number): SpgSaleDetail {
  return {
    id: "s1", docNo: "SPG-1", salesmanLabel: "Sari", storeName: "Toko A", saleLat: null, saleLng: null,
    subtotal, total, cashReceived: 30000, changeGiven: 0, note: null, createdAtIso: "2026-10-01T03:00:00.000Z",
    lines: [{ productName: "Kaos", variantSku: "K-M", qty: 1, unitPrice: subtotal, lineTotal: subtotal }],
  };
}

describe.each([
  ["van", (s: number, t: number) => vanSaleNotaHtml(van(s, t))],
  ["spg", (s: number, t: number) => spgSaleNotaHtml(spg(s, t))],
])("%s thermal nota totals", (_name, build) => {
  it("prints no Subtotal or rounding row when total equals subtotal", () => {
    const html = build(29333, 29333);
    expect(html).not.toContain("Pembulatan tunai");
    expect(html).not.toContain(">Subtotal<");
    expect(html).toContain("TOTAL");
  });

  it("prints exact Subtotal and a signed rounding row above TOTAL when they differ", () => {
    const html = build(29333.04, 29333);
    expect(html).toContain(">Subtotal<");
    expect(html).toContain(">Pembulatan tunai<");
    expect(html).toContain("29.333,04");
    expect(html).toContain("-Rp");
    expect(html).toContain("0,04");
    expect(html.indexOf("Pembulatan tunai")).toBeLessThan(html.indexOf(">TOTAL<"));
  });

  it("signs a round-up adjustment with a plus", () => {
    expect(build(29332.96, 29333)).toContain("+Rp");
  });
});
