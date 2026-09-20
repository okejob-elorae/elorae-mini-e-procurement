import { prisma, Prisma, type StockLedgerRefType } from "@elorae/db";

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
      a.variantSku.localeCompare(b.variantSku),
  );

  return sections;
}

export type ItemMovementCardInput = {
  itemId: string;
  variantSku?: string;
  from?: Date;
  to?: Date;
  refTypes?: StockLedgerRefType[];
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
 * True when the fetch returned exactly QUERY_ENTRY_LIMIT rows — the `take` ceiling was hit,
 * so rows beyond it exist and were dropped. Equality, not `>=`: the fetch itself is capped
 * by `take`, so `rowCount` can never exceed the limit; testing for it is just being explicit
 * about which comparison is meaningful. This can false-positive when the item's true total
 * is exactly QUERY_ENTRY_LIMIT (nothing was actually dropped) — the harmless direction: it
 * over-warns rather than under-warns, which is the trade this view wants on an audit surface.
 */
export function isQueryTruncated(rowCount: number): boolean {
  return rowCount === QUERY_ENTRY_LIMIT;
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
 * Read-only query behind the item movement / stock ledger card. Fetches this item's
 * StockLedgerEntry rows (optionally narrowed by variant, date range, refType, or location
 * type), resolves STORE/VAN location ids to names via two batched lookups, and folds the
 * rows into per-(location, variant) sections with groupLedgerEntries.
 */
export async function getItemMovementCard(input: ItemMovementCardInput): Promise<ItemMovementCard> {
  const where: Prisma.StockLedgerEntryWhereInput = { itemId: input.itemId };
  if (input.variantSku !== undefined) where.variantSku = input.variantSku;
  if (input.from !== undefined || input.to !== undefined) {
    where.createdAt = {};
    if (input.from !== undefined) where.createdAt.gte = input.from;
    if (input.to !== undefined) where.createdAt.lte = input.to;
  }
  if (input.refTypes !== undefined && input.refTypes.length > 0) where.refType = { in: input.refTypes };
  if (input.locationTypes !== undefined && input.locationTypes.length > 0) {
    where.locationType = { in: input.locationTypes };
  }

  const [rows, historyCount] = await Promise.all([
    /*
     * DESCENDING, not ascending, before the take ceiling applies. An ascending fetch capped
     * at QUERY_ENTRY_LIMIT keeps the OLDEST rows and silently drops the newest, which would
     * make closingBalance the balance as of row 2000 rather than the item's balance right
     * now — wrong on a screen whose whole job is saying where stock is TODAY. Descending
     * keeps the newest rows; groupLedgerEntries re-sorts each section back to ascending for
     * display regardless of the order rows arrive in, so feeding it descending is safe.
     *
     * This ordering is also what makes a query-level truncation (queryTruncated below)
     * SURVIVABLE rather than silently wrong: when the cap actually bites, the rows it drops
     * are always the oldest ones, so the closing balance stays correct and only the far end
     * of history — the end you can afford to lose — goes missing.
     */
    prisma.stockLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: QUERY_ENTRY_LIMIT,
      select: {
        id: true,
        locationType: true,
        locationId: true,
        variantSku: true,
        refType: true,
        refId: true,
        refDocNumber: true,
        qty: true,
        balanceQty: true,
        unitCost: true,
        createdById: true,
        createdAt: true,
      },
    }),
    /* Answers "does this item have ANY ledger row at all" — no date, type or location
       filter. Never derive this from sections.length, which only proves nothing moved in
       THIS window, a different fact from this item never having moved at all. */
    prisma.stockLedgerEntry.count({ where: { itemId: input.itemId } }),
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
