import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@elorae/db", () => ({ prisma: { workOrder: { findMany: mockFindMany } } }));

import { exportVendorPerformanceReport } from "./production";

const HEADER =
  "Doc Number,Finished Good,Planned Qty,Actual Qty,Efficiency %,Material Cost,Return Value,Status,Completion Time (days)";
const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-31T00:00:00Z");

describe("exportVendorPerformanceReport csv", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("writes a BOM and neutralises a formula-shaped finished-good name", async () => {
    mockFindMany.mockResolvedValue([
      {
        docNumber: "WO-1",
        plannedQty: 10,
        actualQty: 5,
        finishedGood: { sku: "FG1", nameId: "x", nameEn: "+bad" },
        issues: [],
        receipts: [],
        returns: [],
        issuedAt: null,
        completedAt: null,
        status: "IN_PROGRESS",
      },
    ]);
    const res = await exportVendorPerformanceReport("v1", FROM, TO, "csv");
    const data = "data" in res ? res.data : "";
    expect(data.startsWith(`﻿${HEADER}\n`)).toBe(true);
    expect(data).toContain(`"WO-1","'+bad","10","5","50","0","0","IN_PROGRESS",""`);
  });

  it("keeps the header row when there is nothing to export", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await exportVendorPerformanceReport("v1", FROM, TO, "csv");
    expect("data" in res && res.data).toBe(`﻿${HEADER}\n`);
  });
});
