import { describe, expect, it } from "vitest";
import { DEFAULT_VARIANT_BARCODE_TEMPLATE } from "@/lib/items/variant-barcode";
import { CONTOH_BARANG_BARCODE, contohBarcode, FORMAT_SIAP_PAKAI } from "./contoh-barcode";

describe("contohBarcode — pratinjau langsung format barcode varian", () => {
  it("format siap pakai pemilik menghasilkan bentuk label yang sudah ada (01 + artikel + ukuran)", () => {
    const pemilik = FORMAT_SIAP_PAKAI.find((f) => f.id === "pemilik");
    expect(pemilik).toBeDefined();
    expect(contohBarcode(pemilik!.template)).toBe("0127000038PS");
  });

  it("format bawaan pada contoh yang sama", () => {
    expect(contohBarcode(DEFAULT_VARIANT_BARCODE_TEMPLATE)).toBe("01000038NAVYS");
  });

  it("template kosong → string kosong (tombol simpan menahan)", () => {
    expect(contohBarcode("   ")).toBe("");
  });

  it("contoh barang memakai artikel milik pemilik", () => {
    expect(CONTOH_BARANG_BARCODE.parentSku).toBe("27000038P");
  });
});
