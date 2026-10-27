import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createRequestFromWo, cancelRequestLines, convertLinesToPo } from "./mutations";
import { deriveRequestStatus } from "./status";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

describe("deriveRequestStatus", () => {
  it.each([
    [["OPEN", "CONVERTED"], "OPEN"],
    [["CONVERTED", "CANCELLED"], "CONVERTED"],
    [["CANCELLED", "CANCELLED"], "CANCELLED"],
    [["CONVERTED"], "CONVERTED"],
  ] as const)("%j -> %s", (lines, expected) => {
    expect(deriveRequestStatus([...lines])).toBe(expected);
  });
});

d("Request Item writers (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", uom: "", fg: "", fabric: "", button: "", wo: "" };

  beforeEach(async () => {
    tag = `IRQ${Math.floor(Math.random() * 10_000_000)}`;
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Test Admin" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Test Type" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Test CMT", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "meter", nameEn: "meter" } })).id;
    const item = (sku: string, type: "FINISHED_GOOD" | "FABRIC" | "ACCESSORIES") =>
      prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: `${sku} ${tag}`, nameEn: sku, type, uomId: ids.uom, isActive: true } });
    ids.fg = (await item("FG", "FINISHED_GOOD")).id;
    ids.fabric = (await item("FAB", "FABRIC")).id;
    ids.button = (await item("BTN", "ACCESSORIES")).id;
    // No stock for either material, so a 10-piece WO is short 15 m fabric and 40 buttons.
    await prisma.consumptionRule.create({ data: { finishedGoodId: ids.fg, materialId: ids.fabric, qtyRequired: 1.5 } });
    await prisma.consumptionRule.create({ data: { finishedGoodId: ids.fg, materialId: ids.button, qtyRequired: 4 } });
    ids.wo = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-${tag}`,
          vendorId: ids.supplier,
          finishedGoodId: ids.fg,
          plannedQty: 10,
          consumptionPlan: [],
          createdById: ids.user,
        },
      })
    ).id;
  });

  afterEach(async () => {
    // seededId refuses an unset id, so a failed fixture hook cannot turn these into whole-table deletes.
    if (ids.wo) {
      const poIds = (await prisma.itemRequestLine.findMany({ where: { request: { sourceWoId: seededId(ids.wo) } }, select: { poId: true } }))
        .map((l) => l.poId)
        .filter((id): id is string => !!id);
      await prisma.itemRequestLine.deleteMany({ where: { request: { sourceWoId: seededId(ids.wo) } } });
      await prisma.itemRequest.deleteMany({ where: { sourceWoId: seededId(ids.wo) } });
      if (poIds.length > 0) {
        await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: poIds.map(seededId) } } });
        await prisma.pOItem.deleteMany({ where: { poId: { in: poIds.map(seededId) } } });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds.map(seededId) } } });
      }
      await prisma.workOrder.deleteMany({ where: { id: seededId(ids.wo) } });
    }
    if (ids.fg) await prisma.consumptionRule.deleteMany({ where: { finishedGoodId: seededId(ids.fg) } });
    const itemIds = [ids.fg, ids.fabric, ids.button].filter(Boolean);
    if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds.map(seededId) } } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: seededId(ids.supplier) } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  async function linesOf(requestId: string) {
    return prisma.itemRequestLine.findMany({ where: { requestId }, orderBy: { qty: "asc" } });
  }

  it("raises one request with a line per short material, and returns it again on a second call", async () => {
    const first = await createRequestFromWo(ids.wo, ids.user);
    expect(first.created).toBe(true);
    expect(first.docNumber).toMatch(/^REQ\//);
    const lines = await linesOf(first.id);
    expect(lines.map((l) => [l.itemId, Number(l.qty), l.status])).toEqual([
      [ids.fabric, 15, "OPEN"],
      [ids.button, 40, "OPEN"],
    ]);

    const second = await createRequestFromWo(ids.wo, ids.user);
    expect(second).toEqual({ id: first.id, docNumber: first.docNumber, created: false });
  });

  it("refuses a work order that is no longer DRAFT", async () => {
    await prisma.workOrder.update({ where: { id: ids.wo }, data: { status: "ISSUED" } });
    await expect(createRequestFromWo(ids.wo, ids.user)).rejects.toThrow("berstatus DRAFT");
  });

  it("converts open lines into one DRAFT PO, links each line, and refuses a second conversion", async () => {
    const req = await createRequestFromWo(ids.wo, ids.user);
    const lines = await linesOf(req.id);
    const prices = Object.fromEntries(lines.map((l) => [l.id, l.itemId === ids.fabric ? 45_000 : 500]));

    const po = await convertLinesToPo({ lineIds: lines.map((l) => l.id), supplierId: ids.supplier, prices }, ids.user);

    const created = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
    expect(created.status).toBe("DRAFT");
    expect(created.items).toHaveLength(2);
    const after = await linesOf(req.id);
    expect(after.every((l) => l.status === "CONVERTED" && l.poId === po.id && l.poItemId)).toBe(true);
    const byItem = new Map(created.items.map((i) => [i.id, i]));
    for (const l of after) expect(byItem.get(l.poItemId!)?.itemId).toBe(l.itemId);
    expect((await prisma.itemRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONVERTED");

    await expect(
      convertLinesToPo({ lineIds: [after[0].id], supplierId: ids.supplier, prices }, ids.user)
    ).rejects.toThrow("sudah diproses");
  });

  it("cancels some lines, keeps the request open, and closes it once every line is done", async () => {
    const req = await createRequestFromWo(ids.wo, ids.user);
    const [fabric, button] = await linesOf(req.id);

    await cancelRequestLines([fabric.id]);
    expect((await prisma.itemRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");

    await convertLinesToPo({ lineIds: [button.id], supplierId: ids.supplier, prices: { [button.id]: 500 } }, ids.user);
    expect((await prisma.itemRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONVERTED");

    await expect(cancelRequestLines([button.id])).rejects.toThrow("sudah diproses");
  });
});
