import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Menghapus kategori barang: setiap penolakan penulisnya sampai ke layar dengan kodenya sendiri —
 * masih dipakai barang (`IN_USE`), masih punya tarif komisi SPG (`HAS_COMMISSION_RATES`), atau sudah
 * tercatat di baris nota SPG sebagai kategori saat terjual (`HAS_SALE_LINES`, P69). Dulu yang
 * terakhir terbaca sebagai tarif komisi. Tanpa basis data: penulisnya ditiru.
 */
const h = vi.hoisted(() => {
  class ItemCategoryDeleteError extends Error {
    constructor(readonly code: "HAS_ITEMS" | "HAS_COMMISSION_RATES" | "HAS_SALE_LINES") {
      super(code);
    }
  }
  class ItemCategoryError extends Error {
    constructor(
      readonly code: "DUPLICATE_CODE",
      readonly count?: number,
    ) {
      super(code);
    }
  }
  return { ItemCategoryDeleteError, ItemCategoryError, hapus: vi.fn() };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", permissions: ["items:delete"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/item-categories/queries", () => ({ listItemCategories: vi.fn(), listItemCategoriesWithUsage: vi.fn() }));
vi.mock("@/lib/item-categories/mutations", () => ({
  createItemCategoryRecord: vi.fn(),
  updateItemCategoryRecord: vi.fn(),
  deleteItemCategoryRecord: h.hapus,
  ItemCategoryDeleteError: h.ItemCategoryDeleteError,
  ItemCategoryError: h.ItemCategoryError,
}));

const { deleteItemCategory } = await import("./item-categories");

beforeEach(() => {
  h.hapus.mockReset().mockResolvedValue(undefined);
});

describe("deleteItemCategory — kode penolakan", () => {
  it.each([
    ["HAS_ITEMS", "IN_USE"],
    ["HAS_COMMISSION_RATES", "HAS_COMMISSION_RATES"],
    ["HAS_SALE_LINES", "HAS_SALE_LINES"],
  ] as const)("penulis menolak %s → %s", async (kodePenulis, kodeLayar) => {
    h.hapus.mockRejectedValue(new h.ItemCategoryDeleteError(kodePenulis));
    expect(await deleteItemCategory("c1")).toEqual({ ok: false, code: kodeLayar });
  });

  it("berhasil bila penulis tidak menolak", async () => {
    expect(await deleteItemCategory("c1")).toEqual({ ok: true });
    expect(h.hapus).toHaveBeenCalledWith("c1");
  });
});
