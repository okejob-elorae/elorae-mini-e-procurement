import type { Prisma, PrismaClient } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";

type Klien = PrismaClient | Prisma.TransactionClient;

/**
 * Akun yang dipetakan ke peran-peran ini — peran yang belum dipetakan TIDAK
 * ada di peta (bukan galat): bacaan pajak yang perannya belum dipetakan
 * memang belum punya baris. Lewat `resolveAccount`, satu pintu yang sama
 * dengan penulis jurnal.
 */
export async function akunPeran(client: Klien, peran: readonly PostingRole[]): Promise<Map<PostingRole, string>> {
  const peta = new Map<PostingRole, string>();
  for (const p of new Set(peran)) {
    try {
      peta.set(p, await resolveAccount(p, client));
    } catch (e) {
      if (!(e instanceof UnmappedRoleError)) throw e;
    }
  }
  return peta;
}
