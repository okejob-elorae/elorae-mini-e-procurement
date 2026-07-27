import type { SnapshotStep } from "@/lib/leadtime/calculations";

/**
 * True when confirmed position sits on an approval step (live map or ACC prefix).
 */
export function isAwaitingApproval(
  snapshot: SnapshotStep[] | null | undefined,
  confirmedIndex: number | null | undefined,
  isApprovalByName?: Record<string, boolean>
): boolean {
  if (
    !snapshot ||
    confirmedIndex == null ||
    confirmedIndex < 0 ||
    confirmedIndex >= snapshot.length
  ) {
    return false;
  }
  const name = snapshot[confirmedIndex]?.name;
  if (!name) return false;
  if (isApprovalByName && name in isApprovalByName) {
    return Boolean(isApprovalByName[name]);
  }
  return name.startsWith("ACC ");
}
