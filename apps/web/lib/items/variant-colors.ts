import { Prisma, prisma } from "@elorae/db";
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

export const colorOptionSelect = {
  id: true,
  name: true,
  isActive: true,
  aliases: { select: { label: true } },
  pantone: { select: { tcx: true, hex: true } },
} as const satisfies Prisma.VariantColorSelect;

export type VariantColorOption = {
  id: string;
  name: string;
  aliases: string[];
  pantone: { tcx: string; hex: string } | null;
};

export function withHash(hex: string): string {
  return hex.startsWith("#") ? hex : `#${hex}`;
}

export function toColorOption(c: Prisma.VariantColorGetPayload<{ select: typeof colorOptionSelect }>): VariantColorOption {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases.map((a) => a.label),
    pantone: c.pantone ? { tcx: c.pantone.tcx, hex: withHash(c.pantone.hex) } : null,
  };
}

export type AddColorInput = {
  name: string;
  pantoneTcx?: string | null;
  /** Spelling already on the item (an unmatched colour), kept as an alias so its variants resolve. */
  alias?: string | null;
};

export type AddColorResult =
  | { ok: true; color: VariantColorOption; reused: boolean }
  | { ok: false; error: string };

/**
 * Add a colour from the item form: a name, a Pantone, or both. A Pantone already linked to a
 * colour, or a name already spelled by one, reuses that colour: the typed name and the item's
 * spelling become its aliases (so the item's variants keep resolving), and a reused colour with
 * no Pantone takes the one given. An inactive match is refused rather than silently reused.
 */
export async function addColorFromItemForm(input: AddColorInput, retried = false): Promise<AddColorResult> {
  const pantoneTcx = input.pantoneTcx?.trim() || null;
  let name = input.name.trim();
  const alias = input.alias?.trim() || null;
  if (!name && !pantoneTcx) return { ok: false, error: "Type a colour name or choose a Pantone" };
  if (!name && pantoneTcx) {
    name = (await prisma.pantoneColor.findUnique({ where: { tcx: pantoneTcx }, select: { name: true } }))?.name ?? "";
    if (!name) return { ok: false, error: `Kode Pantone ${pantoneTcx} tidak ditemukan` };
  }

  const index = await loadColorIndex();
  const byPantone = pantoneTcx
    ? await prisma.variantColor.findFirst({ where: { pantoneTcx }, select: colorOptionSelect })
    : null;
  const byNameId = index.get(colorMatchKey(name));
  const match =
    byPantone ??
    (byNameId ? await prisma.variantColor.findUniqueOrThrow({ where: { id: byNameId }, select: colorOptionSelect }) : null);

  try {
    if (!match) {
      const saved = await saveVariantColor(null, { name, pantoneTcx, aliases: alias ? [alias] : [] });
      const color = await prisma.variantColor.findUniqueOrThrow({ where: { id: saved.id }, select: colorOptionSelect });
      return { ok: true, color: toColorOption(color), reused: false };
    }
    if (!match.isActive) {
      return { ok: false, error: `Warna "${match.name}" tidak aktif; aktifkan di Production → Colors` };
    }
    // Spellings no colour claims yet join the reused colour; one claimed by another colour is left alone.
    const newAliases = [name, alias].filter(
      (t): t is string => !!t && colorMatchKey(t) !== colorMatchKey(match.name) && !index.has(colorMatchKey(t))
    );
    const linkPantone = pantoneTcx && !match.pantone;
    if (newAliases.length > 0 || linkPantone) {
      await saveVariantColor(match.id, {
        name: match.name,
        pantoneTcx: linkPantone ? pantoneTcx : match.pantone?.tcx ?? null,
        aliases: [...match.aliases.map((a) => a.label), ...newAliases],
      });
    }
    const color = await prisma.variantColor.findUniqueOrThrow({ where: { id: match.id }, select: colorOptionSelect });
    return { ok: true, color: toColorOption(color), reused: true };
  } catch (err) {
    if (err instanceof VariantColorError) return { ok: false, error: err.message };
    // A concurrent add of the same spelling won the unique index; look again and reuse it.
    if (!retried && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return addColorFromItemForm(input, true);
    }
    throw err;
  }
}
