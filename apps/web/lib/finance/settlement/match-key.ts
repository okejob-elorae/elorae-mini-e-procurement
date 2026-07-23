export function salesorderNoForSettlement(marketplace: string, orderNo: string): string | null {
  const key = orderNo.trim();
  if (!key) return null;
  switch (marketplace) {
    case "SHOPEE":
      return `SP-${key}`;
    default:
      return null; // TOKOPEDIA (TT-…) etc. not yet supported
  }
}
