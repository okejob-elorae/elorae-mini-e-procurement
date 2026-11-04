import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth dan penulis ditirukan. Yang dipasak: penolakan barang PUTUS
 * tanpa harga sampai ke HP sebagai kode yang jelas (bukan lemparan yang
 * disamarkan di build produksi), membawa id barangnya untuk disebut di layar.
 */
const { mockAuth, mockCreate } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockCreate: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ tautkanSumberPesanan: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: mockCreate }));
vi.mock("@elorae/db", () => ({ prisma: {} }));

import { BarangTanpaHargaError } from "@/lib/field-sales/harga-wajib";
import { submitFieldSalesOrder } from "./actions";

const baris = [
  { itemId: "kaos", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 35000 },
  { itemId: "topi", variantSku: "", productName: "Topi", qty: 6, unitPrice: 0 },
];

describe("submitFieldSalesOrder — barang tanpa harga (unit)", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockCreate.mockReset();
  });

  it("returns BARANG_TANPA_HARGA with the item ids instead of throwing", async () => {
    mockCreate.mockRejectedValueOnce(new BarangTanpaHargaError(["topi"]));
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(r).toEqual({ ok: false, code: "BARANG_TANPA_HARGA", itemIds: ["topi"] });
  });
});
