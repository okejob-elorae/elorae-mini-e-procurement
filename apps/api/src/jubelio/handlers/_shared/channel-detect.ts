import type { SalesChannel } from "@elorae/db";

const KNOWN: Record<string, SalesChannel> = {
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
};

/**
 * Jubelio's order number carries the marketplace unambiguously, unlike `source_name`: TikTok Shop
 * orders arrive with source `Shop | Tokopedia` (TikTok Shop absorbed Tokopedia), so the source's
 * last token labels every TikTok order as Tokopedia. Verified against a real TikTok income export:
 * `TikTok Shop` rows are `TT-<ref>-…`, `Tokopedia` rows are `TP-<ref>-…`.
 */
const PREFIX: Record<string, SalesChannel> = {
  "TT-": "TIKTOK",
  "TP-": "TOKOPEDIA",
  "SP-": "SHOPEE",
};

export function detectChannel(
  sourceName: string | null | undefined,
  salesorderNo?: string | null
): {
  channel: SalesChannel;
  unknown: boolean;
} {
  const byPrefix = salesorderNo ? PREFIX[salesorderNo.slice(0, 3)] : undefined;
  if (byPrefix) return { channel: byPrefix, unknown: false };
  if (!sourceName) return { channel: "OTHER", unknown: true };
  const parts = sourceName.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
  const token = (parts[parts.length - 1] ?? "").toUpperCase();
  const channel = KNOWN[token];
  return channel ? { channel, unknown: false } : { channel: "OTHER", unknown: true };
}
