import { describe, expect, it } from "vitest";
import { buildColorIndex } from "@elorae/db/variant-axes";
import { buildWorkOrderExportSheets, type WorkOrderExportInput } from "./sheets";

const variants = [
  { sku: "FG-RED-S", Warna: "Merah", Ukuran: "S" },
  { sku: "FG-RED-M", Warna: "Merah", Ukuran: "M" },
  { sku: "FG-RED-L", Warna: "Merah", Ukuran: "L" },
  { sku: "FG-BLK-M", Warna: "Hitam", Ukuran: "M" },
  { sku: "FG-BLK-L", Warna: "Hitam", Ukuran: "L" },
];

const breakdown = [
  { variantSku: "FG-RED-S", ratioPercent: 10 },
  { variantSku: "FG-RED-M", ratioPercent: 20 },
  { variantSku: "FG-RED-L", ratioPercent: 20 },
  { variantSku: "FG-BLK-M", ratioPercent: 30 },
  { variantSku: "FG-BLK-L", ratioPercent: 20 },
];

const plan = [
  {
    itemId: "m1",
    itemName: "Katun",
    itemType: "FABRIC",
    uomCode: "YD",
    qtyRequired: 1.5,
    wastePercent: 5,
    plannedQty: 157.5,
    byColor: [
      { colorId: "c1", colorName: "Merah", plannedQty: 70 },
      { colorId: "c2", colorName: "Hitam", plannedQty: 87.5 },
    ],
    issuedQty: 40,
    returnedQty: 5,
  },
  {
    itemId: "m2",
    itemName: "Kancing",
    itemType: "ACCESSORIES",
    uomCode: "PCS",
    qtyRequired: 4,
    wastePercent: 0,
    plannedQty: 400,
    issuedQty: 0,
    returnedQty: 0,
  },
];

function make(overrides: Partial<WorkOrderExportInput> = {}): WorkOrderExportInput {
  return {
    docNumber: "WO/2026/0012",
    status: "ISSUED",
    createdAt: new Date("2026-10-25T18:00:00Z"),
    issuedAt: null,
    targetDate: new Date("2026-11-10T00:00:00Z"),
    notes: null,
    plannedQty: 100,
    outputMode: "SKU",
    vendor: { name: "CMT Jaya", code: "V-01" },
    finishedGood: { sku: "FG-01", nameId: "Kemeja", uomCode: "PCS", variants },
    skuBreakdown: breakdown,
    consumptionPlan: plan,
    colorIndex: new Map(),
    colorNames: {},
    ...overrides,
  };
}

