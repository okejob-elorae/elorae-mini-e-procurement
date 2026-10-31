export type OpnameLineRow = {
  id: string;
  label: string;
  sublabel?: string;
  snapshot: number;
  counted: number | null;
  variance: number | null;
  hadDriftWarning?: boolean;
  /** Baris stok gabungan (tanpa varian) dari barang yang juga punya baris per varian. */
  gabungan?: boolean;
};

/**
 * Tandai baris tanpa varian milik barang yang di opname yang sama juga punya
 * baris per varian: tanpa tanda, "Celana Jeans Kulot Nara 0 0 0" di samping
 * baris -28/-30/-32 terbaca seperti barang ganda. Barang tanpa varian sama
 * sekali tidak ditandai.
 */
export function tandaiGabungan<T extends { label: string; sublabel?: string }>(baris: T[]): Array<T & { gabungan?: boolean }> {
  const punyaVarian = new Set(baris.filter((b) => b.sublabel).map((b) => b.label));
  return baris.map((b) => (!b.sublabel && punyaVarian.has(b.label) ? { ...b, gabungan: true } : b));
}

export type OpnameSummary = {
  totalLines: number;
  countedLines: number;
  pendingLines: number;
  varianceLines: number;
  matchLines: number;
};

export type OpnameLineFilter = "all" | "variance" | "pending" | "counted";

function isCounted(counted: number | null): boolean {
  return counted != null;
}

function hasVariance(variance: number | null): boolean {
  return variance != null && variance !== 0;
}

export function buildItemLines(
  items: Array<{
    id: string;
    itemName: string;
    variantSku?: string | null;
    snapshotQty: number;
    countedQty?: number | null;
    variance?: number | null;
    hadDriftWarning?: boolean;
  }>,
): OpnameLineRow[] {
  return tandaiGabungan(
    items.map((row) => ({
      id: row.id,
      label: row.itemName,
      sublabel: row.variantSku?.trim() || undefined,
      snapshot: Number(row.snapshotQty),
      counted: row.countedQty != null ? Number(row.countedQty) : null,
      variance: row.variance != null ? Number(row.variance) : null,
      hadDriftWarning: row.hadDriftWarning,
    })),
  );
}

export function buildRollLines(
  rolls: Array<{
    id: string;
    rollCode: string;
    itemName: string;
    snapshotLength: number;
    countedLength?: number | null;
    variance?: number | null;
  }>,
): OpnameLineRow[] {
  return rolls.map((row) => ({
    id: row.id,
    label: row.rollCode,
    sublabel: row.itemName,
    snapshot: Number(row.snapshotLength),
    counted: row.countedLength != null ? Number(row.countedLength) : null,
    variance: row.variance != null ? Number(row.variance) : null,
  }));
}

export function summarizeLines(lines: OpnameLineRow[]): OpnameSummary {
  let countedLines = 0;
  let varianceLines = 0;
  let matchLines = 0;

  for (const line of lines) {
    if (isCounted(line.counted)) {
      countedLines += 1;
      if (hasVariance(line.variance)) {
        varianceLines += 1;
      } else {
        matchLines += 1;
      }
    }
  }

  const totalLines = lines.length;
  return {
    totalLines,
    countedLines,
    pendingLines: totalLines - countedLines,
    varianceLines,
    matchLines,
  };
}

export function filterOpnameLines(lines: OpnameLineRow[], filter: OpnameLineFilter): OpnameLineRow[] {
  switch (filter) {
    case "variance":
      return lines.filter((line) => isCounted(line.counted) && hasVariance(line.variance));
    case "pending":
      return lines.filter((line) => !isCounted(line.counted));
    case "counted":
      return lines.filter((line) => isCounted(line.counted));
    default:
      return lines;
  }
}

export function sortLinesForReview(lines: OpnameLineRow[]): OpnameLineRow[] {
  return [...lines].sort((a, b) => {
    const aVar = Math.abs(a.variance ?? 0);
    const bVar = Math.abs(b.variance ?? 0);
    if (bVar !== aVar) return bVar - aVar;
    const aPending = isCounted(a.counted) ? 1 : 0;
    const bPending = isCounted(b.counted) ? 1 : 0;
    if (aPending !== bPending) return aPending - bPending;
    return a.label.localeCompare(b.label);
  });
}

export function searchOpnameLines(lines: OpnameLineRow[], query: string): OpnameLineRow[] {
  const q = query.trim().toUpperCase();
  if (!q) return lines;
  return lines.filter(
    (line) =>
      line.label.toUpperCase().includes(q) ||
      (line.sublabel?.toUpperCase().includes(q) ?? false),
  );
}
