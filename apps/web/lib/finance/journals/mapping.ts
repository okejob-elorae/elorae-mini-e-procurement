import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export class UnmappedRoleError extends Error {
  constructor(public role: string) {
    super(`No account mapped for posting role "${role}"`);
    this.name = "UnmappedRoleError";
  }
}

export type AccountMappingRow = {
  role: PostingRole;
  chartAccountId: string | null;
  accountCode: string | null;
  accountName: string | null;
};

export async function resolveAccount(role: PostingRole, client: AnyClient = prisma): Promise<string> {
  const mapping = await client.journalAccountMapping.findUnique({ where: { role } });
  if (!mapping) throw new UnmappedRoleError(role);
  return mapping.chartAccountId;
}

export async function listAccountMappings(): Promise<AccountMappingRow[]> {
  const mappings = await prisma.journalAccountMapping.findMany({
    include: { account: { select: { code: true, name: true } } },
  });
  const byRole = new Map(mappings.map((m) => [m.role, m]));
  return POSTING_ROLES.map((role) => {
    const mapping = byRole.get(role);
    return {
      role,
      chartAccountId: mapping?.chartAccountId ?? null,
      accountCode: mapping?.account.code ?? null,
      accountName: mapping?.account.name ?? null,
    };
  });
}

export async function setAccountMapping(
  role: PostingRole,
  chartAccountId: string,
  client: AnyClient = prisma,
): Promise<void> {
  await client.journalAccountMapping.upsert({
    where: { role },
    create: { role, chartAccountId },
    update: { chartAccountId },
  });
}
