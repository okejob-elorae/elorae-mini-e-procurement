import { parseShopeeSettlement, type ParsedSettlement, type SettlementParseError } from "./shopee-settlement-parser";
import { parseTiktokSettlement } from "./tiktok-settlement-parser";

export type ParseSuccess = { ok: true; data: ParsedSettlement };
export type ParseFailure = { ok: false; errors: SettlementParseError[] };

export const SUPPORTED_MARKETPLACES = ["SHOPEE", "TIKTOK"] as const;
export type SupportedMarketplace = (typeof SUPPORTED_MARKETPLACES)[number];

export function isSupportedMarketplace(value: string): value is SupportedMarketplace {
  return (SUPPORTED_MARKETPLACES as readonly string[]).includes(value);
}

export function parseSettlement(marketplace: string, buffer: Buffer): ParseSuccess | ParseFailure {
  switch (marketplace) {
    case "SHOPEE":
      return parseShopeeSettlement(buffer);
    case "TIKTOK":
      return parseTiktokSettlement(buffer);
    default:
      return {
        ok: false,
        errors: [
          {
            sheet: "",
            row: null,
            message: `Unsupported marketplace "${marketplace}"`,
          },
        ],
      };
  }
}
