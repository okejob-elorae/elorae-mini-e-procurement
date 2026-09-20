import type { StockLedgerRefType } from "@elorae/db";

export type LedgerLocationType = "MAIN" | "STORE" | "VAN";

export type RawLedgerRow = {
  id: string;
  locationType: LedgerLocationType;
  locationId: string;
  variantSku: string;
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
