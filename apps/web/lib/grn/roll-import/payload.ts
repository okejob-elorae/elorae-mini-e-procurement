import type { ImportedRoll } from "./types";

export function buildRollPayload(
  sku: string,
  importedRolls: ImportedRoll[] | undefined,
  manualLengths: number[],
): Array<{ rollRef: string; length: number; notes?: string }> {
  const fallback = (idx: number): string => `${sku || "ROLL"}-${idx + 1}`;
  if (importedRolls !== undefined) {
    return importedRolls.map((roll, idx) => ({
      rollRef: roll.ref ?? fallback(idx),
      length: roll.length,
      ...(roll.notes !== null ? { notes: roll.notes } : {}),
    }));
  }
  return manualLengths.map((length, idx) => ({ rollRef: fallback(idx), length }));
}
