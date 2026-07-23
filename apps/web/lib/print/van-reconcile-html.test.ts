import { describe, it, expect } from "vitest";
import { buildVanReconcilePrintHtml } from "./van-reconcile-html";

const labels = { title: "REKONSILIASI VAN", doc: "No. Dokumen", canvasser: "Canvasser", reconciledBy: "Direkonsiliasi oleh", date: "Tanggal", product: "Produk", expected: "Ekspektasi", counted: "Hitung", variance: "Selisih", totalReturned: "Total kembali", totalVariance: "Total selisih", reason: "Alasan", canvasserSign: "Canvasser", adminSign: "Admin", issuedBy: "Diterbitkan oleh" };

describe("buildVanReconcilePrintHtml", () => {
  it("renders expected/counted/variance and flags a nonzero variance row", () => {
    const html = buildVanReconcilePrintHtml({
      docNo: "VANRECON/2607/0001", createdAt: "2026-07-20T00:00:00Z", canvasserName: "Budi", reconciledByName: "Admin",
      note: "1 hilang", totalReturnedQty: 9, totalVarianceQty: 1,
      lines: [{ productName: "Kaos", variantSku: "K-M", expectedQty: 10, countedQty: 9, varianceQty: 1 }], labels,
    });
    expect(html).toContain("REKONSILIASI VAN");
    expect(html).toContain("VANRECON/2607/0001");
    expect(html).toContain("row-over"); // variance ≠ 0 highlighted
    expect(html).toContain("1 hilang");
  });
});
