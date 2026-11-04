import type { ArchiveFolder } from "@/components/archive/DocumentArchive";

/**
 * Builds one archive's folders from its parties and documents. Pure.
 *
 * Two rules the archive screen relies on:
 * - A party with documents ALWAYS gets a folder (also when it is inactive or of
 *   another kind), so no document is unreachable. An EMPTY folder is shown only
 *   for a party that is expected to have documents (`tampilKosong`) — a fabric
 *   supplier never gets a work order, so its "empty" folder only adds noise.
 * - The summary is counted from the folders, so "13 perintah kerja" above the
 *   grid always equals the sum of the numbers on the folders.
 *
 * Order: folders with pending work first, then fuller folders, then by name —
 * the archive is read to find unfinished work far more often than to browse it.
 */
export type DokumenArsip = { pihakId: string; pending: boolean; nilai?: number };

export function susunFolder<P extends { id: string; name: string }>(
  pihak: readonly P[],
  dokumen: readonly DokumenArsip[],
  opsi: {
    tampilKosong: (p: P) => boolean;
    meta: (jumlah: number, nilai: number) => string | null;
    href: (p: P) => string;
  },
): { folders: ArchiveFolder[]; totalDocs: number; totalPending: number } {
  const perPihak = new Map<string, { count: number; pending: number; nilai: number }>();
  for (const d of dokumen) {
    const acc = perPihak.get(d.pihakId) ?? { count: 0, pending: 0, nilai: 0 };
    acc.count += 1;
    if (d.pending) acc.pending += 1;
    acc.nilai += d.nilai ?? 0;
    perPihak.set(d.pihakId, acc);
  }

  const folders: ArchiveFolder[] = [];
  for (const p of pihak) {
    const acc = perPihak.get(p.id) ?? { count: 0, pending: 0, nilai: 0 };
    if (acc.count === 0 && !opsi.tampilKosong(p)) continue;
    folders.push({
      id: p.id,
      name: p.name,
      count: acc.count,
      pending: acc.pending,
      meta: opsi.meta(acc.count, acc.nilai),
      href: opsi.href(p),
    });
  }

  folders.sort(
    (a, b) => (b.pending ?? 0) - (a.pending ?? 0) || b.count - a.count || a.name.localeCompare(b.name),
  );

  return {
    folders,
    totalDocs: folders.reduce((sum, f) => sum + f.count, 0),
    totalPending: folders.reduce((sum, f) => sum + (f.pending ?? 0), 0),
  };
}
