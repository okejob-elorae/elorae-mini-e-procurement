import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PERMISSIONS } from "@/lib/rbac";
import { gateAllows } from "../akses";
import { ViraInputError } from "../errors";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  listPOs: vi.fn(),
  getPOById: vi.fn(),
  tutupPurchaseOrder: vi.fn(),
  getActorName: vi.fn(),
  notifyPOStatusUpdated: vi.fn(),
  awal: new Date("2026-11-15T17:00:00.000Z"),
}));
vi.mock("@/lib/purchase-orders/queries", () => ({ listPOs: m.listPOs, getPOById: m.getPOById }));
vi.mock("@/lib/purchase-orders/tutup", async (orig) => {
  const actual = await orig<typeof import("@/lib/purchase-orders/tutup")>();
  return { ...actual, tutupPurchaseOrder: m.tutupPurchaseOrder };
});
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: m.getActorName }));
vi.mock("@/lib/notifications/events", () => ({
  notifyPOStatusUpdated: m.notifyPOStatusUpdated,
  notifyPOCreated: vi.fn(),
  notifyPOPaymentToggled: vi.fn(),
}));
vi.mock("@/lib/dashboard/hari-wib", () => ({ batasHariIniWib: () => ({ awal: m.awal }) }));

import { PO_READ_CODES, __sampleInput, parityCases, tools, writeTools } from "./purchase-orders";

const tool = tools[0];
const close = writeTools.find((t) => t.name === "close_purchase_order")!;
const schema = z.object(tool.inputShape);
const closeSchema = z.object(close.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["purchase_orders:view"] }, baseUrl: "https://e.test" };
const writeCtx: ViraToolContext = {
  actor: { id: "u-admin", name: "Admin", permissions: ["purchase_orders:approve", "vira:write"] },
  baseUrl: "https://e.test",
};

function poRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    docNumber: `PO-${id}`,
    supplierId: "sup1",
    status: "SUBMITTED",
    etaDate: "2026-11-20T17:00:00.000Z",
    paymentDueDate: null,
    paidAt: null,
    currency: "IDR",
    totalAmount: 900000,
    taxAmount: 99000,
    grandTotal: 999000,
    notes: "harga khusus",
    terms: "30 hari",
    createdById: "admin",
    createdAt: "2026-11-01T03:00:00.000Z",
    supplier: { name: "CV Kain Jaya", code: "KJ" },
    items: [{ item: { sku: "KAIN-1" }, price: 30000 }],
    utang: { sisa: 999000 },
    kreditRetur: 0,
    ...extra,
  };
}

beforeEach(() => {
  m.listPOs.mockReset().mockResolvedValue({ items: [poRow("a")], totalCount: 1 });
  m.getPOById.mockReset().mockImplementation(async (id: string) =>
    id === "a"
      ? {
          ...poRow("a"),
          createdAt: "2026-11-01T03:00:00.000Z",
          etaDate: "2026-11-20T17:00:00.000Z",
          items: [{ qty: 10, receivedQty: 3 }],
          supplier: { name: "CV Kain Jaya" },
        }
      : null,
  );
  m.tutupPurchaseOrder.mockReset().mockResolvedValue({
    ok: true,
    docNumber: "PO-a",
    statusSebelum: "PARTIAL",
    sisa: [],
    qtySisa: 0,
    nilaiSisa: 0,
  });
  m.getActorName.mockReset().mockResolvedValue("Admin");
  m.notifyPOStatusUpdated.mockReset().mockResolvedValue(undefined);
});

describe("PO_READ_CODES", () => {
  it("is exactly IZIN_BACA_PO in app/actions/purchase-orders.ts", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../app/actions/purchase-orders.ts"), "utf8");
    const blok = /const IZIN_BACA_PO = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    const kunci = [...blok.matchAll(/PERMISSIONS\.(\w+)/g)].map((x) => x[1] as keyof typeof PERMISSIONS);
    expect(kunci.length).toBeGreaterThan(0);
    expect(kunci.map((k) => PERMISSIONS[k])).toEqual([...PO_READ_CODES]);
  });

  it("the gate allows each code alone and denies an unrelated code", () => {
    for (const code of PO_READ_CODES) expect(gateAllows(tool.gate, [code]), code).toBe(true);
    expect(gateAllows(tool.gate, ["items:view"])).toBe(false);
    expect(gateAllows(tool.gate, [])).toBe(false);
  });
});

