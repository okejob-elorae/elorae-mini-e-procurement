/**
 * Holds one idempotency id per order draft. The same id is handed back for the
 * same draft signature, so a double tap or a retry after a lost response reuses
 * the id the server dedups on; a changed draft or an explicit reset mints a new one.
 */
export function createDraftIdHolder(mint: () => string) {
  let current: { id: string; signature: string } | null = null;

  return {
    get(signature: string): string {
      if (current === null || current.signature !== signature) {
        current = { id: mint(), signature };
      }
      return current.id;
    },
    reset(): void {
      current = null;
    },
  };
}
