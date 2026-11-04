import { describe, expect, it } from "vitest";
import { daftarAsal } from "./daftar-asal";

describe("daftarAsal", () => {
  it("rincian kembali ke daftar induknya", () => {
    expect(daftarAsal("/backoffice/field-sales-orders/tidakada123")).toBe("/backoffice/field-sales-orders");
    expect(daftarAsal("/backoffice/promos/tidakada123")).toBe("/backoffice/promos");
    expect(daftarAsal("/backoffice/vendor-returns/x/edit")).toBe("/backoffice/vendor-returns/x");
  });

  it("GRN dan penyesuaian kembali ke tab Inventori", () => {
    expect(daftarAsal("/backoffice/inventory/grn/x")).toBe("/backoffice/inventory?tab=grn");
    expect(daftarAsal("/backoffice/inventory/adjustment/x")).toBe("/backoffice/inventory?tab=adjustments");
  });

  it("alamat tingkat atas atau di luar kantor → tanpa daftar", () => {
    expect(daftarAsal("/backoffice/tidak-ada")).toBeNull();
    expect(daftarAsal("/pwa/x/y")).toBeNull();
    expect(daftarAsal(null)).toBeNull();
    expect(daftarAsal("/backoffice/promos/x/")).toBe("/backoffice/promos");
  });
});
