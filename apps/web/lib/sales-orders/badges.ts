import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";

type ChannelBadge = { labelKey: string; tailwindClass: string };
type StatusBadge = { tailwindClass: string };

export const CHANNEL_BADGE: Record<SalesChannel, ChannelBadge> = {
  SHOPEE:    { labelKey: "shopee",    tailwindClass: "bg-orange-100 text-orange-800 border-orange-200" },
  TOKOPEDIA: { labelKey: "tokopedia", tailwindClass: "bg-green-100 text-green-800 border-green-200" },
  TIKTOK:    { labelKey: "tiktok",    tailwindClass: "bg-zinc-900 text-zinc-50 border-zinc-700" },
  OTHER:     { labelKey: "other",     tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
};

export const STATUS_BADGE: Record<SalesOrderStatus, StatusBadge> = {
  NEW:        { tailwindClass: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  PROCESSING: { tailwindClass: "bg-amber-100 text-amber-800 border-amber-200" },
  SHIPPED:    { tailwindClass: "bg-blue-100 text-blue-800 border-blue-200" },
  COMPLETED:  { tailwindClass: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  CANCELLED:  { tailwindClass: "bg-red-100 text-red-800 border-red-200" },
  RETURNED:   { tailwindClass: "bg-violet-100 text-violet-800 border-violet-200" },
};
