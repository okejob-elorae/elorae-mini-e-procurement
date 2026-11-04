import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockTx } = vi.hoisted(() => ({ mockCreate: vi.fn(), mockTx: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/jubelio/product-push", () => ({
  enqueueProductPushOnUpdate: vi.fn().mockResolvedValue(undefined),
  createProductPushRow: vi.fn(),
  fireProductPushNow: vi.fn(),
}));
// The real module imports runSerializable, which reads Prisma at load and @elorae/db is faked here.
vi.mock("@/lib/jubelio/harga/pengajuan", () => ({
  dataPengajuanJubelio: vi.fn((olehUserId: string | null) => ({ jubelioCreateRequestedAt: new Date(), jubelioCreateRequestedById: olehUserId })),
  ajukanKeJubelio: vi.fn(),
}));
vi.mock("@/lib/db/tx-retry", () => ({ withRetry: (fn: () => Promise<unknown>) => fn(), runSerializable: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn().mockResolvedValue("Admin") }));
vi.mock("@/lib/notifications/events", () => ({ notifyItemCreated: vi.fn() }));
vi.mock("@elorae/db", () => ({
  ItemType: {},
  prisma: { $transaction: mockTx },
}));
vi.mock("@/lib/items/mutations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/items/mutations")>("@/lib/items/mutations");
  return { ...actual, createItem: mockCreate };
});

import { auth } from "@/lib/auth";
import { createProductPushRow, enqueueProductPushOnUpdate, fireProductPushNow } from "@/lib/jubelio/product-push";
import {
  ColorsNotInMasterError,
  DuplicateVariantBarcodeError,
  DuplicateVariantSkuError,
  ItemSkuExistsError,
  SalesChannelCannotActivateError,
  SalesChannelCannotDeactivateError,
  SalesChannelPushInFlightError,
  SalesChannelRequiredError,
} from "@/lib/items/save-refusals";
import { VariantBarcodeTakenError, VariantSkuTakenError } from "@/lib/items/variant-sku-collisions";
import { createItem, updateItem } from "./items";

const data = { nameId: "t", nameEn: "t", type: "FABRIC", uomId: "u" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } } as never);
});

describe("createItem", () => {
  it("passes the session user so a new marketplace finished good is requested for Jubelio, and pushes nothing", async () => {
    mockCreate.mockResolvedValue({ item: { id: "i1", nameEn: "t", nameId: "t", sku: "S" }, serialized: { id: "i1" } });
    expect(await createItem(data)).toEqual({ success: true, item: { id: "i1" } });
    expect(mockCreate).toHaveBeenCalledWith(data, { olehUserId: "u1" });
    expect(createProductPushRow).not.toHaveBeenCalled();
    expect(fireProductPushNow).not.toHaveBeenCalled();
  });

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
    [new SalesChannelRequiredError(), "SALES_CHANNEL_REQUIRED", ""],
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

  it.each([
    [new SalesChannelPushInFlightError(), "SALES_CHANNEL_PUSH_IN_FLIGHT", ""],
    [new SalesChannelCannotDeactivateError("TANPA_HARGA_TERKONFIRMASI"), "SALES_CHANNEL_CANNOT_DEACTIVATE", "TANPA_HARGA_TERKONFIRMASI"],
    [new SalesChannelCannotActivateError("BAWAAN_BELUM_ADA"), "SALES_CHANNEL_CANNOT_ACTIVATE", "BAWAAN_BELUM_ADA"],
  ])("returns a typed sales-channel refusal for %s, saving nothing", async (error, code, detail) => {
    mockTx.mockRejectedValue(error);
    expect(await updateItem("i1", data)).toEqual({ success: false, code, detail });
    expect(fireProductPushNow).not.toHaveBeenCalled();
  });

  const hasil = (kirimanSaluran: { outboxId: string } | null) => ({
    updated: {
      serialized: { id: "i1" },
      kirimanSaluran,
      before: { sellingPrice: 1, nameId: "a" },
      after: { sellingPrice: 1, nameId: "b" },
    },
  });

  it("fires the channel push (P72 deactivation) after commit and queues no second push", async () => {
    mockTx.mockResolvedValue(hasil({ outboxId: "row-7" }));
    expect(await updateItem("i1", data)).toEqual({ success: true, item: { id: "i1" } });
    expect(fireProductPushNow).toHaveBeenCalledWith("row-7", "u1");
    expect(enqueueProductPushOnUpdate).not.toHaveBeenCalled();
  });

  it("without a channel push, an ordinary edit goes through enqueueProductPushOnUpdate", async () => {
    mockTx.mockResolvedValue(hasil(null));
    await updateItem("i1", data);
    expect(fireProductPushNow).not.toHaveBeenCalled();
    expect(enqueueProductPushOnUpdate).toHaveBeenCalledTimes(1);
  });
});
