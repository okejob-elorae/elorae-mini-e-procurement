import { prisma } from "@elorae/db";
import {
  buildColorIndex,
  colorMatchKey,
  resolveVariantAxes,
  type ColorIndex,
} from "@elorae/db/variant-axes";
import { parseItemVariants } from "@/lib/items/variants";

/** Colour master (#437): one row per finished-good colour, its Pantone link and its spellings. */

export async function loadColorIndex(): Promise<ColorIndex> {
  const colors = await prisma.variantColor.findMany({
    select: { id: true, name: true, aliases: { select: { label: true } } },
  });
  return buildColorIndex(colors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases.map((a) => a.label) })));
}

export type VariantColorRow = {
  id: string;
  name: string;
  isActive: boolean;
  pantone: { tcx: string; name: string; hex: string } | null;
  aliases: string[];
  itemCount: number;
  variantCount: number;
  ruleCount: number;
};

export type UnresolvedColorRow = { label: string; itemCount: number; variantCount: number; sampleSkus: string[] };

/** Every colour with how many FG variants resolve to it, plus the variant colour texts that resolve to none. */
export async function listVariantColors(): Promise<{ colors: VariantColorRow[]; unresolved: UnresolvedColorRow[] }> {
  const [colors, items, ruleCounts] = await Promise.all([
    prisma.variantColor.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        pantone: { select: { tcx: true, name: true, hex: true } },
        aliases: { select: { label: true }, orderBy: { label: "asc" } },
      },
    }),
    prisma.item.findMany({ where: { type: "FINISHED_GOOD" }, select: { id: true, variants: true } }),
    prisma.consumptionRule.groupBy({ by: ["colorId"], where: { colorId: { not: null } }, _count: { _all: true } }),
  ]);
  const index = buildColorIndex(colors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases.map((a) => a.label) })));

  const usage = new Map<string, { items: Set<string>; variants: number }>();
  const unresolved = new Map<string, { label: string; items: Set<string>; variants: number; skus: string[] }>();
  for (const item of items) {
    for (const v of parseItemVariants(item.variants)) {
      const axes = resolveVariantAxes(v, index);
      if (axes.colorId) {
        const u = usage.get(axes.colorId) ?? { items: new Set<string>(), variants: 0 };
        u.items.add(item.id);
        u.variants += 1;
        usage.set(axes.colorId, u);
      } else if (axes.colorLabel) {
        const key = colorMatchKey(axes.colorLabel);
        const u = unresolved.get(key) ?? { label: axes.colorLabel, items: new Set<string>(), variants: 0, skus: [] };
        u.items.add(item.id);
        u.variants += 1;
        if (u.skus.length < 3 && v.sku) u.skus.push(v.sku);
        unresolved.set(key, u);
      }
    }
  }
  const rulesByColor = new Map(ruleCounts.map((r) => [r.colorId, r._count._all]));

  return {
    colors: colors.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      pantone: c.pantone,
      aliases: c.aliases.map((a) => a.label),
      itemCount: usage.get(c.id)?.items.size ?? 0,
      variantCount: usage.get(c.id)?.variants ?? 0,
      ruleCount: rulesByColor.get(c.id) ?? 0,
    })),
    unresolved: [...unresolved.values()]
      .sort((a, b) => b.variants - a.variants)
      .map((u) => ({ label: u.label, itemCount: u.items.size, variantCount: u.variants, sampleSkus: u.skus })),
  };
}

export type VariantColorInput = {
  name: string;
  pantoneTcx?: string | null;
  aliases?: string[];
  isActive?: boolean;
};

export class VariantColorError extends Error {}

/**
 * Create (id null) or update a colour and replace its aliases. Refuses a name or alias that,
 * under colorMatchKey, is already another colour's name or alias — one spelling, one colour.
 */
export async function saveVariantColor(id: string | null, input: VariantColorInput) {
  const name = input.name.trim();
  if (!name) throw new VariantColorError("Nama warna wajib diisi");
  const pantoneTcx = input.pantoneTcx?.trim() || null;
  const nameKey = colorMatchKey(name);
  const aliasByKey = new Map<string, string>();
  for (const raw of input.aliases ?? []) {
    const label = raw.trim();
    const key = colorMatchKey(label);
    if (key && key !== nameKey && !aliasByKey.has(key)) aliasByKey.set(key, label);
  }

  return prisma.$transaction(async (tx) => {
    if (pantoneTcx && !(await tx.pantoneColor.findUnique({ where: { tcx: pantoneTcx }, select: { tcx: true } }))) {
      throw new VariantColorError(`Kode Pantone ${pantoneTcx} tidak ditemukan`);
    }
    const others = await tx.variantColor.findMany({
      where: id ? { id: { not: id } } : {},
      select: { name: true, aliases: { select: { label: true } } },
    });
    const taken = new Map<string, string>();
    for (const o of others) {
      for (const text of [o.name, ...o.aliases.map((a) => a.label)]) taken.set(colorMatchKey(text), o.name);
    }
    for (const [key, label] of [[nameKey, name] as const, ...aliasByKey]) {
      const owner = taken.get(key);
      if (owner) throw new VariantColorError(`Ejaan "${label}" sudah dipakai warna "${owner}"`);
    }

    const data = { name, pantoneTcx, ...(input.isActive != null ? { isActive: input.isActive } : {}) };
    const color = id
      ? await tx.variantColor.update({ where: { id }, data })
      : await tx.variantColor.create({ data });
    await tx.variantColorAlias.deleteMany({ where: { colorId: color.id } });
    if (aliasByKey.size > 0) {
      await tx.variantColorAlias.createMany({
        data: [...aliasByKey].map(([matchKey, label]) => ({ matchKey, label, colorId: color.id })),
      });
    }
    return { id: color.id };
  });
}
