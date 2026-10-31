import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi pesanan isi ulang dari HP — tanpa basis data, semua tiruan. Yang dijaga:
 * hanya toko KONSI, nama barang dibaca dari master (bukan dari HP), harga
 * tidak pernah dikirim, baris kembar digabung, dan galat penulis menjadi kode.
 */

const state = {
  termsType: "KONSI" as "KONSI" | "PUTUS",
  items: [{ id: "i1", nameId: "Blus Kenanga", variants: [{ sku: "i1-M", size: "M" }] }] as { id: string; nameId: string; variants: unknown }[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "sales1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({
  prisma: {
    store: { findUnique: vi.fn(async () => ({ termsType: state.termsType, isActive: true })) },
    item: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => state.items.filter((i) => where.id.in.includes(i.id))),
    },
  },
}));

class NoActiveVisitError extends Error {}
class MinQtyViolationError extends Error {}
vi.mock("@/lib/field-sales/errors", () => ({ NoActiveVisitError, MinQtyViolationError }));
const createFieldSalesOrder = vi.fn();
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder }));

const { kirimPesananIsiUlang } = await import("./isi-ulang-actions");

const MASUK = {
  storeId: "s1",
  visitId: "v1",
  idempotencyKey: "k1",
  lines: [
    { itemId: "i1", variantSku: "i1-M", qty: 2 },
    { itemId: "i1", variantSku: "i1-M", qty: 3 },
  ],
};

beforeEach(() => {
  state.termsType = "KONSI";
  createFieldSalesOrder.mockReset();
  createFieldSalesOrder.mockResolvedValue({ orderId: "o1", orderNo: "KONSI/0001", oversell: [], kreditDitahan: false });
});

describe("kirimPesananIsiUlang", () => {
  it("membuat pesanan konsinyasi lewat penulis biasa, baris kembar digabung, nama dari master", async () => {
    expect(await kirimPesananIsiUlang(MASUK)).toEqual({ ok: true, orderNo: "KONSI/0001" });
    expect(createFieldSalesOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "s1",
        salesmanId: "sales1",
        visitId: "v1",
        idempotencyKey: "k1",
        lines: [{ itemId: "i1", variantSku: "i1-M", productName: "Blus Kenanga — M", qty: 5, unitPrice: 0 }],
      }),
    );
  });

  it("menolak toko PUTUS", async () => {
    state.termsType = "PUTUS";
    expect(await kirimPesananIsiUlang(MASUK)).toEqual({ ok: false, code: "BUKAN_KONSI" });
    expect(createFieldSalesOrder).not.toHaveBeenCalled();
  });

  it("menolak barang yang tidak dikenal", async () => {
    expect(await kirimPesananIsiUlang({ ...MASUK, lines: [{ itemId: "x", variantSku: "", qty: 1 }] })).toEqual({
      ok: false,
      code: "BARANG_TIDAK_DIKENAL",
    });
  });

  it("menolak jumlah nol atau tanpa kunjungan", async () => {
    expect(await kirimPesananIsiUlang({ ...MASUK, lines: [{ itemId: "i1", variantSku: "i1-M", qty: 0 }] })).toEqual({ ok: false, code: "INVALID" });
    expect(await kirimPesananIsiUlang({ ...MASUK, visitId: "" })).toEqual({ ok: false, code: "INVALID" });
  });

  it("kunjungan yang sudah ditutup menjadi kode, bukan galat", async () => {
    createFieldSalesOrder.mockRejectedValue(new NoActiveVisitError());
    expect(await kirimPesananIsiUlang(MASUK)).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });
});
