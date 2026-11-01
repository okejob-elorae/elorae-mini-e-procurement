import type { Prisma, PrismaClient } from "@elorae/db";
import { SUMBER_LAPANGAN, SUMBER_NOTA_LAMA } from "@/lib/finance/lapangan/aturan";
import { SELL_THROUGH_JOURNAL_SOURCE_TYPES } from "@/lib/konsi-sell-through/journal";
import { RECEIVABLE_SOURCE_SELECT, resolveReceivableSource, ReceivableSourceMissingError } from "./receivable-source";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * The receivables account a store invoice's own journal debited — the account every payment against
 * that invoice must credit back, whichever flow records the payment (the office `Payment` receipt,
 * a verified BKM, the return a BKM deducts). Crediting any other account leaves one account
 * negative and the other overstated by the same amount.
 *
 * Every store invoice journal posted today tags its receivable debit with the role's own name as
 * the line memo: AR_STORE for a putus store (the nota journal `FIELD_DELIVERY`, a MANUAL/IMPORT
 * invoice's `STORE_INVOICE`, a completed old-pair revenue half) and AR_CONSIGNMENT for a konsi
 * sell-through report. A journal with no such line is the old shape, which debited AR — the
 * marketplace role — and keeps it: the receivable it booked stays on AR until it is settled.
 */
export type StoreReceivableRole = "AR" | "AR_STORE" | "AR_CONSIGNMENT";

const MEMO_ROLES: readonly StoreReceivableRole[] = ["AR_STORE", "AR_CONSIGNMENT"];

/** The role an invoice journal debited, read off its lines. */
export function debitedReceivableRole(lines: ReadonlyArray<{ memo: string | null; debit: unknown }>): StoreReceivableRole {
  for (const role of MEMO_ROLES) {
    if (lines.some((l) => l.memo === role && Number(l.debit) > 0)) return role;
  }
  return "AR";
}

/**
 * The `sourceType`s an invoice journal stands under, per receivable kind, current shape first. A
 * MANUAL/IMPORT invoice's journal is keyed by the receivable itself, first generation only.
 */
const INVOICE_JOURNAL_SOURCE_TYPES: Record<ReceivableJournalState["kind"], readonly string[]> = {
  DELIVERY: [SUMBER_LAPANGAN.NOTA, SUMBER_NOTA_LAMA.PENDAPATAN],
  SELL_THROUGH: [SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_revenue],
  INVOICE: [SUMBER_LAPANGAN.FAKTUR],
};

export type ReceivableJournalState = {
  kind: "DELIVERY" | "SELL_THROUGH" | "INVOICE";
  /** What the invoice journal is keyed by: the delivery, the report, or the receivable itself. */
  sourceId: string;
  /** The account its invoice journal debited; null while no invoice journal stands. */
  role: StoreReceivableRole | null;
};

/** sourceId → the role its journal debited, preferring the first of `sourceTypes` that stands. */
async function journaledRoles(
  client: AnyClient,
  sourceTypes: readonly string[],
  sourceIds: string[],
): Promise<Map<string, StoreReceivableRole>> {
  const roles = new Map<string, StoreReceivableRole>();
  if (sourceIds.length === 0) return roles;
  const journals = await client.journal.findMany({
    where: { sourceType: { in: [...sourceTypes] }, sourceId: { in: sourceIds } },
    select: { sourceType: true, sourceId: true, lines: { select: { memo: true, debit: true } } },
  });
  const rank = (sourceType: string | null) => sourceTypes.indexOf(sourceType ?? "");
  journals.sort((x, y) => rank(x.sourceType) - rank(y.sourceType));
  for (const j of journals) {
    if (j.sourceId === null || roles.has(j.sourceId)) continue;
    roles.set(j.sourceId, debitedReceivableRole(j.lines));
  }
  return roles;
}

/**
 * Per receivable id: what backs it and the role its invoice journal debited. The source is resolved
 * through `resolveReceivableSource`, never `receivable.delivery`, since a receivable is backed by a
 * putus delivery, a konsi sell-through report, or only its own invoice number. A receivable that
 * resolves to no source (an orphan) is absent from the map.
 *
 * A receivable with no invoice journal (`role: null`) is either still waiting for its journal or
 * predates the ledger, in which case the opening balance carries it on AR_STORE; deciding which is
 * the caller's business.
 */
export async function readReceivableJournalStates(client: AnyClient, receivableIds: string[]): Promise<Map<string, ReceivableJournalState>> {
  const result = new Map<string, ReceivableJournalState>();
  if (receivableIds.length === 0) return result;
  const rows = await client.receivable.findMany({
    where: { id: { in: receivableIds } },
    select: { id: true, ...RECEIVABLE_SOURCE_SELECT },
  });
  const backed: Array<{ id: string; kind: ReceivableJournalState["kind"]; sourceId: string }> = [];
  for (const row of rows) {
    try {
      const source = resolveReceivableSource(row);
      if (source.kind === "DELIVERY") backed.push({ id: row.id, kind: "DELIVERY", sourceId: source.deliveryId });
      else if (source.kind === "SELL_THROUGH") backed.push({ id: row.id, kind: "SELL_THROUGH", sourceId: source.sellThroughId });
      else backed.push({ id: row.id, kind: "INVOICE", sourceId: row.id });
    } catch (e) {
      if (!(e instanceof ReceivableSourceMissingError)) throw e;
    }
  }
  const roleOf = new Map<string, StoreReceivableRole>();
  for (const kind of ["DELIVERY", "SELL_THROUGH", "INVOICE"] as const) {
    const ids = [...new Set(backed.filter((b) => b.kind === kind).map((b) => b.sourceId))];
    for (const [sourceId, role] of await journaledRoles(client, INVOICE_JOURNAL_SOURCE_TYPES[kind], ids)) {
      roleOf.set(`${kind}:${sourceId}`, role);
    }
  }
  for (const b of backed) {
    result.set(b.id, { kind: b.kind, sourceId: b.sourceId, role: roleOf.get(`${b.kind}:${b.sourceId}`) ?? null });
  }
  return result;
}

/**
 * The receivables among `receivableIds` whose invoice journal is the old shape and so sits on AR.
 * Every flow that credits a putus store receivable splits its credit by this set: AR for the part
 * settling one of these, AR_STORE for the rest (a receivable with no invoice journal included,
 * since the opening balance carries it on AR_STORE).
 */
export async function receivablesBookedOnAr(client: AnyClient, receivableIds: string[]): Promise<Set<string>> {
  const states = await readReceivableJournalStates(client, [...new Set(receivableIds)]);
  return new Set([...states].filter(([, s]) => s.role === "AR").map(([id]) => id));
}
