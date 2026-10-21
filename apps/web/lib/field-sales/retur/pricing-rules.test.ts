import { describe, expect, it } from "vitest";
import { deliveredGoodsValue, deliveredLineNetValues } from "@/lib/field-sales/delivery/undelivered-residual";
import { classifyPriceCandidates, effectiveUnitPrice, round2 } from "./pricing-rules";

describe("effectiveUnitPrice", () => {
  it("divides the line total by its quantity", () => {
    expect(effectiveUnitPrice(10_000_000, 12)).toBeCloseTo(833_333.3333, 4);
  });

  it("returns null for a zero quantity rather than dividing by zero", () => {
    expect(effectiveUnitPrice(10_000_000, 0)).toBeNull();
  });

  it("returns null for a negative quantity", () => {
    expect(effectiveUnitPrice(10_000_000, -3)).toBeNull();
  });

  it("does NOT round — the caller needs the exact ratio to compute an exact line total", () => {
    expect(effectiveUnitPrice(10, 3)).toBe(10 / 3);
  });
});

describe("pricing a retur of a discounted delivery", () => {
  /*
   * The same chain the retur writers run: `deliveredLineNetValues` for the delivery line's net,
   * `effectiveUnitPrice` over its qty, then one multiply-and-round by the credited qty.
   */
  const lineValue = (net: number, deliveredQty: number, creditedQty: number) =>
    round2(creditedQty * (effectiveUnitPrice(net, deliveredQty) as number));

  it("credits a line-discounted line at its net, not its gross", () => {
    const [net] = deliveredLineNetValues({ discountAmount: 0, lines: [{ lineTotal: 2000, discountAmount: 100.6 }] });
    expect(lineValue(net, 2, 2)).toBe(1899.4);
  });

  it("credits an order-discounted line at its net, not its gross", () => {
    const nets = deliveredLineNetValues({
      discountAmount: 500,
      lines: [
        { lineTotal: 6000, discountAmount: 0 },
        { lineTotal: 4000, discountAmount: 0 },
      ],
    });
    expect(lineValue(nets[0], 6, 6)).toBe(5700);
    expect(lineValue(nets[1], 4, 4)).toBe(3800);
  });

  it("pro-rates a partial retur per unit and rounds once, to the sen", () => {
    const [net] = deliveredLineNetValues({ discountAmount: 0, lines: [{ lineTotal: 3000, discountAmount: 100 }] });
    /* 2900 over 3 units is 966.666...; two units credit 1933.33, never 2 x 966.67. */
    expect(lineValue(net, 3, 2)).toBe(1933.33);
    expect(lineValue(net, 3, 1)).toBe(966.67);
  });

  it("credits a full retur of every line at the delivery's exact goods value", () => {
    const delivery = {
      subtotal: 3500,
      discountAmount: 35,
      lines: [
        { lineTotal: 2000, discountAmount: 100.6, qty: 2 },
        { lineTotal: 1500, discountAmount: 0, qty: 3 },
      ],
    };
    const nets = deliveredLineNetValues(delivery);
    const total = round2(nets.reduce((sum, net, i) => sum + lineValue(net, delivery.lines[i].qty, delivery.lines[i].qty), 0));
    const goods = deliveredGoodsValue({
      subtotal: delivery.subtotal,
      discountAmount: delivery.discountAmount,
      lineDiscounts: delivery.lines.map((l) => l.discountAmount),
    });
    expect(total).toBe(3364.4);
    expect(total).toBeCloseTo(goods, 10);
  });
});

describe("classifyPriceCandidates", () => {
  it("auto-prices when exactly one distinct price exists", () => {
    expect(classifyPriceCandidates([833_333.3333])).toEqual({ kind: "AUTO", price: 833_333.3333, index: 0 });
  });

  it("auto-prices when several deliveries carry the SAME price — there is no decision to make", () => {
    expect(classifyPriceCandidates([500, 500, 500])).toEqual({ kind: "AUTO", price: 500, index: 0 });
  });

  it("is ambiguous when two distinct prices exist", () => {
    expect(classifyPriceCandidates([500, 450])).toEqual({ kind: "AMBIGUOUS" });
  });

  it("is unpriceable when no delivery priced these goods", () => {
    expect(classifyPriceCandidates([])).toEqual({ kind: "UNPRICEABLE" });
  });

  it("de-dupes prices that are the genuinely same rupiah amount but differ in float noise", () => {
    /* The classic 0.1 + 0.2 !== 0.3 IEEE-754 case, scaled to a realistic rupiah magnitude: both
       amounts are "the same price, Rp 300.000,00" and must not read as two disagreeing
       deliveries. A raw-float Set would treat these as distinct and force an unnecessary
       AMBIGUOUS pick. */
    const a = (0.1 + 0.2) * 1_000_000;
    const b = 0.3 * 1_000_000;
    expect(a).not.toBe(b);
    expect(classifyPriceCandidates([a, b])).toEqual({ kind: "AUTO", price: b, index: 1 });
  });

  it("auto-prices candidates under a rupiah apart at the LOWEST of them, never above it", () => {
    /* One promo, two deliveries, each rounding its own discount share: 967 against 966.50. */
    expect(classifyPriceCandidates([967, 966.5])).toEqual({ kind: "AUTO", price: 966.5, index: 1 });
  });

  it("is ambiguous when two candidates are a whole rupiah apart", () => {
    expect(classifyPriceCandidates([967, 966])).toEqual({ kind: "AMBIGUOUS" });
  });

  it("judges the spread of the whole set, so pairwise-close steps cannot chain past a rupiah", () => {
    /* 966.40 -> 967.20 -> 967.90 are each under a rupiah apart, but the set spans 1.50. */
    expect(classifyPriceCandidates([966.4, 967.2, 967.9])).toEqual({ kind: "AMBIGUOUS" });
  });

  it("names the first of tied lowest candidates", () => {
    expect(classifyPriceCandidates([966.9, 966.5, 966.5])).toEqual({ kind: "AUTO", price: 966.5, index: 1 });
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(833_333.3333)).toBe(833_333.33);
  });

  it("rounds half away from zero rather than to even", () => {
    expect(round2(0.005)).toBe(0.01);
  });

  it("does not lose the .5 boundary to floating-point imprecision", () => {
    /* 1.005 * 100 is 100.49999999999999 in IEEE-754 — a naive Math.round on that returns 1. */
    expect(round2(1.005)).toBe(1.01);
  });
});
