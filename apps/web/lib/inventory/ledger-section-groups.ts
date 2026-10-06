import type { LedgerSection } from "@/lib/inventory/stock-ledger-card";

export type LocationGroup = {
  key: string;
  locationType: LedgerSection["locationType"];
  locationId: string;
  locationLabel: string;
  locationResolved: boolean;
  sections: LedgerSection[];
  closingBalance: number;
};

export function groupSectionsByLocation(sections: LedgerSection[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const section of sections) {
    const key = `${section.locationType}:${section.locationId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sections.push(section);
      existing.closingBalance += section.closingBalance;
      continue;
    }
    groups.set(key, {
      key,
      locationType: section.locationType,
      locationId: section.locationId,
      locationLabel: section.locationLabel,
      locationResolved: section.locationResolved,
      sections: [section],
      closingBalance: section.closingBalance,
    });
  }
  return Array.from(groups.values());
}
