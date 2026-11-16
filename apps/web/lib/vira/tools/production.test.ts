import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PERMISSIONS } from "@/lib/rbac";
import { gateAllows } from "../akses";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ listWorkOrders: vi.fn() }));
vi.mock("@/lib/work-orders/queries", () => ({ listWorkOrders: m.listWorkOrders }));

import { parityCases, tools, WO_READ_CODES } from "./production";

const tool = tools[0];
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["work_orders:view"] }, baseUrl: "https://e.test" };

function woRow(id: string) {
  return {
    id,
    docNumber: `WO-${id}`,
    vendorId: "v1",
    finishedGoodId: "fg1",
    outputMode: "FG",
    plannedQty: 120,
    actualQty: null,
    targetDate: new Date("2026-11-30T17:00:00.000Z"),
    status: "IN_PRODUCTION",
    notes: "ongkos jahit 5000",
    createdById: "admin",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    vendor: { name: "Konveksi Maju", code: "KM" },
    finishedGood: { id: "fg1", sku: "KAOS-01", nameId: "Kaos Polos", nameEn: "Plain Tee" },
    _count: { issues: 1, receipts: 0 },
    setoran: { diterima: 0 },
  };
}

beforeEach(() => {
  m.listWorkOrders.mockReset().mockResolvedValue({ items: [woRow("a")], totalCount: 1 });
});

describe("WO_READ_CODES", () => {
  it("is exactly IZIN_BACA_WO + vendor_returns:view, as getWorkOrders in app/actions/production.ts checks", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../app/actions/production.ts"), "utf8");
    const blok = /const IZIN_BACA_WO = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    const kunci = [...blok.matchAll(/PERMISSIONS\.(\w+)/g)].map((x) => x[1] as keyof typeof PERMISSIONS);
    expect(kunci.length).toBeGreaterThan(0);
    expect(src).toMatch(/getWorkOrders\([^)]*\)\s*\{[^}]*wajibBolehBaca\(\[\.\.\.IZIN_BACA_WO, PERMISSIONS\.VENDOR_RETURNS_VIEW\]\)/);
    expect([...kunci.map((k) => PERMISSIONS[k]), PERMISSIONS.VENDOR_RETURNS_VIEW]).toEqual([...WO_READ_CODES]);
  });

  it("the gate allows each code alone and denies an unrelated code", () => {
    for (const code of WO_READ_CODES) expect(gateAllows(tool.gate, [code]), code).toBe(true);
    expect(gateAllows(tool.gate, ["purchase_orders:view"])).toBe(false);
    expect(gateAllows(tool.gate, [])).toBe(false);
  });
});

describe("list_work_orders", () => {
  it("input: WOStatus enum, 1–100 search, boolean late", () => {
    for (const status of ["DRAFT", "ISSUED", "IN_PRODUCTION", "PARTIAL", "COMPLETED", "CANCELLED"]) {
      expect(schema.safeParse({ status }).success).toBe(true);
    }
    expect(schema.safeParse({ status: "LATE" }).success).toBe(false);
    expect(schema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ late: 1 }).success).toBe(false);
  });

  it("passes status, search (as q) and late (as the built-in terlambat filter)", async () => {
    await tool.handler(schema.parse({ status: "ISSUED", search: "kaos", late: true }), ctx);
    expect(m.listWorkOrders).toHaveBeenCalledWith({ status: "ISSUED", q: "kaos", terlambat: true }, { page: 1, pageSize: 20 });
  });

  it("maps exactly the listed fields — no vendor, notes or isLate", async () => {
    const out = serialize(await tool.handler(schema.parse({}), ctx)) as { items: unknown[] };
    expect(out.items).toEqual([
      {
        id: "a",
        woNo: "WO-a",
        item: { sku: "KAOS-01", name: "Kaos Polos" },
        qty: 120,
        status: "IN_PRODUCTION",
        dueDate: "2026-11-30T17:00:00.000Z",
        url: "https://e.test/backoffice/work-orders/a",
      },
    ]);
  });

  it("pages with page/pageSize, and refuses an offset that is not a multiple of limit", async () => {
    m.listWorkOrders.mockResolvedValue({ items: [woRow("b"), woRow("c")], totalCount: 30 });
    const out = (await tool.handler(schema.parse({ limit: 2, offset: 4 }), ctx)) as Record<string, unknown>;
    expect(m.listWorkOrders).toHaveBeenCalledWith({}, { page: 3, pageSize: 2 });
    expect(out).toMatchObject({ total: 30, offset: 4, limit: 2, hasMore: true });
    await expect(tool.handler(schema.parse({ limit: 2, offset: 3 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("has one action parity case on getWorkOrders → listWorkOrders", () => {
    expect(parityCases).toMatchObject([{ tool: "list_work_orders", kind: "action", actionExport: "getWorkOrders", libExport: "listWorkOrders" }]);
  });
});
