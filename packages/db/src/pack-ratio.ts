export type PackRatioRow = { size: string; qty: number };
export type PackVariant = { variantSku: string; size: string };

export type ExpandPackInput = {
  ratio: PackRatioRow[];
  variants: PackVariant[];
  available: Record<string, number>;
};

export type ExpandPackResult =
  | { ok: true; lines: Array<{ variantSku: string; size: string; qty: number }> }
  | { ok: false; reason: "EMPTY_RATIO" }
  | { ok: false; reason: "MISSING_SIZE"; size: string }
  | { ok: false; reason: "INSUFFICIENT_STOCK"; size: string; needed: number; have: number };

const norm = (s: string) => s.trim().toLowerCase();

export function expandPack(input: ExpandPackInput): ExpandPackResult {
  const { ratio, variants, available } = input;
  if (ratio.length === 0) return { ok: false, reason: "EMPTY_RATIO" };

  const lines: Array<{ variantSku: string; size: string; qty: number }> = [];
  for (const row of ratio) {
    const target = norm(row.size);
    const variant = variants.find((v) => norm(v.size) === target);
    if (!variant) return { ok: false, reason: "MISSING_SIZE", size: row.size };
    const have = available[variant.variantSku] ?? 0;
    if (have < row.qty) return { ok: false, reason: "INSUFFICIENT_STOCK", size: row.size, needed: row.qty, have };
    lines.push({ variantSku: variant.variantSku, size: variant.size, qty: row.qty });
  }
  return { ok: true, lines };
}

export function parsePackRatio(raw: string | null | undefined): PackRatioRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: PackRatioRow[] = [];
  for (const p of parsed) {
    if (p == null || typeof p !== "object") return [];
    const size = (p as Record<string, unknown>).size;
    const qty = (p as Record<string, unknown>).qty;
    if (typeof size !== "string" || typeof qty !== "number") return [];
    rows.push({ size, qty });
  }
  return rows;
}

export type ValidatePackRatioResult =
  | { ok: true; rows: PackRatioRow[] }
  | { ok: false; code: "EMPTY" | "BAD_SIZE" | "DUP_SIZE" | "BAD_QTY" };

export function validatePackRatio(rows: PackRatioRow[]): ValidatePackRatioResult {
  if (rows.length === 0) return { ok: false, code: "EMPTY" };
  const out: PackRatioRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const size = row.size.trim();
    if (size === "") return { ok: false, code: "BAD_SIZE" };
    const key = size.toLowerCase();
    if (seen.has(key)) return { ok: false, code: "DUP_SIZE" };
    seen.add(key);
    if (!Number.isInteger(row.qty) || row.qty <= 0) return { ok: false, code: "BAD_QTY" };
    out.push({ size, qty: row.qty });
  }
  return { ok: true, rows: out };
}
