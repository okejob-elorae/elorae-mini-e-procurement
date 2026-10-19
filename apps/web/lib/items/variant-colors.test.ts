import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { addColorFromItemForm } from "./variant-colors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("addColorFromItemForm (test bed only)", () => {
  let token = "";
  let pantones: { tcx: string; name: string }[] = [];
  const createdIds: string[] = [];
  const seedColor = async (data: { name: string; pantoneTcx?: string; isActive?: boolean }) => {
    const row = await prisma.variantColor.create({ data });
    createdIds.push(row.id);
    return row;
  };

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 8).toUpperCase();
    pantones = await prisma.pantoneColor.findMany({
      where: { variantColors: { none: {} } },
      select: { tcx: true, name: true },
      orderBy: { tcx: "asc" },
      take: 3,
    });
    if (pantones.length < 3) throw new Error("test bed needs 3 Pantone rows without a colour");
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await prisma.variantColor.deleteMany({ where: { id: { in: createdIds.map(seededId) } } });
    }
    createdIds.length = 0;
  });

  it("creates from a Pantone alone, naming it after the Pantone, and reuses it the second time", async () => {
    const first = await addColorFromItemForm({ name: "", pantoneTcx: pantones[0].tcx });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdIds.push(first.color.id);
    expect(first.reused).toBe(false);
    expect(first.color.name).toBe(pantones[0].name);

    const second = await addColorFromItemForm({ name: "", pantoneTcx: pantones[0].tcx });
    expect(second.ok && second.color.id).toBe(first.color.id);
    expect(second.ok && second.reused).toBe(true);
    expect(await prisma.variantColor.count({ where: { pantoneTcx: pantones[0].tcx } })).toBe(1);
  });

  it("reuses a colour by name in another case instead of creating a twin", async () => {
    const army = await seedColor({ name: `Army ${token}` });
    const out = await addColorFromItemForm({ name: `army ${token.toLowerCase()}` });
    expect(out.ok && out.color.id).toBe(army.id);
    expect(await prisma.variantColor.count({ where: { name: { contains: token } } })).toBe(1);
  });

  it("keeps the typed name and the item's spelling as aliases when reusing by Pantone", async () => {
    const navy = await seedColor({ name: `Navy ${token}`, pantoneTcx: pantones[1].tcx });
    const out = await addColorFromItemForm({
      name: `Dark Navy ${token}`,
      pantoneTcx: pantones[1].tcx,
      alias: `DkNavy ${token}`,
    });
    expect(out.ok && out.color.id).toBe(navy.id);
    expect(out.ok && [...out.color.aliases].sort()).toEqual([`Dark Navy ${token}`, `DkNavy ${token}`]);
  });

  it("links the Pantone to a reused colour that had none", async () => {
    const olive = await seedColor({ name: `Olive ${token}` });
    const out = await addColorFromItemForm({ name: `Olive ${token}`, pantoneTcx: pantones[2].tcx });
    expect(out.ok && out.color.id).toBe(olive.id);
    expect(out.ok && out.color.pantone?.tcx).toBe(pantones[2].tcx);
  });

  it("stores the item's spelling as an alias on a new colour", async () => {
    const out = await addColorFromItemForm({ name: `Teal ${token}`, alias: `Tosca ${token}` });
    if (out.ok) createdIds.push(out.color.id);
    expect(out.ok && out.color.aliases).toEqual([`Tosca ${token}`]);
  });

  it("refuses an inactive match and an empty request", async () => {
    await seedColor({ name: `Old ${token}`, isActive: false });
    expect(await addColorFromItemForm({ name: `Old ${token}` })).toMatchObject({ ok: false });
    expect(await addColorFromItemForm({ name: "  ", pantoneTcx: null })).toMatchObject({ ok: false });
  });
});
