/**
 * Seed the finished-good colour master and normalise variant axis keys (#437).
 *
 * 1. Renames each FG variant's colour/size keys to `Warna`/`Ukuran` (`color`, `Size`, … — the
 *    Jubelio catalog ingest does the same from now on). Values and SKUs are untouched, and
 *    nothing is pushed to Jubelio.
 * 2. Creates one VariantColor per distinct variant colour, merging case variants and the known
 *    typos (`KNOWN_COLOR_TYPOS`) as aliases. A colour that already exists keeps its name and
 *    Pantone link and only gains the missing spellings.
 * 3. Lists every variant that still has no resolvable colour or no size. Those are not guessed.
 *
 * Usage (from apps/web):
 *   pnpm variants:colors                                  # dry-run
 *   pnpm variants:colors -- --apply                       # local testbed (:3308)
 *   pnpm variants:colors -- --apply --confirm-prod-writes # prod tunnel
 */
import "dotenv/config";
import { buildColorIndex, colorMatchKey, normalizeVariantAxisKeys, resolveVariantAxes } from "@elorae/db/variant-axes";
import { groupColorLabels } from "../lib/items/variant-color-seed";

function assertApplyAllowed(url: string, confirm: boolean): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (!confirm) throw new Error("Refusing --apply: not local testbed (:3308). Pass --confirm-prod-writes.");
  console.warn("WARNING: seeding variant colours against a non-testbed DATABASE_URL.");
}

type Variant = Record<string, string>;

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (apply) assertApplyAllowed(url, process.argv.includes("--confirm-prod-writes"));

  const { prisma } = await import("@elorae/db");
  const { saveVariantColor } = await import("../lib/items/variant-colors");
  try {
    const items = await prisma.item.findMany({
      where: { type: "FINISHED_GOOD" },
      select: { id: true, sku: true, variants: true },
      orderBy: { sku: "asc" },
    });

    // 1. Axis keys.
    const normalized = items.map((item) => {
      const before = Array.isArray(item.variants) ? (item.variants as Variant[]) : [];
      const after = before.map((v) => normalizeVariantAxisKeys(v));
      return { ...item, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
    });
    const keyChanges = normalized.filter((i) => i.changed);
    console.log(`Axis keys: ${keyChanges.length} item(s) to normalise: ${keyChanges.map((i) => i.sku).join(", ") || "-"}`);

    // 2. Colour master.
    const counts = new Map<string, number>();
    for (const item of normalized) {
      for (const v of item.after) {
        const label = resolveVariantAxes(v, new Map()).colorLabel;
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    const groups = groupColorLabels(counts);
    const existing = await prisma.variantColor.findMany({
      select: { id: true, name: true, pantoneTcx: true, aliases: { select: { label: true } } },
    });
    const existingIndex = buildColorIndex(existing.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases.map((a) => a.label) })));
    const plan: Array<{ id: string | null; name: string; pantoneTcx: string | null; aliases: string[]; added: string[] }> = [];
    for (const g of groups) {
      const hitId = [g.name, ...g.aliases].map((t) => existingIndex.get(colorMatchKey(t))).find(Boolean) ?? null;
      const hit = hitId ? existing.find((c) => c.id === hitId)! : null;
      const have = hit ? hit.aliases.map((a) => a.label) : [];
      const resolvesToHit = (t: string) => hit != null && existingIndex.get(colorMatchKey(t)) === hit.id;
      const added = (hit ? [g.name, ...g.aliases] : g.aliases).filter((t) => !resolvesToHit(t));
      if (hit && added.length === 0) continue;
      plan.push({ id: hit?.id ?? null, name: hit?.name ?? g.name, pantoneTcx: hit?.pantoneTcx ?? null, aliases: [...have, ...added], added });
    }
    for (const p of plan) {
      console.log(`${p.id ? "update" : "create"} ${p.name}${p.added.length ? `  aliases +[${p.added.join(", ")}]` : ""}`);
    }
    console.log(`Colours: ${plan.filter((p) => !p.id).length} to create, ${plan.filter((p) => p.id).length} to extend.`);

    if (apply) {
      for (const item of keyChanges) {
        await prisma.item.update({ where: { id: item.id }, data: { variants: item.after } });
      }
      for (const p of plan) {
        await saveVariantColor(p.id, { name: p.name, pantoneTcx: p.pantoneTcx, aliases: p.aliases });
      }
      console.log("Applied.");
    }

    // 3. What still does not resolve (after the planned colours exist).
    const finalColors = apply
      ? await prisma.variantColor.findMany({ select: { id: true, name: true, aliases: { select: { label: true } } } })
      : [
          ...existing,
          ...plan.filter((p) => !p.id).map((p, i) => ({ id: `new-${i}`, name: p.name, aliases: p.aliases.map((label) => ({ label })) })),
        ];
    const index = buildColorIndex(finalColors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases.map((a) => a.label) })));
    let total = 0;
    const unresolved: string[] = [];
    for (const item of normalized) {
      for (const v of item.after) {
        total += 1;
        const axes = resolveVariantAxes(v, index);
        if (!axes.colorId || !axes.size) {
          unresolved.push(`${item.sku}  ${v.sku ?? "?"}  colour=${axes.colorLabel ?? "-"}${axes.colorLabel && !axes.colorId ? " (unknown)" : ""}  size=${axes.size ?? "-"}`);
        }
      }
    }
    console.log(`Variants: ${total - unresolved.length}/${total} resolve to one colour and one size.`);
    for (const line of unresolved) console.log(`  unresolved: ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
