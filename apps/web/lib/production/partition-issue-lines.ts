/**
 * Split staged issue lines into typed MaterialIssue payloads (one FABRIC doc, one
 * ACCESSORIES). The form may mix both; stock docs stay typed for HPP / register.
 */

export type IssueLineType = "FABRIC" | "ACCESSORIES";

export function partitionIssueLinesByType<T extends { itemId: string }>(
  lines: T[],
  isFabricItem: (itemId: string) => boolean
): Record<IssueLineType, T[]> {
  const FABRIC: T[] = [];
  const ACCESSORIES: T[] = [];
  for (const line of lines) {
    if (isFabricItem(line.itemId)) FABRIC.push(line);
    else ACCESSORIES.push(line);
  }
  return { FABRIC, ACCESSORIES };
}

/** Per-type idempotency so a half-success retry does not double the first create. */
export function typedIssueIdempotencyKey(formKey: string, issueType: IssueLineType): string {
  return `${formKey}:${issueType}`;
}
