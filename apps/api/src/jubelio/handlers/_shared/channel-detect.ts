import type { SalesChannel } from "@elorae/db";

const KNOWN: Record<string, SalesChannel> = {
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
};

export function detectChannel(sourceName: string | null | undefined): {
  channel: SalesChannel;
  unknown: boolean;
} {
  if (!sourceName) return { channel: "OTHER", unknown: true };
  const parts = sourceName.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
  const token = (parts[parts.length - 1] ?? "").toUpperCase();
  const channel = KNOWN[token];
  return channel ? { channel, unknown: false } : { channel: "OTHER", unknown: true };
}
