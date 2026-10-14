import { describe, it, expect } from "vitest";
import { SALES_RETURN_RECEIVED, buildSalesReturnBellCopy } from "./bell-copy";

const BASE = {
  jubelioReturnNo: "RET-001",
  channelOrderNo: "2410130001",
  channel: "SHOPEE",
  totalQty: 2,
  totalValue: 150000,
  salesorderNo: "SO-1",
};

describe("buildSalesReturnBellCopy", () => {
  it("names the category", () => {
    expect(SALES_RETURN_RECEIVED).toBe("SALES_RETURN_RECEIVED");
  });

  it("titles by channel and the Jubelio return number", () => {
    const { title, message } = buildSalesReturnBellCopy(BASE);
    expect(title).toBe("Retur baru dari Shopee — RET-001");
    expect(message).toBe("2 pcs senilai Rp 150.000 · pesanan SO-1. Menunggu keputusan.");
  });

  it("falls back to the channel order number, then to 'tanpa nomor'", () => {
    expect(buildSalesReturnBellCopy({ ...BASE, jubelioReturnNo: null }).title).toBe("Retur baru dari Shopee — 2410130001");
    expect(buildSalesReturnBellCopy({ ...BASE, jubelioReturnNo: "", channelOrderNo: null }).title).toBe("Retur baru dari Shopee — tanpa nomor");
    expect(buildSalesReturnBellCopy({ ...BASE, jubelioReturnNo: null, channelOrderNo: "  " }).title).toBe("Retur baru dari Shopee — tanpa nomor");
  });

  it("labels every channel", () => {
    const label = (channel: string) => buildSalesReturnBellCopy({ ...BASE, channel }).title;
    expect(label("TIKTOK")).toBe("Retur baru dari TikTok — RET-001");
    expect(label("TOKOPEDIA")).toBe("Retur baru dari Tokopedia — RET-001");
    expect(label("OTHER")).toBe("Retur baru dari Lainnya — RET-001");
    expect(label("OFFLINE")).toBe("Retur baru dari Offline — RET-001");
    expect(label("NEW_CHANNEL")).toBe("Retur baru dari NEW_CHANNEL — RET-001");
  });

  it("omits the order part when the return is not linked to an order", () => {
    expect(buildSalesReturnBellCopy({ ...BASE, salesorderNo: null }).message).toBe("2 pcs senilai Rp 150.000. Menunggu keputusan.");
  });

  it("keeps fractional quantities and sen", () => {
    expect(buildSalesReturnBellCopy({ ...BASE, totalQty: 1.5, totalValue: 150000.5 }).message).toContain("1,5 pcs senilai Rp 150.000,5");
  });

  it("caps the title at 191 characters", () => {
    const { title } = buildSalesReturnBellCopy({ ...BASE, jubelioReturnNo: "R".repeat(400) });
    expect(Array.from(title).length).toBeLessThanOrEqual(191);
    expect(title.startsWith("Retur baru dari Shopee — ")).toBe(true);
  });
});
