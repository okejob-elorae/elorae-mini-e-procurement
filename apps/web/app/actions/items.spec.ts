import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockTx } = vi.hoisted(() => ({ mockCreate: vi.fn(), mockTx: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/jubelio/product-push", () => ({
  enqueueProductPushOnCreate: vi.fn().mockResolvedValue(undefined),
  enqueueProductPushOnUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn().mockResolvedValue("Admin") }));
vi.mock("@/lib/notifications/events", () => ({ notifyItemCreated: vi.fn() }));
vi.mock("@elorae/db", () => ({
  ItemType: {},
  prisma: { $transaction: mockTx },
  recalcItemSellingPrice: vi.fn(),
}));
vi.mock("@/lib/items/mutations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/items/mutations")>("@/lib/items/mutations");
  return { ...actual, createItem: mockCreate };
});

import { auth } from "@/lib/auth";
import {
  ColorsNotInMasterError,
  DuplicateVariantBarcodeError,
  DuplicateVariantSkuError,
  ItemSkuExistsError,
} from "@/lib/items/save-refusals";
import { VariantBarcodeTakenError, VariantSkuTakenError } from "@/lib/items/variant-sku-collisions";
import { createItem, updateItem } from "./items";

const data = { nameId: "t", nameEn: "t", type: "FABRIC", uomId: "u" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } } as never);
});

describe("createItem", () => {
  it("returns a typed refusal for a taken variant barcode instead of throwing", async () => {
    mockCreate.mockRejectedValue(new VariantBarcodeTakenError(["899123"]));
    expect(await createItem(data)).toEqual({ success: false, code: "VARIANT_BARCODE_TAKEN", detail: "899123" });
  });

  it("returns a typed refusal for a taken variant SKU", async () => {
    mockCreate.mockRejectedValue(new VariantSkuTakenError(["A-1", "A-2"]));
    expect(await createItem(data)).toEqual({ success: false, code: "VARIANT_SKU_TAKEN", detail: "A-1, A-2" });
  });

  it.each([
    [new ItemSkuExistsError("A-1"), "ITEM_SKU_EXISTS", "A-1"],
    [new ColorsNotInMasterError(["Merah", "Biru"]), "COLOR_NOT_IN_MASTER", "Merah, Biru"],
    [new DuplicateVariantSkuError("A-2"), "DUPLICATE_VARIANT_SKU", "A-2"],
    [new DuplicateVariantBarcodeError("899"), "DUPLICATE_VARIANT_BARCODE", "899"],
  ])("returns a typed refusal for %s", async (error, code, detail) => {
    mockCreate.mockRejectedValue(error);
    expect(await createItem(data)).toEqual({ success: false, code, detail });
  });

  it("still throws a plain Error even when its message matches a typed refusal", async () => {
    mockCreate.mockRejectedValue(new Error("SKU already exists"));
    await expect(createItem(data)).rejects.toThrow("SKU already exists");
  });

  it("still throws unknown errors", async () => {
    mockCreate.mockRejectedValue(new Error("boom"));
    await expect(createItem(data)).rejects.toThrow("boom");
  });
});

describe("updateItem", () => {
  it("returns a typed refusal when the transaction aborts on a barcode collision", async () => {
    mockTx.mockRejectedValue(new VariantBarcodeTakenError(["899123"]));
    expect(await updateItem("i1", data)).toEqual({
      success: false,
      code: "VARIANT_BARCODE_TAKEN",
      detail: "899123",
    });
  });

  it("returns a typed refusal when the transaction aborts on a colour-master refusal", async () => {
    mockTx.mockRejectedValue(new ColorsNotInMasterError(["Merah"]));
    expect(await updateItem("i1", data)).toEqual({ success: false, code: "COLOR_NOT_IN_MASTER", detail: "Merah" });
  });

  it("still throws unknown errors", async () => {
    mockTx.mockRejectedValue(new Error("boom"));
    await expect(updateItem("i1", data)).rejects.toThrow("boom");
  });
});
