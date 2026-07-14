export type StockStatus = "NEGATIF" | "HABIS" | "MENIPIS" | "OK";

export type StockSort = "stock_desc" | "stock_asc" | "sku";

export type StockHealthItem = {
  available: number;
  reorderPoint: number | null;
};

export type StockListItem = StockHealthItem & {
  itemId: string;
  sku: string;
};

/** Mutually exclusive: Negatif > Habis > Menipis > OK */
export function deriveStockStatus(
  available: number,
  reorderPoint: number | null,
): StockStatus {
  if (available < 0) return "NEGATIF";
  if (available === 0) return "HABIS";
  if (reorderPoint != null && available <= reorderPoint) return "MENIPIS";
  return "OK";
}

export type StockHealthSummary = {
  totalAvailable: number;
  menipisCount: number;
  habisCount: number;
  negatifCount: number;
  okCount: number;
};

export function summarizeStockHealth(items: StockHealthItem[]): StockHealthSummary {
  let totalAvailable = 0;
  let menipisCount = 0;
  let habisCount = 0;
  let negatifCount = 0;
  let okCount = 0;

  for (const item of items) {
    totalAvailable += item.available;
    const status = deriveStockStatus(item.available, item.reorderPoint);
    switch (status) {
      case "NEGATIF":
        negatifCount += 1;
        break;
      case "HABIS":
        habisCount += 1;
        break;
      case "MENIPIS":
        menipisCount += 1;
        break;
      case "OK":
        okCount += 1;
        break;
      default: {
        const _exhaustive: never = status;
        throw new Error(`Unhandled stock status: ${_exhaustive}`);
      }
    }
  }

  return { totalAvailable, menipisCount, habisCount, negatifCount, okCount };
}

export function filterByStockStatus<T extends StockHealthItem>(
  items: T[],
  status: StockStatus | undefined,
): T[] {
  if (!status) return items;
  return items.filter(
    (item) => deriveStockStatus(item.available, item.reorderPoint) === status,
  );
}

export function sortStockItems<T extends StockListItem>(
  items: T[],
  sort: StockSort = "stock_desc",
): T[] {
  const copy = [...items];
  switch (sort) {
    case "stock_desc":
      copy.sort((a, b) => b.available - a.available || a.sku.localeCompare(b.sku));
      break;
    case "stock_asc":
      copy.sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));
      break;
    case "sku":
      copy.sort((a, b) => a.sku.localeCompare(b.sku));
      break;
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
  return copy;
}

export function filterAndSortStockItems<T extends StockListItem>(
  items: T[],
  opts?: { status?: StockStatus; sort?: StockSort },
): T[] {
  const filtered = filterByStockStatus(items, opts?.status);
  return sortStockItems(filtered, opts?.sort ?? "stock_desc");
}
