export type ActiveVisit = { id: string; storeId: string };

export type CheckInPlan =
  | { kind: "no-op-same-store"; existingVisitId: string }
  | { kind: "auto-close-and-open"; autoCloseVisitId: string; newStoreId: string }
  | { kind: "open-fresh"; newStoreId: string };

export function planCheckIn(
  targetStoreId: string,
  currentActive: ActiveVisit | null,
): CheckInPlan {
  if (currentActive === null) {
    return { kind: "open-fresh", newStoreId: targetStoreId };
  }
  if (currentActive.storeId === targetStoreId) {
    return { kind: "no-op-same-store", existingVisitId: currentActive.id };
  }
  return {
    kind: "auto-close-and-open",
    autoCloseVisitId: currentActive.id,
    newStoreId: targetStoreId,
  };
}
