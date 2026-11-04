import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/items/import/lookups", () => ({ loadItemImportLookups: vi.fn() }));
vi.mock("@/lib/items/import/writer", async () => {
  class ItemImportSkuTakenError extends Error {}
  return { createItemsFromImport: vi.fn(), ItemImportSkuTakenError };
});
vi.mock("@/lib/jubelio/product-push", () => ({ createProductPushRow: vi.fn(), fireProductPushNow: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn().mockResolvedValue("Admin") }));
vi.mock("@/lib/notifications/recipients", () => ({
  getUsersWithPermission: vi.fn().mockResolvedValue([]),
  sendNotificationToUsers: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { loadItemImportLookups } from "@/lib/items/import/lookups";
import { createItemsFromImport, ItemImportSkuTakenError } from "@/lib/items/import/writer";
import { createProductPushRow } from "@/lib/jubelio/product-push";
import { commitItemImport, previewItemImport } from "./item-import";

const lookups = (existing: string[] = []) => ({
  uoms: [{ id: "uom-pcs", code: "PCS" }],
  categories: [],
  existingItemSkus: new Set(existing),
  existingVariantSkus: new Set<string>(),
  existingBarcodes: new Set<string>(),
});
const rows = [
  { row: 2, artikel: "KMJ-01", nama: "Kemeja", namaEn: "", kategori: "", satuan: "PCS", hargaJual: 100, warna: "Merah", ukuran: "M", skuVarian: "", barcode: "", deskripsi: "" },
  { row: 3, artikel: "SYL-01", nama: "Syal", namaEn: "", kategori: "", satuan: "PCS", hargaJual: null, warna: "", ukuran: "", skuVarian: "", barcode: "", deskripsi: "" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["items:create"] } } as never);
  vi.mocked(loadItemImportLookups).mockResolvedValue(lookups());
  vi.mocked(createItemsFromImport).mockResolvedValue([
    { id: "i1", sku: "KMJ-01", nameId: "Kemeja" },
    { id: "i2", sku: "SYL-01", nameId: "Syal" },
  ]);
});

describe("previewItemImport", () => {
  it("refuses without items:create", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["items:view"] } } as never);
    expect(await previewItemImport(rows)).toEqual({ status: "forbidden" });
  });

  it("returns the validation without writing", async () => {
    const r = await previewItemImport(rows);
    expect(r).toMatchObject({ status: "validated", errors: [], artikelCount: 2, variantCount: 1 });
    expect(createItemsFromImport).not.toHaveBeenCalled();
  });

  it("reports a malformed payload as INVALID_PAYLOAD", async () => {
    const r = await previewItemImport("nope");
    expect(r.status === "validated" && r.errors.map((e) => e.code)).toEqual(["INVALID_PAYLOAD"]);
  });
});

describe("commitItemImport", () => {
  it("refuses without a session or without items:create, reading and writing nothing", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect(await commitItemImport(rows, { salesChannel: "BOTH" })).toEqual({ status: "forbidden" });
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "u1", permissions: ["items:view", "items:edit"] } } as never);
    expect(await commitItemImport(rows, { salesChannel: "BOTH" })).toEqual({ status: "forbidden" });
    expect(loadItemImportLookups).not.toHaveBeenCalled();
    expect(createItemsFromImport).not.toHaveBeenCalled();
  });

  /* Owner answer P3 (2026-11-02): the import's two ticks give every product its channel. */
  it.each([
    ["MARKETPLACE", true],
    ["BOTH", true],
    ["OFFLINE", false],
  ] as const)("sales channel %s → stored on every product, requested for Jubelio = %s, nothing pushed", async (salesChannel, diajukan) => {
    const r = await commitItemImport(rows, { salesChannel });
    expect(r).toMatchObject({ status: "created", salesChannel, jubelioRequested: diajukan });
    expect(r).not.toHaveProperty("jubelioFailed");
    expect(vi.mocked(createItemsFromImport).mock.calls[0][1]).toEqual({ salesChannel, olehUserId: "u1" });
    expect(createProductPushRow).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ salesChannel: "TOKO" }], [null], [{ pushToJubelio: true }]])(
    "without a valid sales channel (%j) refuses with SALES_CHANNEL_REQUIRED and creates nothing",
    async (options) => {
      const r = await commitItemImport(rows, options);
      expect(r.status === "invalid" && r.errors.map((e) => e.code)).toEqual(["SALES_CHANNEL_REQUIRED"]);
      expect(createItemsFromImport).not.toHaveBeenCalled();
    },
  );

  it("re-validates and writes nothing when the file has errors", async () => {
    vi.mocked(loadItemImportLookups).mockResolvedValue(lookups(["kmj-01"]));
    const r = await commitItemImport(rows, { salesChannel: "BOTH" });
    expect(r.status).toBe("invalid");
    expect(createItemsFromImport).not.toHaveBeenCalled();
  });

  it("answers a replay of an already-committed file with ARTIKEL_EXISTS", async () => {
    vi.mocked(loadItemImportLookups).mockResolvedValue(lookups(["kmj-01", "syl-01"]));
    const r = await commitItemImport(rows, { salesChannel: "BOTH" });
    expect(r.status === "invalid" && r.errors.map((e) => e.code)).toEqual(["ARTIKEL_EXISTS", "ARTIKEL_EXISTS"]);
  });

  it("re-validates after a concurrent create took a SKU and names it", async () => {
    vi.mocked(createItemsFromImport).mockRejectedValueOnce(new ItemImportSkuTakenError());
    vi.mocked(loadItemImportLookups)
      .mockResolvedValueOnce(lookups())
      .mockResolvedValueOnce(lookups(["syl-01"]));
    const r = await commitItemImport(rows, { salesChannel: "BOTH" });
    expect(r.status === "invalid" && r.errors.map((e) => [e.code, e.artikel])).toEqual([["ARTIKEL_EXISTS", "SYL-01"]]);
  });

  it("reports SKU_TAKEN when the race cannot be pinned to an artikel", async () => {
    vi.mocked(createItemsFromImport).mockRejectedValueOnce(new ItemImportSkuTakenError());
    const r = await commitItemImport(rows, { salesChannel: "BOTH" });
    expect(r.status === "invalid" && r.errors.map((e) => e.code)).toEqual(["SKU_TAKEN"]);
  });

  it("returns failed on an unexpected writer error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createItemsFromImport).mockRejectedValueOnce(new Error("db down"));
    expect(await commitItemImport(rows, { salesChannel: "BOTH" })).toEqual({ status: "failed" });
  });
});
