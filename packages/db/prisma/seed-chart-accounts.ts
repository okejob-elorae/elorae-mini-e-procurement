import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "../generated/prisma/client";

type SeedAccount = {
  code: string;
  name: string;
  type: "ASET" | "LIABILITAS" | "EKUITAS" | "PENDAPATAN" | "HPP" | "BEBAN";
};
type SeedFile = { version: string; accounts: SeedAccount[] };

const DEFAULT_PATH = path.join(__dirname, "seeds", "coa-sak-emkm.json");

function validate(file: SeedFile): void {
  const seen = new Set<string>();
  for (const a of file.accounts) {
    if (seen.has(a.code)) throw new Error(`Duplicate code in seed: ${a.code}`);
    seen.add(a.code);
    if (!/^[0-9]+$/.test(a.code)) throw new Error(`Invalid code format (digits only): ${a.code}`);
    if (a.code.length > 8) throw new Error(`Code too long: ${a.code}`);
  }
}

function inferParentCode(code: string, all: Set<string>): string | null {
  for (let i = code.length - 1; i > 0; i--) {
    const candidate = code.slice(0, i);
    if (all.has(candidate)) return candidate;
  }
  return null;
}

export async function seedChartAccounts(
  prisma: PrismaClient,
  override?: { accounts: SeedAccount[] },
): Promise<{ created: number; updated: number }> {
  const file: SeedFile = override
    ? { version: "override", accounts: override.accounts }
    : (JSON.parse(fs.readFileSync(DEFAULT_PATH, "utf8")) as SeedFile);

  validate(file);

  const sorted = [...file.accounts].sort(
    (a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code),
  );
  const codeSet = new Set(sorted.map((a) => a.code));

  let created = 0;
  let updated = 0;

  for (const account of sorted) {
    const parentCode = inferParentCode(account.code, codeSet);
    let parentId: string | null = null;
    let depth = 1;

    if (parentCode) {
      const parent = await prisma.chartAccount.findUnique({ where: { code: parentCode } });
      if (!parent) throw new Error(`Parent code ${parentCode} not found while seeding ${account.code}`);
      parentId = parent.id;
      depth = parent.depth + 1;
    }

    const existing = await prisma.chartAccount.findUnique({ where: { code: account.code } });

    if (existing) {
      await prisma.chartAccount.update({
        where: { id: existing.id },
        data: { name: account.name, type: account.type, parentId, depth },
      });
      updated++;
    } else {
      await prisma.chartAccount.create({
        data: { code: account.code, name: account.name, type: account.type, parentId, depth, isActive: true },
      });
      created++;
    }
  }

  return { created, updated };
}
