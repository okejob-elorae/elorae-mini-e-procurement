import type { SalesReturnStatus, SalesReturnItemDecision } from "@elorae/db";

export const RETURN_STATUS_TAILWIND: Record<SalesReturnStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  ACCEPTED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
  PARTIAL: "bg-amber-100 text-amber-800 border-amber-200",
};

export const ITEM_DECISION_TAILWIND: Record<SalesReturnItemDecision, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  ACCEPTED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
};
