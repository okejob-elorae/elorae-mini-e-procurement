import { logPrint } from "@/app/actions/audit";

/**
 * Fire-and-forget PRINT audit for client print handlers. Never awaited: a backoffice print that
 * awaits before `window.open` loses the click's user gesture and the popup blocker kills the
 * window, and a PWA print must not wait on the network. A failed audit write never blocks or
 * errors the print.
 */
export function logPrintQuietly(entityType: string, entityId: string): void {
  try {
    void logPrint(entityType, entityId).catch(() => {});
  } catch {
    /* A synchronous throw is swallowed for the same reason as a rejection. */
  }
}
