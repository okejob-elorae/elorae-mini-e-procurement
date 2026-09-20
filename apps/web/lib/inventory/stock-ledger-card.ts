import { prisma, Prisma, STOCK_LEDGER_REF_TYPES, type StockLedgerRefType } from "@elorae/db";
import { isCeilingReached, LEDGER_ORDER_BY, LEDGER_ROW_SELECT } from "./ledger-query";

export type LedgerLocationType = "MAIN" | "STORE" | "VAN";

export type RawLedgerRow = {
  id: string;
  locationType: LedgerLocationType;
  locationId: string;
  variantSku: string;
  /* refType is a free-form string that can hold values the registry does not know —
     a fixture row, or one written by a future writer before its registry entry lands.
     This layer carries what is there; narrowing happens where rendered via
     isStockLedgerRefType with fallback to raw value. Same rule as unresolved locationId:
     render what you have, never drop, never throw. */
  refType: string;
  refId: string;
  refDocNumber: string;
  qty: number;
  balanceQty: number;
  unitCost: number | null;
  createdById: string | null;
  createdAt: Date;
};

export type LedgerLabels = {
  stores: Map<string, string>;
  users: Map<string, string>;
};

export type LedgerEntryRow = Omit<RawLedgerRow, "locationType" | "locationId" | "variantSku">;

export type LedgerSection = {
  locationType: LedgerLocationType;
  locationId: string;
  locationLabel: string;
  locationResolved: boolean;
  variantSku: string;
  closingBalance: number;
  entries: LedgerEntryRow[];
  truncated: boolean;
};

const LOCATION_ORDER: Record<LedgerLocationType, number> = { MAIN: 0, STORE: 1, VAN: 2 };

function resolveLabel(row: RawLedgerRow, labels: LedgerLabels): { label: string; resolved: boolean } {
  if (row.locationType === "MAIN") return { label: "MAIN", resolved: true };
  const source = row.locationType === "STORE" ? labels.stores : labels.users;
  const found = source.get(row.locationId);
  /* An unresolved id is a deleted store or user. relationMode = "prisma" means no FK,
     so orphaned entries are genuinely reachable and history must outlive its subject —
     render the raw id rather than dropping the section or throwing. */
  return found ? { label: found, resolved: true } : { label: row.locationId, resolved: false };
}

export function groupLedgerEntries(rows: RawLedgerRow[], labels: LedgerLabels): LedgerSection[] {
  const byKey = new Map<string, LedgerSection>();

  for (const r of rows) {
    const key = `${r.locationType}\u0000${r.locationId}\u0000${r.variantSku}`;
    let section = byKey.get(key);
    if (!section) {
      const { label, resolved } = resolveLabel(r, labels);
      section = {
        locationType: r.locationType,
        locationId: r.locationId,
        locationLabel: label,
        locationResolved: resolved,
        variantSku: r.variantSku,
        closingBalance: 0,
        entries: [],
        truncated: false,
      };
      byKey.set(key, section);
    }
    const { locationType: _lt, locationId: _li, variantSku: _vs, ...entry } = r;
    section.entries.push(entry);
  }

  const sections = [...byKey.values()];

  for (const s of sections) {
    s.entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    /* Closing balance is READ off the last entry, never summed: balanceQty is what the
       mover wrote from its own atomic update, and a window that starts mid-history has
       no earlier rows to sum from. */
    s.closingBalance = s.entries.length === 0 ? 0 : s.entries[s.entries.length - 1].balanceQty;
  }

  sections.sort(
    (a, b) =>
      LOCATION_ORDER[a.locationType] - LOCATION_ORDER[b.locationType] ||
      a.locationLabel.localeCompare(b.locationLabel) ||
      a.variantSku.localeCompare(b.variantSku) ||
      /* Two different locations can share a label (two stores with the same name) and the
         same variant — without this, order falls out of Map insertion order and produces
         two visually identical section headers with nothing distinguishing them on screen. */
      a.locationId.localeCompare(b.locationId),
  );

  return sections;
}

export type ItemMovementCardInput = {
  itemId: string;
  variantSku?: string;
  from?: Date;
  to?: Date;
  refTypes?: StockLedgerRefType[];
  /*
   * A SEPARATE flag, never a sentinel folded into `refTypes` — a sentinel string
   * travelling inside an `in`/`notIn` array can leak straight through into the SQL list
   * if any later code forgets to strip it first; a boolean cannot. See
   * buildRefTypeCondition for how the two combine.
   */
  includeUnregisteredRefTypes?: boolean;
  locationTypes?: LedgerLocationType[];
};

export type ItemMovementCard = {
  sections: LedgerSection[];
  hasAnyHistory: boolean;
  sectionLimit: number;
  /*
   * True when the QUERY-level ceiling was reached: this item's history is cut off entirely
   * and the oldest end is missing, regardless of what any individual section's own
   * `truncated` flag says. A section at its own SECTION_ENTRY_LIMIT means "this location has
   * more movements than we show"; this means "this item's history is cut off, full stop" —
   * a section spread thin enough (five sections of 400 each, under a 2000-row query cap)
   * can have every section report itself complete while the query still dropped rows. The
   * two flags mean different things and a reader needs to know which bound they hit.
   */
  queryTruncated: boolean;
};

