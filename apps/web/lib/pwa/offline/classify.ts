// Pure sync-result classifier. Type-only import of SubmitResult (erased at compile) so this
// module — and its unit test — never pull the server action / next-auth / next/server chain.
import type { SubmitResult } from "@/app/pwa/stores/[id]/catalog/actions";

export type SyncDecision = "evict" | "terminal" | "retry";

const TERMINAL = new Set(["MIN_QTY", "NO_ACTIVE_VISIT", "EMPTY", "UNAUTHORIZED"]);

export function classifyResult(r: SubmitResult | { thrown: true }): SyncDecision {
  if ("thrown" in r) return "retry";
  if (r.ok) return "evict";
  return TERMINAL.has(r.code) ? "terminal" : "retry";
}
