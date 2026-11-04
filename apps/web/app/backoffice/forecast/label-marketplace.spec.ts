import { expect, it } from "vitest";
import { labelBulanTahun, namaMarketplace } from "./label-marketplace";

it("nama marketplace dan periode rapi", () => {
  expect(namaMarketplace("SHOPEE")).toBe("Shopee");
  expect(namaMarketplace("TIKTOK")).toBe("TikTok");
  expect(namaMarketplace("BLIBLI")).toBe("Blibli");
  expect(labelBulanTahun(10, 2026)).toBe("Oktober 2026");
  expect(labelBulanTahun(1, 2027, "en-GB")).toBe("January 2027");
});
