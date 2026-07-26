export function salesorderNoForSettlement(marketplace: string, orderNo: string): string | null {
  const key = orderNo.trim();
  if (!key) return null;
  switch (marketplace) {
    case "SHOPEE":
      return `SP-${key}`;
    case "TIKTOK":
    case "TOKOPEDIA":
      // No prefix — the match target is `SalesOrder.channelOrderNo` (Sub-C),
      // not a reconstructed `salesorderNo`. `match.ts` selects the lookup
      // column per marketplace.
      return key;
    default:
      return null;
  }
}
