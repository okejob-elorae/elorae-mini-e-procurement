import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/spg/sale-queries", () => ({ getSellableCatalogForSpg: vi.fn() }));

import { getSellableCatalogForSpg, type SpgCatalogRow } from "@/lib/spg/sale-queries";
import type { BarisStok } from "@/lib/spg/queries";
import { pilihanBarang } from "./pilihan";

const mockKatalog = vi.mocked(getSellableCatalogForSpg);

const katalog = (itemId: string, sku: string, variantSku: string | null, barcode: string | null): SpgCatalogRow => ({
  itemId,
  sku,
  productName: itemId,
  variantSku,
  variantLabel: variantSku,
  price: 5000,
  onCounterQty: 0,
  barcode,
  stok: null,
  categoryId: null,
});

const saldo = (itemId: string, sku: string, variantSku: string, qty: number): BarisStok => ({
  itemId,
  variantSku,
  sku,
  nama: itemId,
  varian: variantSku || null,
  qty,
});

describe("pilihanBarang", () => {
  beforeEach(() => {
    mockKatalog.mockReset();
  });

  it("asks the catalog to keep every item already in the store's book", async () => {
    mockKatalog.mockResolvedValue([]);
    await pilihanBarang([saldo("kaos", "KAOS-M", "KAOS-M", 2), saldo("kaos", "KAOS-L", "KAOS-L", 1), saldo("topi", "TOPI", "", 3)]);
    expect(mockKatalog).toHaveBeenCalledWith(undefined, { tetapTampilkan: ["kaos", "topi"] });
  });

  it("a deactivated item the store holds is listed only through its balance rows — no catalog barcode, no size it never held", async () => {
    /* The catalog never lists a deactivated item (getSellableCatalogForSpg filters isActive for every
     * caller), so only the active item comes back. */
    mockKatalog.mockResolvedValue([katalog("aktif", "AKTIF", null, "BC-AKTIF")]);
    const hasil = await pilihanBarang([saldo("nonaktif", "NONAKTIF-M", "NONAKTIF-M", 4)]);

    const nonaktif = hasil.filter((b) => b.itemId === "nonaktif");
    expect(nonaktif).toHaveLength(1);
    expect(nonaktif[0]).toMatchObject({ variantSku: "NONAKTIF-M", stok: 4, dilacak: true, barcode: null });

    expect(hasil.find((b) => b.itemId === "aktif")).toMatchObject({ barcode: "BC-AKTIF", stok: 0, dilacak: false });
  });
});