/** Ceiling on total rows fetched for one item's movement card, across every location + variant. */
export const QUERY_ENTRY_LIMIT = 2000;

/**
 * Display cap: the page renders at most this many of a section's entries
 * (`section.entries.slice(-SECTION_ENTRY_LIMIT)`) and shows a "more history hidden" notice
 * only when `section.truncated`. This is a DISPLAY cap, not a data cap — the query layer
 * never slices `section.entries` itself; `sectionLimit` is exported precisely so the page
 * can apply the same number it was flagged against.
 */
export const SECTION_ENTRY_LIMIT = 500;

/**
 * Thin wrapper over the shared `isCeilingReached` (see `ledger-query.ts` for the equality-
 * vs-`isSectionTruncated` reasoning) pinned to this card's own ceiling. Kept as its own named
 * export — rather than repointing call sites to the shared helper directly — because existing
 * tests import it by this name.
 */
export function isQueryTruncated(rowCount: number): boolean {
  return isCeilingReached(rowCount, QUERY_ENTRY_LIMIT);
}

/**
 * True when a section holds MORE than SECTION_ENTRY_LIMIT entries — strictly greater, not
 * `>=`. This is deliberately the OPPOSITE choice from isQueryTruncated's `===` above, and the
 * two must not be "harmonised": at the query level `take` caps the fetch, so a true total
 * above QUERY_ENTRY_LIMIT is indistinguishable from one exactly at it — `===` over-warns
 * there because it has no way not to. At the section level the real entry count is fully
 * known (nothing caps `section.entries` before this point), so the honest comparison is
 * available and must be used: at exactly SECTION_ENTRY_LIMIT entries, the display cap hides
 * nothing (every entry is shown), so flagging it truncated would tell the operator entries
 * are missing when none are.
 */
export function isSectionTruncated(entryCount: number): boolean {
  return entryCount > SECTION_ENTRY_LIMIT;
}

/**
 * Builds the refType condition shared by BOTH `where` and `historyWhere` below, from a
 * single call whose result is reused verbatim in both places — never written twice.
 * Two independent predicates answering the same question is exactly how `hasAnyHistory`
 * and `sections` disagreed before the previous slice's fix; the fix here is structural
 * (one value, two consumers) rather than a promise to keep two literals in sync by hand.
 *
 * `refTypes` narrows to REGISTERED members only (validated at the action boundary before
 * this is ever called). `includeUnregisteredRefTypes` is what lets a value the registry
 * does not know about — a fixture row, or a writer shipped before its registry entry
 * landed, both of which are real on this column (see the comment on `RawLedgerRow.refType`
 * above) — participate as its own selectable class instead of silently vanishing the
 * moment an operator narrows the movement-type filter at all.
 *
 * Both undefined => no filter, unchanged from every caller before this flag existed.
 * Registered subset, unregistered excluded => `refType IN (subset)`.
 * Registered subset, unregistered included  => `refType IN (subset) OR refType NOT IN (registry)`.
 * Unregistered only (no registered member picked) => `refType NOT IN (registry)`.
 * Every registered member AND unregistered both selected collapses to "no filter" (same
 * result set, no reason to ship a no-op OR).
 * Nothing selected at all is unreachable from the control's own empty-selection guard,
 * but must not silently fall back to "unfiltered" if some future caller ever reaches it
 * — it means "match nothing", the same as an operator's empty selection is SUPPOSED to
 * mean everywhere else in this feature.
 */
export function buildRefTypeCondition(
  refTypes: StockLedgerRefType[] | undefined,
  includeUnregisteredRefTypes: boolean | undefined,
): Prisma.StockLedgerEntryWhereInput | undefined {
  if (refTypes === undefined && includeUnregisteredRefTypes === undefined) return undefined;

  const registered = refTypes ?? [];
  const includeUnregistered = includeUnregisteredRefTypes === true;

  if (registered.length === STOCK_LEDGER_REF_TYPES.length && includeUnregistered) {
    return undefined;
  }
  if (registered.length > 0 && includeUnregistered) {
    return { OR: [{ refType: { in: registered } }, { refType: { notIn: [...STOCK_LEDGER_REF_TYPES] } }] };
  }
  if (registered.length > 0) {
    return { refType: { in: registered } };
  }
  if (includeUnregistered) {
    return { refType: { notIn: [...STOCK_LEDGER_REF_TYPES] } };
  }
  return { refType: { in: [] } };
}

/**
 * Read-only query behind the item movement / stock ledger card. Fetches this item's
 * StockLedgerEntry rows (optionally narrowed by variant, date range, refType, or location
 * type), resolves STORE/VAN location ids to names via two batched lookups, and folds the
 * rows into per-(location, variant) sections with groupLedgerEntries.
 */