describe("buildWorkOrderExportSheets", () => {
  it("writes the header block with WIB dates", () => {
    const { workOrder } = buildWorkOrderExportSheets(make());
    expect(workOrder.slice(0, 9)).toEqual([
      ["No. WO", "WO/2026/0012"],
      ["Tanggal", "2026-10-26"],
      ["Tanggal Issue", ""],
      ["Target Selesai", "2026-11-10"],
      ["Status", "Diterbitkan"],
      ["Vendor", "CMT Jaya (V-01)"],
      ["Produk", "FG-01 — Kemeja"],
      ["Total Qty", "100 PCS"],
      ["Catatan", ""],
    ]);
  });

  it("builds the colour by size matrix", () => {
    const { workOrder } = buildWorkOrderExportSheets(make());
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header]).toEqual(["Warna", "S", "M", "L", "Total"]);
    expect(workOrder[header + 1]).toEqual(["Merah", 10, 20, 20, 50]);
    expect(workOrder[header + 2]).toEqual(["Hitam", null, 30, 20, 50]);
    expect(workOrder[header + 3]).toEqual(["Total", 10, 50, 40, 100]);
  });

  it("lists SKU detail in matrix order with a total", () => {
    const { skuDetail } = buildWorkOrderExportSheets(make());
    expect(skuDetail?.[0]).toEqual(["Varian SKU", "Warna", "Ukuran", "Rasio (%)", "Qty"]);
    expect(skuDetail?.[1]).toEqual(["FG-RED-S", "Merah", "S", 10, 10]);
    expect(skuDetail?.[4]).toEqual(["FG-BLK-M", "Hitam", "M", 30, 30]);
    expect(skuDetail?.[skuDetail.length - 1]).toEqual(["Total", null, null, 100, 100]);
  });

  it("handles a GENERIC work order", () => {
    const { workOrder, skuDetail } = buildWorkOrderExportSheets(make({ skuBreakdown: null }));
    expect(skuDetail).toBeNull();
    expect(workOrder).toContainEqual(["Tanpa rincian warna/ukuran (generic)"]);
  });

  it("puts 100% on a single-object breakdown", () => {
    const { skuDetail } = buildWorkOrderExportSheets(make({ skuBreakdown: { variantSku: "FG-RED-M" } }));
    expect(skuDetail?.[1]).toEqual(["FG-RED-M", "Merah", "M", 100, 100]);
    expect(skuDetail?.length).toBe(3);
  });

  it("keeps an unknown SKU under a dash row and column", () => {
    const { workOrder, skuDetail } = buildWorkOrderExportSheets(
      make({
        skuBreakdown: [
          { variantSku: "FG-RED-M", ratioPercent: 80 },
          { variantSku: "FG-OLD", ratioPercent: 20 },
        ],
      }),
    );
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header]).toEqual(["Warna", "M", "—", "Total"]);
    expect(workOrder[header + 2]).toEqual(["—", null, 20, 20]);
    expect(workOrder[header + 3]).toEqual(["Total", 80, 20, 100]);
    expect(skuDetail).toContainEqual(["FG-OLD", "—", "—", 20, 20]);
  });

  it("parses a string-encoded breakdown", () => {
    const { skuDetail } = buildWorkOrderExportSheets(make({ skuBreakdown: JSON.stringify(breakdown) }));
    expect(skuDetail?.length).toBe(7);
  });

  it("splits materials by colour with a total row", () => {
    const { materials } = buildWorkOrderExportSheets(make());
    expect(materials[0]).toEqual([
      "Bahan",
      "Warna",
      "Satuan",
      "Rata-rata per Pcs",
      "Waste (%)",
      "Rencana",
      "Sudah Diissue",
      "Dikembalikan",
    ]);
    expect(materials[1]).toEqual(["Katun", "Merah", "YD", null, null, 70, null, null]);
    expect(materials[2]).toEqual(["Katun", "Hitam", "YD", null, null, 87.5, null, null]);
    expect(materials[3]).toEqual(["Katun", "Total", "YD", 1.5, 5, 157.5, 40, 5]);
    expect(materials[4]).toEqual(["Kancing", "", "PCS", 4, 0, 400, 0, 0]);
  });

  it("parses a string-encoded plan", () => {
    const a = buildWorkOrderExportSheets(make()).materials;
    const b = buildWorkOrderExportSheets(make({ consumptionPlan: JSON.stringify(plan) })).materials;
    expect(b).toEqual(a);
  });

  it("falls back for an unreadable or empty plan", () => {
    for (const consumptionPlan of ["not json", []]) {
      const { materials } = buildWorkOrderExportSheets(make({ consumptionPlan }));
      expect(materials.length).toBe(2);
      expect(materials[1]).toEqual(["Belum ada rencana bahan"]);
    }
  });

  it("rounds averaged material figures", () => {
    const consumptionPlan = [
      { itemName: "Benang", uomCode: "M", qtyRequired: 10 / 3, wastePercent: 1 / 3, plannedQty: 333.33333, issuedQty: 0.1 + 0.2 },
    ];
    const { materials } = buildWorkOrderExportSheets(make({ consumptionPlan }));
    expect(materials[1]).toEqual(["Benang", "", "M", 3.3333, 0.3333, 333.33, 0.3, 0]);
  });

  it("falls back to the raw status when unknown", () => {
    const { workOrder } = buildWorkOrderExportSheets(make({ status: "WEIRD" }));
    expect(workOrder[4]).toEqual(["Status", "WEIRD"]);
  });

  it("names an alias colour after the colour master", () => {
    const { workOrder } = buildWorkOrderExportSheets(
      make({
        finishedGood: {
          sku: "FG-01",
          nameId: "Kemeja",
          uomCode: "PCS",
          variants: [{ sku: "FG-BLK-M", Warna: "BLACK", Ukuran: "M" }],
        },
        skuBreakdown: [{ variantSku: "FG-BLK-M", ratioPercent: 100 }],
        colorIndex: buildColorIndex([{ id: "c2", name: "Hitam", aliases: ["Black"] }]),
        colorNames: { c2: "Hitam" },
      }),
    );
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header + 1]).toEqual(["Hitam", 100, 100]);
  });

  it("merges colour spellings that share a match key into one row", () => {
    const { workOrder } = buildWorkOrderExportSheets(
      make({
        finishedGood: {
          sku: "FG-01",
          nameId: "Kemeja",
          uomCode: "PCS",
          variants: [
            { sku: "A-S", Warna: "Off White", Ukuran: "S" },
            { sku: "A-M", Warna: "Off-White", Ukuran: "M" },
          ],
        },
        skuBreakdown: [
          { variantSku: "A-S", ratioPercent: 50 },
          { variantSku: "A-M", ratioPercent: 50 },
        ],
      }),
    );
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header]).toEqual(["Warna", "S", "M", "Total"]);
    expect(workOrder[header + 1]).toEqual(["Off White", 50, 50, 100]);
    expect(workOrder[header + 2]).toEqual(["Total", 50, 50, 100]);
  });

  it("keeps a colour labelled None apart from the no-colour row", () => {
    const { workOrder } = buildWorkOrderExportSheets(
      make({
        finishedGood: {
          sku: "FG-01",
          nameId: "Kemeja",
          uomCode: "PCS",
          variants: [{ sku: "N-M", Warna: "None", Ukuran: "M" }],
        },
        skuBreakdown: [
          { variantSku: "N-M", ratioPercent: 70 },
          { variantSku: "GONE", ratioPercent: 30 },
        ],
      }),
    );
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header + 1]).toEqual(["None", 70, null, 70]);
    expect(workOrder[header + 2]).toEqual(["—", null, 30, 30]);
  });

  it("puts size spellings with one match key in a single column", () => {
    const { workOrder } = buildWorkOrderExportSheets(
      make({
        finishedGood: {
          sku: "FG-01",
          nameId: "Kemeja",
          uomCode: "PCS",
          variants: [
            { sku: "A-1", Warna: "Merah", Ukuran: "All Size" },
            { sku: "B-1", Warna: "Hitam", Ukuran: "ALLSIZE" },
          ],
        },
        skuBreakdown: [
          { variantSku: "A-1", ratioPercent: 50 },
          { variantSku: "B-1", ratioPercent: 50 },
        ],
      }),
    );
    const header = workOrder.findIndex((r) => r[0] === "Warna");
    expect(workOrder[header]).toEqual(["Warna", "All Size", "Total"]);
    expect(workOrder[header + 1]).toEqual(["Merah", 50, 50]);
    expect(workOrder[header + 2]).toEqual(["Hitam", 50, 50]);
  });
});
