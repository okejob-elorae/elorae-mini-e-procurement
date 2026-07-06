import { submitFieldSalesOrder, type SubmitResult } from "@/app/pwa/stores/[id]/catalog/actions";
import { pwaDb } from "./db";
import { deletePendingOrder } from "./queue";

export type SyncDecision = "evict" | "terminal" | "retry";
const TERMINAL = new Set(["MIN_QTY", "NO_ACTIVE_VISIT", "EMPTY", "UNAUTHORIZED"]);

export function classifyResult(r: SubmitResult | { thrown: true }): SyncDecision {
  if ("thrown" in r) return "retry";
  if (r.ok) return "evict";
  return TERMINAL.has(r.code) ? "terminal" : "retry";
}

let running = false;

export async function flushPendingOrders(): Promise<{ synced: number; failed: number; retried: number }> {
  if (running) return { synced: 0, failed: 0, retried: 0 };
  running = true;
  let synced = 0, failed = 0, retried = 0;
  try {
    // Also reclaim "syncing" rows: the run-lock guarantees no concurrent flush, so any row
    // left "syncing" was orphaned by an app suspend/kill mid-await (common on iOS PWAs).
    const pending = (await pwaDb.pendingOrders.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort((a, b) => a.capturedAt - b.capturedAt);
    for (const o of pending) {
      await pwaDb.pendingOrders.update(o.localId, { syncState: "syncing" });
      let decision: SyncDecision;
      let reason = "";
      try {
        const res = await submitFieldSalesOrder({ storeId: o.storeId, note: o.note, lines: o.lines, idempotencyKey: o.localId });
        decision = classifyResult(res);
        if (!res.ok) reason = res.code;
      } catch {
        decision = "retry";
      }
      if (decision === "evict") { await deletePendingOrder(o.localId); synced += 1; }
      else if (decision === "terminal") { await pwaDb.pendingOrders.update(o.localId, { syncState: "failed", error: reason, attempts: o.attempts + 1 }); failed += 1; }
      else { await pwaDb.pendingOrders.update(o.localId, { syncState: "pending", attempts: o.attempts + 1 }); retried += 1; }
    }
  } finally {
    running = false;
  }
  return { synced, failed, retried };
}

// Fires on reconnect + app foreground. Returns a cleanup fn. onChange lets the UI refresh its pending count.
export function setupOrderSync(onChange?: () => void): () => void {
  const run = () => { void flushPendingOrders().then(() => onChange?.()); };
  const onOnline = () => run();
  const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) run(); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  if (navigator.onLine) run();
  return () => { window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); };
}
