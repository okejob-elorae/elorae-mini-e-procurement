import { describe, expect, it, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: { workOrder: { findUnique: vi.fn() }, variantColor: { findMany: vi.fn() } },
}));
vi.mock("@/lib/items/variant-colors", () => ({ loadColorIndex: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { loadColorIndex } from "@/lib/items/variant-colors";
import { exportWorkOrderXlsx } from "./work-order-export";

const findUnique = vi.mocked(prisma.workOrder.findUnique);
const findColors = vi.mocked(prisma.variantColor.findMany);

const found = {
  docNumber: "WO/2026/0012",
  status: "ISSUED",
  createdAt: new Date("2026-10-01T03:00:00Z"),
  issuedAt: null,
  targetDate: null,
  notes: null,
  plannedQty: "100",
  outputMode: "GENERIC",
  skuBreakdown: [
    { variantSku: "KMJ-M", ratioPercent: 60 },
    { variantSku: "KMJ-L", ratioPercent: 40 },
  ],
  consumptionPlan: [],
  vendor: { name: "Vendor A", code: "V-01" },
  finishedGood: { sku: "KMJ", nameId: "Kemeja", variants: [], uom: { code: "PCS" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["work_orders:view"] } } as never);
  findUnique.mockResolvedValue(found as never);
  vi.mocked(loadColorIndex).mockResolvedValue(new Map());
  findColors.mockResolvedValue([] as never);
});

describe("exportWorkOrderXlsx", () => {
  it("refuses without a session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect(await exportWorkOrderXlsx("wo1")).toEqual({ status: "forbidden" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(["work_orders:view", "work_orders:create", "work_orders:manage", "*"])("allows %s", async (code) => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "u1", permissions: [code] } } as never);
    const r = await exportWorkOrderXlsx("wo1");
    expect(r.status).toBe("ok");
  });

  it("refuses without any work order permission, reading nothing", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "u1", permissions: ["items:view"] } } as never);
    expect(await exportWorkOrderXlsx("wo1")).toEqual({ status: "forbidden" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns not_found for a missing work order", async () => {
    findUnique.mockResolvedValueOnce(null as never);
    expect(await exportWorkOrderXlsx("missing")).toEqual({ status: "not_found" });
  });

  it("returns a three-sheet workbook named after the doc number", async () => {
    const r = await exportWorkOrderXlsx("wo1");
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.filename).toBe("WO-2026-0012.xlsx");
    const wb = XLSX.read(Buffer.from(r.base64, "base64"));
    expect(wb.SheetNames).toEqual(["Work Order", "Rincian SKU", "Bahan"]);
  });

  it("names matrix colours from the colour master", async () => {
    vi.mocked(loadColorIndex).mockResolvedValueOnce(new Map([["black", "c1"]]));
    findColors.mockResolvedValueOnce([{ id: "c1", name: "Hitam" }] as never);
    findUnique.mockResolvedValueOnce({
      ...found,
      skuBreakdown: [{ variantSku: "KMJ-M", ratioPercent: 100 }],
      finishedGood: { ...found.finishedGood, variants: [{ sku: "KMJ-M", Warna: "BLACK", Ukuran: "M" }] },
    } as never);
    const r = await exportWorkOrderXlsx("wo1");
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(findColors).toHaveBeenCalledWith({ where: { id: { in: ["c1"] } }, select: { id: true, name: true } });
    const wb = XLSX.read(Buffer.from(r.base64, "base64"));
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Work Order"], { header: 1 });
    expect(rows).toContainEqual(["Hitam", 100, 100]);
  });

  it("selects only the vendor name and code", async () => {
    await exportWorkOrderXlsx("wo1");
    const select = (findUnique.mock.calls[0][0] as { select: Record<string, unknown> }).select;
    expect(select.vendor).not.toBe(true);
    expect(select.vendor).toEqual({ select: { name: true, code: true } });
  });
});
