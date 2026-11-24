/**
 * DB-backed EVAL seed checks. Vitest only.
 * Reads EVAL-* rows on :3308; skips if seed missing.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@elorae/db";
import { VIRA_ENTITIES } from "../entities";
import { aggregateEntity, queryEntity } from "../generic-query";
import { tools as fieldSalesTools } from "./field-sales-orders";
import type { ViraToolContext } from "./types";

const adminActor = {
  id: "eval_user_admin",
  name: "EVAL Admin",
  permissions: ["*"],
};

const ctx: ViraToolContext = {
  actor: adminActor,
  baseUrl: "http://localhost:3010",
};

async function evalSeedPresent(): Promise<boolean> {
  const n = await prisma.fieldSalesOrder.count({
    where: { orderNo: "EVAL-SO-PUTUS-ODUE" },
  });
  return n > 0;
}

describe("generic query against EVAL seed", () => {
  it("query_entity pages purchase_order EVAL rows", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const page = await queryEntity({
      actor: adminActor,
      baseUrl: ctx.baseUrl,
      entity: "purchase_order",
      where: { docNumber: { startsWith: "EVAL-" } },
      limit: 10,
      offset: 0,
    });
    expect(page.total).toBe(3);
    expect(page.items.length).toBe(3);
    expect(page.hasMore).toBe(false);
    for (const row of page.items) {
      expect(row.url).toMatch(/\/backoffice\/purchase-orders\//);
      expect(JSON.stringify(row)).not.toMatch(/password|npwp|phone/i);
    }
  });

  it("aggregate_entity counts POs by status", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const { groups } = await aggregateEntity({
      actor: adminActor,
      entity: "purchase_order",
      where: { docNumber: { startsWith: "EVAL-" } },
      groupBy: ["status"],
      count: true,
    });
    const byStatus = Object.fromEntries(
      groups.map((g) => [String(g.status), (g._count as { _all?: number })?._all ?? g._count]),
    );
    expect(byStatus.PARTIAL).toBe(1);
    expect(byStatus.SUBMITTED).toBe(1);
    expect(byStatus.CLOSED).toBe(1);
  });

  it("get_field_sales_order_credit marks EVAL-SO-PUTUS-ODUE bermasalah for overdue", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const tool = fieldSalesTools.find((t) => t.name === "get_field_sales_order_credit")!;
    const result = (await tool.handler(
      { docNo: "EVAL-SO-PUTUS-ODUE" },
      ctx,
    )) as {
      bermasalah: boolean;
      reasons: string[];
      overdueReceivables: { count: number };
      kreditDitahan: boolean;
    };
    expect(result.bermasalah).toBe(true);
    expect(result.reasons).toContain("overdue_receivables");
    expect(result.overdueReceivables.count).toBeGreaterThan(0);
    expect(result.kreditDitahan).toBe(false);
  });

  it("get_field_sales_order_credit marks EVAL-SO-PUTUS-HOLD for kreditDitahan", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const tool = fieldSalesTools.find((t) => t.name === "get_field_sales_order_credit")!;
    const result = (await tool.handler(
      { docNo: "EVAL-SO-PUTUS-HOLD" },
      ctx,
    )) as { bermasalah: boolean; reasons: string[]; kreditDitahan: boolean };
    expect(result.bermasalah).toBe(true);
    expect(result.kreditDitahan).toBe(true);
    expect(result.reasons).toContain("kredit_ditahan");
  });

  it("hides money of a KONSI order that is not approved, in rows, lines, filters and sums", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const q = { actor: adminActor, baseUrl: ctx.baseUrl, entity: "field_sales_order", limit: 10, offset: 0 };
    const orderNo = "EVAL-SO-KONSI-001";
    const { items } = await queryEntity({ ...q, where: { orderNo }, include: { lines: true } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ orderNo, total: null, subtotal: null });
    const lines = items[0].lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toMatchObject({ unitPrice: null, lineTotal: null });
      expect(l).not.toHaveProperty("order");
    }
    const filtered = await queryEntity({ ...q, where: { orderNo, total: { gte: 0 } } });
    expect(filtered.total).toBe(0);
    expect(filtered.note).toMatch(/hidden/);
    const sorted = await queryEntity({ ...q, where: { orderNo }, orderBy: { field: "total" } });
    expect(sorted.total).toBe(0);
    const sum = await aggregateEntity({
      actor: adminActor,
      entity: "field_sales_order_line",
      where: { orderId: String(items[0].id) },
      count: true,
      sum: ["lineTotal"],
    });
    expect(sum.groups[0]).toMatchObject({ _count: { _all: 0 }, _sum: { lineTotal: null } });
  });

  it("shows PUTUS money and only the asked fields, with a working url", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const { items } = await queryEntity({
      actor: adminActor,
      baseUrl: ctx.baseUrl,
      entity: "field_sales_order",
      where: { orderNo: "EVAL-SO-PUTUS-ODUE" },
      fields: ["total"],
      limit: 1,
      offset: 0,
    });
    expect(Object.keys(items[0]).sort()).toEqual(["id", "orderNo", "total", "url"]);
    expect(items[0].total).toBe(225000);
    const stok = await queryEntity({
      actor: adminActor,
      baseUrl: ctx.baseUrl,
      entity: "inventory_value",
      fields: ["qtyOnHand"],
      limit: 1,
      offset: 0,
    });
    expect(stok.items[0]?.url).not.toMatch(/undefined/);
  });

  it("without approve permission the credit limit is unknown, never 'aman'", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const tool = fieldSalesTools.find((x) => x.name === "get_field_sales_order_credit")!;
    const lihat = { ...ctx, actor: { ...adminActor, permissions: ["field_sales_orders:view"] } };
    const over = await tool.handler({ docNo: "EVAL-SO-PUTUS-OVER" }, lihat);
    expect(over).toMatchObject({ overLimit: null, exposure: null, limit: null, store: { creditLimit: null } });
    expect((over as { unknown: string[] }).unknown).toContain("over_credit_limit");
    expect((over as { bermasalah: unknown }).bermasalah).not.toBe(false);
    expect(await tool.handler({ docNo: "EVAL-SO-PUTUS-001" }, lihat)).toMatchObject({ bermasalah: "unknown" });
    const admin = await tool.handler({ docNo: "EVAL-SO-PUTUS-OVER" }, ctx);
    expect(admin).toMatchObject({ overLimit: true, bermasalah: true, unknown: [] });
    const clean = await tool.handler({ docNo: "EVAL-SO-PUTUS-001" }, ctx);
    expect(clean).toMatchObject({ overLimit: false, bermasalah: false, reasons: [], unknown: [] });
  });

  it("a name is readable on a record without permission to list people", async (t) => {
    if (!(await evalSeedPresent())) t.skip();
    const { items } = await queryEntity({
      actor: { ...adminActor, permissions: ["field_sales_orders:view"] },
      baseUrl: ctx.baseUrl,
      entity: "field_sales_order",
      where: { orderNo: "EVAL-SO-PUTUS-ODUE" },
      include: { salesman: true, store: true },
      limit: 1,
      offset: 0,
    });
    expect(Object.keys(items[0].salesman as object).sort()).toEqual(["id", "name"]);
    expect(Object.keys(items[0].store as object).sort()).toEqual(["code", "id", "name"]);
  });

  it("an invalid enum value is an input error", async () => {
    await expect(
      queryEntity({
        actor: adminActor,
        baseUrl: ctx.baseUrl,
        entity: "purchase_order",
        where: { status: "NOT_A_STATUS" },
        limit: 1,
        offset: 0,
      }),
    ).rejects.toThrow(/Invalid value/);
  });
});

/** Field and relation names are plain strings, so only a real query proves they match the schema. */
describe("every entity matches the Prisma schema", () => {
  it.each(VIRA_ENTITIES.map((e) => [e.name, e] as const))(
    "%s",
    async (name, e) => {
      const include = Object.fromEntries(e.relations.map((r) => [r.name, true]));
      await queryEntity({ actor: adminActor, baseUrl: ctx.baseUrl, entity: name, include, limit: 1, offset: 0 });
      const { groups } = await aggregateEntity({ actor: adminActor, entity: name, count: true });
      expect(groups).toHaveLength(1);
    },
    30_000,
  );
});