describe("list_purchase_orders", () => {
  it("input: POStatus enum, 1–100 search, boolean overdue", () => {
    for (const status of ["DRAFT", "SUBMITTED", "PARTIAL", "CLOSED", "OVER", "CANCELLED"]) {
      expect(schema.safeParse({ status }).success).toBe(true);
    }
    expect(schema.safeParse({ status: "overdue" }).success).toBe(false);
    expect(schema.safeParse({ overdue: "yes" }).success).toBe(false);
    expect(schema.safeParse({ search: "" }).success).toBe(false);
  });

  it("passes status, overdue and search (as cari) to listPOs", async () => {
    await tool.handler(schema.parse({ status: "PARTIAL", overdue: true, search: "kain" }), ctx);
    expect(m.listPOs).toHaveBeenCalledWith({ status: "PARTIAL", overdue: true, cari: "kain" }, { page: 1, pageSize: 20 });
    await tool.handler(schema.parse({}), ctx);
    expect(m.listPOs).toHaveBeenLastCalledWith({}, { page: 1, pageSize: 20 });
  });

  it("maps exactly the listed fields, no notes, terms, lines or payable data", async () => {
    const out = serialize(await tool.handler(schema.parse({}), ctx)) as { items: unknown[] };
    expect(out.items).toEqual([
      {
        id: "a",
        poNo: "PO-a",
        supplier: { id: "sup1", name: "CV Kain Jaya" },
        status: "SUBMITTED",
        orderDate: "2026-11-01T03:00:00.000Z",
        expectedDate: "2026-11-20T17:00:00.000Z",
        total: 999000,
        isOverdue: false,
        url: "https://e.test/backoffice/purchase-orders/a",
      },
    ]);
  });

  it("isOverdue follows the overdue filter's rule: ETA before today WIB, SUBMITTED or PARTIAL only", async () => {
    m.listPOs.mockResolvedValue({
      items: [
        poRow("late", { etaDate: "2026-11-14T17:00:00.000Z" }),
        poRow("today", { etaDate: "2026-11-15T17:00:00.000Z" }),
        poRow("draft", { status: "DRAFT", etaDate: "2026-11-01T17:00:00.000Z" }),
        poRow("partial", { status: "PARTIAL", etaDate: "2026-11-01T17:00:00.000Z" }),
        poRow("closed", { status: "CLOSED", etaDate: "2026-11-01T17:00:00.000Z" }),
        poRow("noeta", { etaDate: null }),
      ],
      totalCount: 6,
    });
    const out = (await tool.handler(schema.parse({}), ctx)) as { items: Array<{ id: string; isOverdue: boolean }> };
    expect(Object.fromEntries(out.items.map((i) => [i.id, i.isOverdue]))).toEqual({
      late: true,
      today: false,
      draft: false,
      partial: true,
      closed: false,
      noeta: false,
    });
  });

  it("pages with page/pageSize, and refuses an offset that is not a multiple of limit", async () => {
    m.listPOs.mockResolvedValue({ items: [poRow("x")], totalCount: 21 });
    const out = (await tool.handler(schema.parse({ limit: 10, offset: 20 }), ctx)) as Record<string, unknown>;
    expect(m.listPOs).toHaveBeenCalledWith({}, { page: 3, pageSize: 10 });
    expect(out).toMatchObject({ total: 21, offset: 20, limit: 10, hasMore: false });
    await expect(tool.handler(schema.parse({ limit: 10, offset: 5 }), ctx)).rejects.toBeInstanceOf(ViraInputError);
  });

  it("has one action parity case on getPOs → listPOs", () => {
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "list_purchase_orders",
          kind: "action",
          actionExport: "getPOs",
          libExport: "listPOs",
        }),
      ]),
    );
  });
});

describe("close_purchase_order", () => {
  it("__sampleInput and writeAction parity", () => {
    expect(__sampleInput.close_purchase_order).toEqual({ po: "PO-1", reason: "x" });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "close_purchase_order",
          kind: "writeAction",
          actionExport: "tutupPO",
          args: ["po-1", "alasan"],
        }),
      ]),
    );
  });

  it("prepare + execute + afterSuccess notification; refusal skips notify", async () => {
    const prepared = await close.prepare(closeSchema.parse({ po: "a", reason: "pemasok tidak sanggup" }), writeCtx);
    expect(prepared.preview.title).toBe("Tutup PO PO-a");
    expect(prepared.preview.details.find((d) => d.label === "Sudah diterima")?.value).toBe("3");
    expect(m.tutupPurchaseOrder).not.toHaveBeenCalled();

    const ok = await close.execute(prepared.args, writeCtx);
    expect(m.tutupPurchaseOrder).toHaveBeenCalledWith({
      poId: "a",
      userId: "u-admin",
      alasan: "pemasok tidak sanggup",
    });
    expect(ok).toMatchObject({ ok: true, message: "PO PO-a ditutup.", extra: { docNumber: "PO-a", statusSebelum: "PARTIAL" } });
    await close.afterSuccess!(prepared.args, ok as Extract<typeof ok, { ok: true }>, writeCtx);
    expect(m.notifyPOStatusUpdated).toHaveBeenCalledWith("a", "PO-a", "PARTIAL", "CLOSED", "Admin");

    m.notifyPOStatusUpdated.mockClear();
    m.tutupPurchaseOrder.mockResolvedValueOnce({ ok: false, code: "BELUM_ADA_PENERIMAAN" });
    const fail = await close.execute(prepared.args, writeCtx);
    expect(fail).toMatchObject({ ok: false, code: "BELUM_ADA_PENERIMAAN" });
    expect(m.notifyPOStatusUpdated).not.toHaveBeenCalled();
  });

  it("wrong status → prepare refuses", async () => {
    m.getPOById.mockResolvedValue({
      ...poRow("a", { status: "CLOSED" }),
      createdAt: "2026-11-01T03:00:00.000Z",
      etaDate: null,
      items: [{ qty: 10, receivedQty: 3 }],
      supplier: { name: "X" },
    });
    await expect(close.prepare(closeSchema.parse({ po: "a", reason: "x" }), writeCtx)).rejects.toBeInstanceOf(
      ViraInputError,
    );
  });

  it("zero received / fully received → prepare refuses", async () => {
    m.getPOById.mockResolvedValue({
      ...poRow("a"),
      items: [{ qty: 10, receivedQty: 0 }],
      supplier: { name: "X" },
    });
    await expect(close.prepare(closeSchema.parse({ po: "a", reason: "x" }), writeCtx)).rejects.toBeInstanceOf(
      ViraInputError,
    );
    m.getPOById.mockResolvedValue({
      ...poRow("a"),
      items: [{ qty: 10, receivedQty: 10 }],
      supplier: { name: "X" },
    });
    await expect(close.prepare(closeSchema.parse({ po: "a", reason: "x" }), writeCtx)).rejects.toBeInstanceOf(
      ViraInputError,
    );
  });
});
