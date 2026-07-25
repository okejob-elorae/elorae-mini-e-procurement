import { prisma } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";

// Test-only support. The DB integration specs share the :3308 dev DB with the running
// ERP UI, and JournalAccountMapping.role is globally unique (one row per role). A spec
// that upserts a role to a throwaway test account and then deletes it would wipe the
// operator's hand-set GL config. Snapshot the affected roles before mutating, restore
// them after: re-point each role to its original account, or delete the row if it had
// none originally. Not imported by app code.

export type MappingSnapshot = Record<string, string | null>;

export async function snapshotMappings(roles: PostingRole[]): Promise<MappingSnapshot> {
  const snapshot: MappingSnapshot = {};
  for (const role of roles) {
    const row = await prisma.journalAccountMapping.findUnique({
      where: { role },
      select: { chartAccountId: true },
    });
    snapshot[role] = row?.chartAccountId ?? null;
  }
  return snapshot;
}

export async function restoreMappings(snapshot: MappingSnapshot): Promise<void> {
  for (const [role, chartAccountId] of Object.entries(snapshot)) {
    if (chartAccountId) {
      await prisma.journalAccountMapping.upsert({
        where: { role: role as PostingRole },
        create: { role: role as PostingRole, chartAccountId },
        update: { chartAccountId },
      });
    } else {
      await prisma.journalAccountMapping.deleteMany({ where: { role: role as PostingRole } });
    }
  }
}
