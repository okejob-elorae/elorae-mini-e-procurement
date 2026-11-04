import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";
import { STATUS_TONE_CLASS, type StatusTone } from "@/components/ui/status-pill";

type ChannelBadge = { labelKey: string; tailwindClass: string };
type StatusBadge = { tailwindClass: string };

export const CHANNEL_BADGE: Record<SalesChannel, ChannelBadge> = {
  SHOPEE:    { labelKey: "shopee",    tailwindClass: "bg-orange-100 text-orange-800 border-orange-200" },
  TOKOPEDIA: { labelKey: "tokopedia", tailwindClass: "bg-green-100 text-green-800 border-green-200" },
  TIKTOK:    { labelKey: "tiktok",    tailwindClass: "bg-zinc-900 text-zinc-50 border-zinc-700" },
  OTHER:     { labelKey: "other",     tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
};

/*
 * Order status shares the app-wide semantic tones instead of carrying its own
 * palette. Two reasons: the previous classes were light-mode only
 * (bg-zinc-100 on a dark ground), and amber meant "processing" here while it
 * meant "needs attention" one screen over. Eight files read this map, so
 * changing it here fixes all of them.
 *
 * CANCELLED is `inactive`, not `attention` — a cancelled order is a settled
 * fact, not a problem waiting for someone. RETURNED keeps `attention`
 * because it does need handling.
 */
const STATUS_TONE: Record<SalesOrderStatus, StatusTone> = {
  NEW:        "waiting",
  PROCESSING: "progress",
  SHIPPED:    "progress",
  COMPLETED:  "settled",
  CANCELLED:  "inactive",
  RETURNED:   "attention",
};

export const STATUS_BADGE: Record<SalesOrderStatus, StatusBadge> = Object.fromEntries(
  (Object.keys(STATUS_TONE) as SalesOrderStatus[]).map((status) => [
    status,
    { tailwindClass: `${STATUS_TONE_CLASS[STATUS_TONE[status]]} ring-1 ring-inset border-transparent` },
  ]),
) as Record<SalesOrderStatus, StatusBadge>;
