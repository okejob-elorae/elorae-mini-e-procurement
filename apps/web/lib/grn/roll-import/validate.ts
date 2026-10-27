import {
  GRN_ROLL_IMPORT_MAX_LENGTH,
  GRN_ROLL_IMPORT_MAX_ROWS,
  GRN_ROLL_MAX_VALUE,
  rollImportError,
  type GrnRollImportColumnKey,
  type GrnRollImportError,
  type GrnRollImportLineSummary,
  type GrnRollImportResult,
  type GrnRollImportRow,
  type GrnRollImportTargetLine,
  type ImportedRoll,
} from "./types";
import { hasAtMostTwoDecimals } from "../decimals";

const MAX_LINE_TOTAL_CENTS = 9_999_999_999;
const MAX_VALUE_CENTS = Math.round(GRN_ROLL_MAX_VALUE * 100);

const matchKey = (sku: string, variant: string | null): string =>
  `${sku.trim().toLowerCase()}\t${(variant ?? "").trim().toLowerCase()}`;

/* Null means "not a number"; a decimal comma ("12,5") is read as a dot. */
export function parseRollLength(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (text === "") return null;
  const n = Number(/^-?\d+,\d+$/.test(text) ? text.replace(",", ".") : text);
  return Number.isFinite(n) ? n : null;
}

const isBlank = (value: string | number | null): boolean =>
  value === null || (typeof value === "string" && value.trim() === "");

const toTwoDecimals = (n: number): number => Math.round(n * 100) / 100;

/**
 * Pure: used by the preview AND the commit, so the two can never disagree. Every row is
 * checked and every error collected; a plan is returned only when the file has none.
 */
export function validateGrnRollImport(
  rows: GrnRollImportRow[],
  lines: GrnRollImportTargetLine[],
): GrnRollImportResult {
  const empty = { summary: [], plan: null };
  if (rows.length === 0) return { errors: [rollImportError("EMPTY_FILE")], ...empty };
  if (rows.length > GRN_ROLL_IMPORT_MAX_ROWS) {
    return { errors: [rollImportError("TOO_MANY_ROWS", { detail: String(GRN_ROLL_IMPORT_MAX_ROWS) })], ...empty };
  }

  const lineByKey = new Map<string, GrnRollImportTargetLine>();
  for (const line of lines) {
    const key = matchKey(line.sku, line.variantSku);
    if (lineByKey.has(key)) {
      return { errors: [rollImportError("AMBIGUOUS_LINE", { detail: line.sku })], ...empty };
    }
    lineByKey.set(key, line);
  }
  const variantSkus = new Set(
    lines.filter((l) => l.variantSku !== null).map((l) => l.sku.trim().toLowerCase()),
  );

  const errors: GrnRollImportError[] = [];
  const rollsByLine = new Map<string, ImportedRoll[]>();
  const centsByLine = new Map<string, number>();
  const refsByLine = new Map<string, Set<string>>();

  for (const r of rows) {
    let rowOk = true;
    const push = (
      code: GrnRollImportError["code"],
      column: GrnRollImportColumnKey | null = null,
      detail: string | null = null,
    ) => {
      rowOk = false;
      errors.push(rollImportError(code, { row: r.row, column, detail }));
    };

    let line: GrnRollImportTargetLine | undefined;
    if (r.sku.trim() === "") {
      push("REQUIRED", "sku");
    } else {
      line = lineByKey.get(matchKey(r.sku, r.varianSku));
      if (!line) {
        const needsVariant = r.varianSku.trim() === "" && variantSkus.has(r.sku.trim().toLowerCase());
        push("UNKNOWN_LINE", needsVariant ? "varianSku" : "sku", r.sku.trim());
      }
    }

    if (r.noRoll.length > GRN_ROLL_IMPORT_MAX_LENGTH) push("TOO_LONG", "noRoll", String(GRN_ROLL_IMPORT_MAX_LENGTH));
    if (r.catatan.length > GRN_ROLL_IMPORT_MAX_LENGTH) push("TOO_LONG", "catatan", String(GRN_ROLL_IMPORT_MAX_LENGTH));

    let cents = 0;
    let length = 0;
    if (isBlank(r.panjang)) {
      push("REQUIRED", "panjang");
    } else {
      const n = parseRollLength(r.panjang);
      if (n === null) {
        push("INVALID_NUMBER", "panjang");
      } else if (n <= 0) {
        push("NOT_POSITIVE", "panjang");
      } else if (n > GRN_ROLL_MAX_VALUE) {
        push("TOO_LARGE", "panjang");
      } else {
        cents = Math.round(n * 100);
        if (!hasAtMostTwoDecimals(n)) push("TOO_MANY_DECIMALS", "panjang");
        else length = cents / 100;
      }
    }

    const ref = r.noRoll.trim();
    if (line && rowOk) {
      if (cents > MAX_VALUE_CENTS || (centsByLine.get(line.lineId) ?? 0) + cents > MAX_LINE_TOTAL_CENTS) {
        push("TOO_LARGE", "panjang");
      }
      const refKey = ref.toLowerCase();
      const seen = refsByLine.get(line.lineId) ?? new Set<string>();
      if (ref !== "" && seen.has(refKey)) push("DUPLICATE_REF", "noRoll", ref);
      else if (ref !== "") seen.add(refKey);
      refsByLine.set(line.lineId, seen);
    }

    if (line && rowOk) {
      centsByLine.set(line.lineId, (centsByLine.get(line.lineId) ?? 0) + cents);
      rollsByLine.set(line.lineId, [
        ...(rollsByLine.get(line.lineId) ?? []),
        { length, ref: ref === "" ? null : ref, notes: r.catatan.trim() === "" ? null : r.catatan.trim() },
      ]);
    }
  }

  const summary: GrnRollImportLineSummary[] = [];
  for (const line of lines) {
    const rolls = rollsByLine.get(line.lineId);
    if (!rolls) continue;
    const totalLength = (centsByLine.get(line.lineId) ?? 0) / 100;
    const afterQty = line.orderedQty === null ? null : toTwoDecimals((line.alreadyReceivedQty ?? 0) + totalLength);
    const over = afterQty !== null && line.orderedQty !== null ? toTwoDecimals(afterQty - line.orderedQty) : 0;
    summary.push({
      lineId: line.lineId,
      sku: line.sku,
      variantSku: line.variantSku,
      name: line.name,
      uomCode: line.uomCode,
      rollCount: rolls.length,
      totalLength,
      orderedQty: line.orderedQty,
      alreadyReceivedQty: line.alreadyReceivedQty,
      afterQty,
      overBy: over > 0 ? over : null,
    });
  }

  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return {
    errors,
    summary,
    plan: errors.length === 0 ? Object.fromEntries(rollsByLine) : null,
  };
}
