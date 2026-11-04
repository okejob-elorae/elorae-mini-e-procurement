import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { FieldSalesOrderDetail } from "@/lib/field-sales/queries";
import { barisBanding } from "./baris-banding";

type Baris = FieldSalesOrderDetail["lines"][number];

function baris(sebagian: Partial<Baris> & Pick<Baris, "id">): Baris {
  return {
    itemId: "item-1",
    productName: "Kaos",
    variantSku: "KAOS-M",
    variantLabel: "M",
    qty: 2,
    unitPrice: 100_000,
    lineTotal: 200_000,
    available: 10,
    onHand: 10,
    outstanding: 2,
    discountAmount: 0,
    appliedPromoName: null,
    belowCost: false,
    requestedUnitPrice: null,
    appealReason: null,
    addedById: null,
    isBonus: false,
    bonusPromoName: null,
    ...sebagian,
  };
}

describe("barisBanding", () => {
  it("hanya baris yang dibanding, membawa potongan dan nama promo baris (peringatan promo gugur)", () => {
    const hasil = barisBanding([
      baris({ id: "biasa" }),
      baris({
        id: "banding-promo",
        requestedUnitPrice: 80_000,
        appealReason: "Toko langganan",
        discountAmount: 20_000,
        appliedPromoName: "Diskon Juli",
      }),
      baris({ id: "banding-polos", requestedUnitPrice: 90_000 }),
    ]);

    expect(hasil).toEqual([
      {
        id: "banding-promo",
        productName: "Kaos",
        variantLabel: "M",
        variantSku: "KAOS-M",
        unitPrice: 100_000,
        requestedUnitPrice: 80_000,
        appealReason: "Toko langganan",
        lineDiscount: 20_000,
        promoName: "Diskon Juli",
      },
      {
        id: "banding-polos",
        productName: "Kaos",
        variantLabel: "M",
        variantSku: "KAOS-M",
        unitPrice: 100_000,
        requestedUnitPrice: 90_000,
        appealReason: null,
        lineDiscount: 0,
        promoName: null,
      },
    ]);
  });

  it("harga banding 0 tetap dihitung sebagai banding", () => {
    expect(barisBanding([baris({ id: "nol", requestedUnitPrice: 0 })]).map((b) => b.id)).toEqual(["nol"]);
  });

  // Penjaga: pemetaan tulisan tangan di halaman rincian dulu melupakan potongan + nama promo.
  it("halaman rincian pesanan membangun baris banding lewat barisBanding", () => {
    const isi = readFileSync(join(__dirname, "FieldSalesOrderDetailClient.tsx"), "utf8");
    expect(isi).toMatch(/appealedLines[^=]*=\s*barisBanding\(order\.lines\)/);
  });
});
