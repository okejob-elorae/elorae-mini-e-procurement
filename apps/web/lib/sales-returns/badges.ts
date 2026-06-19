import type { SalesReturnStatus, SalesReturnItemDecision } from "@/lib/constants/enums";

type Badge = { labelKey: string; tailwindClass: string };

export const RETURN_STATUS_BADGE: Record<SalesReturnStatus, Badge> = {
  PENDING:  { labelKey: "pending",  tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  ACCEPTED: { labelKey: "accepted", tailwindClass: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  REJECTED: { labelKey: "rejected", tailwindClass: "bg-rose-100 text-rose-800 border-rose-200" },
  PARTIAL:  { labelKey: "partial",  tailwindClass: "bg-amber-100 text-amber-800 border-amber-200" },
};

export const RETURN_ITEM_DECISION_BADGE: Record<SalesReturnItemDecision, Badge> = {
  PENDING:  { labelKey: "pending",  tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  ACCEPTED: { labelKey: "accepted", tailwindClass: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  REJECTED: { labelKey: "rejected", tailwindClass: "bg-rose-100 text-rose-800 border-rose-200" },
};
