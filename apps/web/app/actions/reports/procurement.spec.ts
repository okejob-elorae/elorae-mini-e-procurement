import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@elorae/db", () => ({
  POStatus: {},
  prisma: { purchaseOrder: { findMany: mockFindMany } },
}));

import { exportProcurementReport } from "./procurement";

const HEADER = "Doc Number,Supplier,Supplier Code,Status,ETA Date,ETA Alert,Grand Total,Outstanding Qty,Outstanding Value,GRNs";

describe("exportProcurementReport csv", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("writes a BOM and neutralises a formula-shaped supplier name", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "p1",
        docNumber: "PO-1",
        supplier: { name: "@evil", code: "SUP1" },
        status: "SUBMITTED",
        etaDate: null,
        grandTotal: 100,
        items: [{ qty: 5, receivedQty: 2, price: 10 }],
        _count: { grns: 1 },
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const res = await exportProcurementReport(undefined, "csv");
    const data = "data" in res && res.data ? res.data : "";
    expect(data.startsWith(`﻿${HEADER}\n`)).toBe(true);
    expect(data).toContain(`"PO-1","'@evil","SUP1","SUBMITTED"`);
  });

  it("keeps the header row when there is nothing to export", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await exportProcurementReport(undefined, "csv");
    expect("data" in res && res.data).toBe(`﻿${HEADER}\n`);
  });
});
