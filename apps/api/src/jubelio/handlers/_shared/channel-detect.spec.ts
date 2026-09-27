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

  describe("salesorder_no prefix wins over source_name", () => {
    it("maps a TT- order to TIKTOK even though Jubelio names the source 'Shop | Tokopedia'", () => {
      expect(detectChannel("Shop | Tokopedia", "TT-584771788142839379-128001")).toEqual({ channel: "TIKTOK", unknown: false });
    });

    it("maps a TP- order to TOKOPEDIA", () => {
      expect(detectChannel("TOKOPEDIA", "TP-584694732723422715-128002")).toEqual({ channel: "TOKOPEDIA", unknown: false });
    });

    it("maps an SP- order to SHOPEE", () => {
      expect(detectChannel("Shop | Shopee", "SP-2606180001ABCD")).toEqual({ channel: "SHOPEE", unknown: false });
    });

    it("maps a prefix even when source_name is missing", () => {
      expect(detectChannel(null, "TT-1-128001")).toEqual({ channel: "TIKTOK", unknown: false });
    });

    it("falls back to source_name for an unknown prefix", () => {
      expect(detectChannel("Shop | Shopee", "LZ-123")).toEqual({ channel: "SHOPEE", unknown: false });
    });

    it("falls back to source_name for a null or empty order number", () => {
      expect(detectChannel("Shop | Tokopedia", null)).toEqual({ channel: "TOKOPEDIA", unknown: false });
      expect(detectChannel("Shop | Tokopedia", "")).toEqual({ channel: "TOKOPEDIA", unknown: false });
    });

    it("is case-sensitive on the prefix, matching Jubelio's upper-case numbering", () => {
      expect(detectChannel("Shop | Shopee", "tt-1-128001")).toEqual({ channel: "SHOPEE", unknown: false });
    });
  });
});
