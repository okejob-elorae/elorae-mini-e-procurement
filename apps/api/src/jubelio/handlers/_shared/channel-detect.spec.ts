import { detectChannel } from "./channel-detect";

describe("detectChannel", () => {
  it("maps Tokopedia source_name", () => {
    expect(detectChannel("Shop | Tokopedia")).toEqual({ channel: "TOKOPEDIA", unknown: false });
  });

  it("maps Shopee source_name", () => {
    expect(detectChannel("Shop | Shopee")).toEqual({ channel: "SHOPEE", unknown: false });
  });

  it("maps TikTok source_name (mixed case)", () => {
    expect(detectChannel("Shop | TikTok")).toEqual({ channel: "TIKTOK", unknown: false });
  });

  it("falls back to OTHER for unknown marketplace, flags unknown=true", () => {
    expect(detectChannel("Shop | Lazada")).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for empty string", () => {
    expect(detectChannel("")).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for null", () => {
    expect(detectChannel(null)).toEqual({ channel: "OTHER", unknown: true });
  });

  it("falls back to OTHER for undefined", () => {
    expect(detectChannel(undefined)).toEqual({ channel: "OTHER", unknown: true });
  });

  it("handles no separator (whole string is the token)", () => {
    expect(detectChannel("Tokopedia")).toEqual({ channel: "TOKOPEDIA", unknown: false });
  });

  it("strips whitespace and is case-insensitive", () => {
    expect(detectChannel("Shop |   shopee  ")).toEqual({ channel: "SHOPEE", unknown: false });
  });
});
