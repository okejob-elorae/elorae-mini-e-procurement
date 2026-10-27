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

  it("still throws unknown errors", async () => {
    mockTx.mockRejectedValue(new Error("boom"));
    await expect(updateItem("i1", data)).rejects.toThrow("boom");
  });
});
