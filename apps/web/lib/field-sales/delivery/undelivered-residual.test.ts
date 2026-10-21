import { describe, it, expect } from "vitest";
import { deliveredGoodsValue, deliveredLineNetValues, undeliveredResidual } from "./undelivered-residual";

describe("undeliveredResidual", () => {
  it("returns the whole order total when nothing was delivered", () => {
    expect(undeliveredResidual(1000, [])).toBe(1000);
  });

  it("returns the difference after a partial delivery", () => {
    expect(undeliveredResidual(800, [300])).toBe(500);
  });

  it("subtracts every delivery of the order", () => {
    expect(undeliveredResidual(1000, [250, 250, 100])).toBe(400);
  });

  it("floors an over-delivered order at zero instead of going negative", () => {
    expect(undeliveredResidual(500, [400, 300])).toBe(0);
  });

  /* No rounding happens here: the floor absorbs NEGATIVE float drift, while positive drift (e.g. 0.8 − [0.1, 0.7]) survives as ~1e-16, which formatIdr renders as 0. */
  it("floors negative float drift to zero and sums decimal totals within float precision", () => {
    expect(undeliveredResidual(0.3, [0.1, 0.2])).toBe(0);
    expect(undeliveredResidual(100.5, [50.25, 25.125])).toBeCloseTo(25.125, 10);
  });

  it("returns zero for an empty or zero total", () => {
    expect(undeliveredResidual(0, [])).toBe(0);
    expect(undeliveredResidual(0, [10])).toBe(0);
  });
});

describe("deliveredGoodsValue", () => {
  it("is the exact net of both discount levels, not a rounded figure", () => {
    expect(deliveredGoodsValue({ subtotal: 2000, discountAmount: 0, lineDiscounts: [100.6] })).toBeCloseTo(1899.4, 10);
  });

  it("subtracts the header discount and every line discount", () => {
    expect(deliveredGoodsValue({ subtotal: 10000, discountAmount: 500, lineDiscounts: [600, 400] })).toBe(8500);
  });

  it("is the subtotal when nothing is discounted", () => {
    expect(deliveredGoodsValue({ subtotal: 1000, discountAmount: 0, lineDiscounts: [] })).toBe(1000);
  });

  it("leaves a fully delivered order with no residual when its rounded total fell under the order total", () => {
    /* Order total 1899.40, charged as 1899: residual against the total would be 0.40 forever. */
    const exact = deliveredGoodsValue({ subtotal: 2000, discountAmount: 0, lineDiscounts: [100.6] });
    expect(undeliveredResidual(1899.4, [exact])).toBeCloseTo(0, 6);
    expect(undeliveredResidual(1899.4, [1899])).toBeCloseTo(0.4, 6);
  });
});

describe("deliveredLineNetValues", () => {
  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

  it("takes a line's own discount off its gross lineTotal", () => {
    /* 2 x 1000 with a 100.60 promo: billed 1899.40, never the 2000 gross. */
    expect(deliveredLineNetValues({ discountAmount: 0, lines: [{ lineTotal: 2000, discountAmount: 100.6 }] })).toEqual([1899.4]);
  });

  it("splits the header discount in proportion to the lines' value when no line is discounted", () => {
    const nets = deliveredLineNetValues({
      discountAmount: 500,
      lines: [
        { lineTotal: 6000, discountAmount: 0 },
        { lineTotal: 4000, discountAmount: 0 },
      ],
    });
    expect(nets).toEqual([5700, 3800]);
  });

  it("takes both discount levels off, and sums to the delivery's exact goods value", () => {
    const delivery = {
      subtotal: 3500,
      discountAmount: 35,
      lines: [
        { lineTotal: 2000, discountAmount: 100.6 },
        { lineTotal: 1500, discountAmount: 0 },
      ],
    };
    const nets = deliveredLineNetValues(delivery);
    /* The 35 splits on 1899.40 : 1500 (net of the line discount), 19.56 / 15.44. */
    expect(nets).toEqual([1879.84, 1484.56]);
    const goods = deliveredGoodsValue({
      subtotal: delivery.subtotal,
      discountAmount: delivery.discountAmount,
      lineDiscounts: delivery.lines.map((l) => l.discountAmount),
    });
    expect(sum(nets)).toBeCloseTo(goods, 10);
    expect(sum(nets)).not.toBeCloseTo(delivery.subtotal, 2);
  });

  it("allocates an order discount that does not divide evenly by largest remainder, to the sen", () => {
    /* 100.00 over three equal lines is 33.333...: the leftover sen goes to the first line. */
    const nets = deliveredLineNetValues({
      discountAmount: 100,
      lines: [
        { lineTotal: 1000, discountAmount: 0 },
        { lineTotal: 1000, discountAmount: 0 },
        { lineTotal: 1000, discountAmount: 0 },
      ],
    });
    expect(nets).toEqual([966.66, 966.67, 966.67]);
    expect(sum(nets)).toBeCloseTo(2900, 10);
  });

  it("gives the leftover sen to the line with the largest fractional share", () => {
    /* Shares of 10.00 in the ratio 1 : 2 : 4 are 1.428..., 2.857... and 5.714... */
    const nets = deliveredLineNetValues({
      discountAmount: 10,
      lines: [
        { lineTotal: 100, discountAmount: 0 },
        { lineTotal: 200, discountAmount: 0 },
        { lineTotal: 400, discountAmount: 0 },
      ],
    });
    expect(nets).toEqual([98.57, 197.14, 394.29]);
    expect(sum(nets)).toBeCloseTo(690, 10);
  });

  it("splits the header on each line's value net of its own line discount, as the order promo was computed", () => {
    /* A 1 x 1000 less a 500 line promo, B 1 x 1000; a 10% order promo on the 1500 net is 150,
       which splits 500 : 1000 into 50 / 100, never 75 / 75 by gross. */
    const nets = deliveredLineNetValues({
      discountAmount: 150,
      lines: [
        { lineTotal: 1000, discountAmount: 500 },
        { lineTotal: 1000, discountAmount: 0 },
      ],
    });
    expect(nets).toEqual([450, 900]);
  });

  it("gives a line fully discounted at line level no header share, so it never goes negative", () => {
    const nets = deliveredLineNetValues({
      discountAmount: 100,
      lines: [
        { lineTotal: 1000, discountAmount: 1000 },
        { lineTotal: 1000, discountAmount: 0 },
      ],
    });
    expect(nets).toEqual([0, 900]);
  });

  it("falls back to gross weights when every line is fully discounted at line level", () => {
    /* Nothing net to weigh on, yet a header remains: split it by gross so it lowers the lines
       (here below zero, which retur pricing reads as unpriceable) instead of vanishing. */
    const nets = deliveredLineNetValues({
      discountAmount: 30,
      lines: [
        { lineTotal: 1000, discountAmount: 1000 },
        { lineTotal: 500, discountAmount: 500 },
      ],
    });
    expect(nets).toEqual([-20, -10]);
  });

  it("is the gross when nothing is discounted", () => {
    expect(deliveredLineNetValues({ discountAmount: 0, lines: [{ lineTotal: 1234.56, discountAmount: 0 }] })).toEqual([1234.56]);
  });

  it("returns nothing for a delivery with no lines", () => {
    expect(deliveredLineNetValues({ discountAmount: 50, lines: [] })).toEqual([]);
  });
});
