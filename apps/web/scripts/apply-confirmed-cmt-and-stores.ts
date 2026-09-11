/**
 * One-shot: apply client-confirmed CMT vendors + toko (stores).
 *
 * CMT (TAILOR suppliers): Best Garment, Mantap Jaya, Raindo
 * Stores: AWW CANGKRING, GARDENA, RITA MALL, ROXY BANYUWANGI, ROXY SITUBONDO
 *
 * Usage (from apps/web):
 *   pnpm exec tsx scripts/apply-confirmed-cmt-and-stores.ts --confirm-prod-writes
 */
import "dotenv/config";
import type { PrismaClient } from "@elorae/db";

const confirm = process.argv.includes("--confirm-prod-writes");
const dryRun = !process.argv.includes("--apply");

const CMT_VENDORS = [
  { excelName: "BEST GARMENT", canonicalName: "Best Garment" },
  { excelName: "MANTAP JAYA", canonicalName: "Mantap Jaya" },
  { excelName: "RAINDO", canonicalName: "Raindo" },
] as const;

const STORES = [
  { name: "AWW CANGKRING", code: "TOK-AWW-CANGKRING" },
  { name: "GARDENA", code: "TOK-GARDENA" },
  { name: "RITA MALL", code: "TOK-RITA-MALL" },
  { name: "ROXY BANYUWANGI", code: "TOK-ROXY-BANYUWANGI" },
  { name: "ROXY SITUBONDO", code: "TOK-ROXY-SITUBONDO" },
] as const;

function assertApplyAllowed(url: string): void {
  if (/:3308(\/|$)/.test(url)) return;
  if (/:(3306|3307)(\/|$)/.test(url)) {
    if (!confirm) {
      throw new Error(
        "Refusing write: prod-tunnel URL. Pass --confirm-prod-writes (and --apply).",
      );
    }
    console.warn("WARNING: writing against prod-tunnel DATABASE_URL.");
    return;
  }
  if (!confirm) {
    throw new Error("Refusing write: not local testbed. Pass --confirm-prod-writes.");
  }
}

function slugSupplierCode(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `LEG-CMT-${base || "SUP"}`;
}

async function findSupplierByName(prisma: PrismaClient, name: string) {
  const all = await prisma.supplier.findMany({
    select: { id: true, code: true, name: true, status: true },
  });
  return all.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
}

async function upsertTailor(
  prisma: PrismaClient,
  canonicalName: string,
  typeId: string,
): Promise<{ code: string; created: boolean }> {
  const existing = await findSupplierByName(prisma, canonicalName);
  if (existing) {
    await prisma.supplier.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", isActive: true, approvedAt: new Date(), typeId },
    });
    return { code: existing.code, created: false };
  }

  let code = slugSupplierCode(canonicalName);
  const codeClash = await prisma.supplier.findUnique({ where: { code } });
  if (codeClash) code = `${code}-01`;

  const row = await prisma.supplier.create({
    data: {
      code,
      name: canonicalName,
      typeId,
      status: "ACTIVE",
      isActive: true,
      approvedAt: new Date(),
    },
  });
  return { code: row.code, created: true };
}

async function upsertStore(
  prisma: PrismaClient,
  name: string,
  code: string,
): Promise<{ code: string; created: boolean }> {
  const byCode = await prisma.store.findUnique({ where: { code } });
  if (byCode) return { code: byCode.code, created: false };

  const byName = (
    await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
    })
  ).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (byName) return { code: byName.code, created: false };

  await prisma.store.create({
    data: {
      code,
      name,
      // Address unknown from Excel — placeholder until client fills real address
      address: "TBD — legacy import from LAIN-LAIN (address pending)",
      termsType: "PUTUS",
      paymentTempo: 0,
      marginPercent: null,
      isActive: true,
    },
  });
  return { code, created: true };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? "DRY-RUN (pass --apply to write)" : "APPLY"}`);
  console.log(
    `DB: ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`,
  );

  if (!dryRun) assertApplyAllowed(process.env.DATABASE_URL);

  const { prisma } = await import("@elorae/db");

  try {
    const tailorType =
      (await prisma.supplierType.findUnique({ where: { code: "TAILOR" } })) ??
      (await prisma.supplierType.create({
        data: {
          code: "TAILOR",
          name: "Tailor/Production",
          isActive: true,
          sortOrder: 3,
        },
      }));
    console.log(`SupplierType TAILOR id=${tailorType.id}`);

    console.log("\n=== CMT vendors (TAILOR) ===");
    for (const v of CMT_VENDORS) {
      if (dryRun) {
        const hit = await findSupplierByName(prisma, v.canonicalName);
        console.log(
          hit
            ? `  EXISTS  ${v.canonicalName} → ${hit.code} (${hit.status})`
            : `  WOULD_CREATE  ${v.canonicalName} (from excel ${v.excelName})`,
        );
        continue;
      }
      const r = await upsertTailor(prisma, v.canonicalName, tailorType.id);
      console.log(
        r.created
          ? `  CREATED  ${v.canonicalName} → ${r.code}`
          : `  EXISTS   ${v.canonicalName} → ${r.code} (ensured ACTIVE)`,
      );
    }

    console.log("\n=== Toko (Store) ===");
    for (const s of STORES) {
      if (dryRun) {
        const hit = (
          await prisma.store.findMany({ select: { code: true, name: true } })
        ).find((x) => x.name.trim().toLowerCase() === s.name.toLowerCase() || x.code === s.code);
        console.log(
          hit
            ? `  EXISTS  ${s.name} → ${hit.code}`
            : `  WOULD_CREATE  ${s.name} → ${s.code} (PUTUS, address TBD)`,
        );
        continue;
      }
      const r = await upsertStore(prisma, s.name, s.code);
      console.log(
        r.created
          ? `  CREATED  ${s.name} → ${r.code}`
          : `  EXISTS   ${s.name} → ${r.code}`,
      );
    }

    if (dryRun) {
      console.log("\nRe-run with: pnpm exec tsx scripts/apply-confirmed-cmt-and-stores.ts --apply --confirm-prod-writes");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
