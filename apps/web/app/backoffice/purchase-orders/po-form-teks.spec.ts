import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis formulir PO (repo ini tidak punya pustaka render).
 *
 * Formulir PO dulu hampir seluruhnya bahasa Inggris ("Supplier & Delivery",
 * "Line Items", "Include PPN"…), dan tombolnya "Simpan & Kirim" padahal PO
 * yang dibuat berstatus DRAF — belum sampai ke pemasok.
 */
const WEB = path.resolve(__dirname, "../../..");
const FORM = readFileSync(path.join(WEB, "components/forms/POForm.tsx"), "utf8");

describe("formulir PO", () => {
  it("tanpa label Inggris tertulis langsung", () => {
    for (const teks of [
      "Supplier & Delivery",
      "Supplier *",
      "ETA Date",
      "Payment due date",
      "Line Items",
      "Add Item",
      "Price (IDR)",
      "Include PPN",
      "Exclude PPN",
      "Additional Information",
      "Payment Terms",
      "Select variant",
      "Create PO",
      "Update PO",
      "ETA date is in the past",
    ]) {
      expect(FORM, teks).not.toContain(teks);
    }
  });

  it("tombol PO baru jujur: simpan draf / simpan di perangkat, bukan 'Simpan & Kirim'", () => {
    expect(FORM).not.toContain("OfflinePOButton");
    expect(FORM).not.toContain("Simpan & Kirim");
    expect(FORM).toMatch(/t\('simpanDraf'\)/);
    expect(FORM).toMatch(/t\('simpanDiPerangkat'\)/);
  });
});