export async function getItemMovementCard(input: ItemMovementCardInput): Promise<ItemMovementCard> {
  /* Computed ONCE and applied verbatim to both `where` and `historyWhere` below — see
     buildRefTypeCondition's own doc comment for why that structural sharing, rather than
     writing the same condition twice, is the point. */
  const refTypeCondition = buildRefTypeCondition(input.refTypes, input.includeUnregisteredRefTypes);

  const where: Prisma.StockLedgerEntryWhereInput = { itemId: input.itemId };
  if (input.variantSku !== undefined) where.variantSku = input.variantSku;
  if (input.from !== undefined || input.to !== undefined) {
    where.createdAt = {};
    if (input.from !== undefined) where.createdAt.gte = input.from;
    if (input.to !== undefined) where.createdAt.lte = input.to;
  }
  if (refTypeCondition !== undefined) Object.assign(where, refTypeCondition);
  if (input.locationTypes !== undefined && input.locationTypes.length > 0) {
    where.locationType = { in: input.locationTypes };
  }

  /*
   * Same predicates as `where` above, MINUS the date window — this is what makes
   * hasAnyHistory answer the right question. The empty-state copy branches on this flag to
   * tell the operator either "nothing in this range, try widening it" or "this item has no
   * history at all", so the count must ignore exactly the filter that copy offers to widen
   * (the date range) and respect every other one. A bare `{ itemId }` count let a variant
   * with zero rows under ANY date range still read as "try widening the date range" — there
   * was no date range to widen, because variantSku, refTypes and locationTypes can each
   * independently rule out every row on their own.
   */
  const historyWhere: Prisma.StockLedgerEntryWhereInput = { itemId: input.itemId };
  if (input.variantSku !== undefined) historyWhere.variantSku = input.variantSku;
  if (refTypeCondition !== undefined) Object.assign(historyWhere, refTypeCondition);
  if (input.locationTypes !== undefined && input.locationTypes.length > 0) {
    historyWhere.locationType = { in: input.locationTypes };
  }

  const [rows, historyCount] = await Promise.all([
    /*
     * LEDGER_ORDER_BY is descending (see ledger-query.ts for why that's load-bearing under a
     * `take` ceiling in general). Here specifically: closingBalance is read off the LAST entry
     * of a section, so keeping the newest rows is what makes that balance the item's balance
     * TODAY rather than as of row QUERY_ENTRY_LIMIT — groupLedgerEntries re-sorts each section
     * back to ascending for display regardless of fetch order, so feeding it descending is
     * safe. It's also what makes queryTruncated (below) SURVIVABLE rather than silently
     * wrong: when the cap bites, the dropped rows are always the oldest, so the closing
     * balance stays correct and only the far end of history goes missing.
     */
    prisma.stockLedgerEntry.findMany({
      where,
      orderBy: [...LEDGER_ORDER_BY],
      take: QUERY_ENTRY_LIMIT,
      select: {
        ...LEDGER_ROW_SELECT,
        locationType: true,
        locationId: true,
        balanceQty: true,
        unitCost: true,
        createdById: true,
      },
    }),
    /* Answers "does this item (under these variant/refType/locationType filters, if any)
       have ANY ledger row at all, ignoring only the date window" — see historyWhere above.
       Never derive this from sections.length, which only proves nothing moved in THIS
       window, a different fact from there being no matching row under any date range. */
    prisma.stockLedgerEntry.count({ where: historyWhere }),
  ]);

  const storeIds = Array.from(new Set(rows.filter((r) => r.locationType === "STORE").map((r) => r.locationId)));
  const vanUserIds = Array.from(new Set(rows.filter((r) => r.locationType === "VAN").map((r) => r.locationId)));

  /*
   * locationId is polymorphic (empty string for MAIN, a storeId for STORE, a userId for
   * VAN) and relationMode = "prisma" means there is no FK to join on — so this is two
   * batched lookups, never a per-row query and never a join. Skip a lookup entirely when
   * its id list is empty: an `in: []` is a pointless round trip, and an `in: undefined` is
   * a filter Prisma DROPS, which would fetch every store/user in the database.
   */
  const [stores, users] = await Promise.all([
    storeIds.length > 0
      ? prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    vanUserIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: vanUserIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);

  const labels: LedgerLabels = {
    stores: new Map(stores.map((s) => [s.id, s.name])),
    users: new Map(users.map((u) => [u.id, u.name ?? u.email])),
  };

  const rawRows: RawLedgerRow[] = rows.map((r) => ({
    id: r.id,
    locationType: r.locationType,
    locationId: r.locationId,
    variantSku: r.variantSku,
    refType: r.refType,
    refId: r.refId,
    refDocNumber: r.refDocNumber,
    qty: Number(r.qty),
    balanceQty: Number(r.balanceQty),
    unitCost: r.unitCost === null ? null : Number(r.unitCost),
    createdById: r.createdById,
    createdAt: r.createdAt,
  }));

  const sections = groupLedgerEntries(rawRows, labels);
  for (const section of sections) {
    section.truncated = isSectionTruncated(section.entries.length);
  }

  return {
    sections,
    hasAnyHistory: historyCount > 0,
    sectionLimit: SECTION_ENTRY_LIMIT,
    queryTruncated: isQueryTruncated(rows.length),
  };
}
