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

/** A new finished good must say where it is sold — Marketplace, offline stores, or both (owner answer P3). */
export class SalesChannelRequiredError extends Error {
  constructor() {
    super("Choose where this item is sold");
    this.name = "SalesChannelRequiredError";
  }
}

/** A product push for the item is still on its way; changing the channel now could skip it. */
export class SalesChannelPushInFlightError extends Error {
  constructor() {
    super("A product push for this item is still in flight");
    this.name = "SalesChannelPushInFlightError";
  }
}

/**
 * A product already in Jubelio cannot become "Toko offline saja" yet: the deactivation push (P72)
 * could not be built, so it would never deactivate.
 */
export class SalesChannelCannotDeactivateError extends Error {
  constructor(public readonly alasan: "TANPA_HARGA_TERKONFIRMASI" | "KATEGORI_BELUM_DIPETAKAN" | "BAWAAN_BELUM_ADA") {
    super(`Cannot deactivate the item in Jubelio: ${alasan}`);
    this.name = "SalesChannelCannotDeactivateError";
  }
}

/**
 * A product already in Jubelio cannot be sold on the marketplace again yet: the reactivation push
 * could not be built, so it would stay inactive in Jubelio.
 */
export class SalesChannelCannotActivateError extends Error {
  constructor(public readonly alasan: "KATEGORI_BELUM_DIPETAKAN" | "BAWAAN_BELUM_ADA") {
    super(`Cannot activate the item in Jubelio again: ${alasan}`);
    this.name = "SalesChannelCannotActivateError";
  }
}
