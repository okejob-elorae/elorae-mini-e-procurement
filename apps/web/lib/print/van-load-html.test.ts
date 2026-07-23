import { describe, it, expect } from "vitest";
import { buildVanLoadPrintHtml } from "./van-load-html";

const labels = { title: "BUKTI MUAT VAN", doc: "No. Dokumen", canvasser: "Canvasser", loadedBy: "Dimuat oleh", date: "Tanggal", no: "No", product: "Produk", qty: "Qty", adminSign: "Admin gudang", canvasserSign: "Canvasser", issuedBy: "Diterbitkan oleh" };

describe("buildVanLoadPrintHtml", () => {
  it("renders doc no, qty, variant label and NO cost", () => {
    const html = buildVanLoadPrintHtml({
      docNo: "VANLOAD/2607/0001", createdAt: "2026-07-20T00:00:00Z", canvasserName: "Budi", loadedByName: "Admin",
      lines: [{ productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 10 }], labels,
    });
    expect(html).toContain("BUKTI MUAT VAN");
    expect(html).toContain("VANLOAD/2607/0001");
    expect(html).toContain("size: M");
    expect(html).not.toMatch(/Rp\s/); // slip carries no cost
  });
});
