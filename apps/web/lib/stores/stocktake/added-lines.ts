export type AddedLineKey = { itemId: string; variantSku: string };

/**
 * Pre-check for a stocktake save's added lines: true when any of them repeats a line already on the
 * document or an earlier one in the same batch. Pure so a spec can pin it directly; the writer's
 * P2002 catch is only the fallback behind it.
 */
export function hasDuplicateAddedLine(
  existing: ReadonlyArray<AddedLineKey>,
  added: ReadonlyArray<AddedLineKey>,
): boolean {
  const seen = new Set(existing.map((l) => `${l.itemId}::${l.variantSku}`));
  for (const al of added) {
    const key = `${al.itemId}::${al.variantSku}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
