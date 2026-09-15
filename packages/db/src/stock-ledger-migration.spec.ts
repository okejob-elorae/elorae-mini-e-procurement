import { describe, expect, it } from "vitest";
import { prisma } from "./index";

describe("stock ledger opening backfill", () => {
  it("gives every non-zero main balance exactly one OPENING entry with a matching quantity", async () => {
    const balances = await prisma.inventoryValue.findMany({
      where: { NOT: { qtyOnHand: 0 } },
      select: { itemId: true, variantSku: true, qtyOnHand: true },
    });

    for (const b of balances) {
      const openings = await prisma.stockLedgerEntry.findMany({
        where: {
          type: "OPENING",
          locationType: "MAIN",
          itemId: b.itemId,
          variantSku: b.variantSku ?? "",
        },
        select: { qty: true, balanceQty: true },
      });

      expect(openings).toHaveLength(1);
      expect(Number(openings[0].qty)).toBe(Number(b.qtyOnHand));
      expect(Number(openings[0].balanceQty)).toBe(Number(b.qtyOnHand));
    }
  });

  it("writes no OPENING entry for a zero balance", async () => {
    const zeroed = await prisma.inventoryValue.findFirst({
      where: { qtyOnHand: 0 },
      select: { itemId: true, variantSku: true },
    });
    if (!zeroed) return;

    const openings = await prisma.stockLedgerEntry.count({
      where: {
        type: "OPENING",
        locationType: "MAIN",
        itemId: zeroed.itemId,
        variantSku: zeroed.variantSku ?? "",
      },
    });

    expect(openings).toBe(0);
  });
});
