export class ItemSkuExistsError extends Error {
  constructor(public readonly sku: string) {
    super("SKU already exists");
    this.name = "ItemSkuExistsError";
  }
}

export class ColorsNotInMasterError extends Error {
  constructor(public readonly colors: string[]) {
    super(`Warna not in the colour master: ${colors.join(", ")}. Add it first.`);
    this.name = "ColorsNotInMasterError";
  }
}

export class DuplicateVariantSkuError extends Error {
  constructor(public readonly sku: string) {
    super(`Duplicate variant SKU "${sku}"`);
    this.name = "DuplicateVariantSkuError";
  }
}

export class DuplicateVariantBarcodeError extends Error {
  constructor(public readonly barcode: string) {
    super(`Duplicate variant barcode "${barcode}"`);
    this.name = "DuplicateVariantBarcodeError";
  }
}
