import { buildVariantBarcode, DEFAULT_VARIANT_BARCODE_TEMPLATE, type VariantBarcodeContext } from "@/lib/items/variant-barcode";

/**
 * Pratinjau langsung di Pengaturan → Kode item. Contohnya label pemilik:
 * barcode `0127000038PS` = "01" + artikel `27000038P` + ukuran `S`
 * ("01" pengisi tanpa arti — pemilik, 2026-10-03).
 */
export const CONTOH_BARANG_BARCODE: VariantBarcodeContext = {
  parentSku: "27000038P",
  categoryCode: "01",
  combo: { Warna: "Navy", Size: "S" },
  orderedAttributeKeys: ["Warna", "Size"],
};

/** Format siap pakai yang bisa dipilih dengan satu klik. */
export const FORMAT_SIAP_PAKAI = [
  { id: "pemilik", template: "01{parentSku}{attr:Size}" },
  { id: "bawaan", template: DEFAULT_VARIANT_BARCODE_TEMPLATE },
] as const;

export function contohBarcode(template: string): string {
  if (!template.trim()) return "";
  return buildVariantBarcode({ template: template.trim() }, CONTOH_BARANG_BARCODE);
}
