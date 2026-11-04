import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth, penulis, dan penaut sumber ditirukan (perilakunya di
 * basis data diuji di `lib/field-sales/isi-keranjang-batal.test.ts`). Yang
 * dipasak di aksi: ubah pesanan memindahkan dokumen sumber pesanan lama ke
 * penggantinya, sumber keranjang ditautkan ke pesanan baru (juga saat datang
 * dari antrean HP), dan tidak ada yang disentuh kalau pesanan tidak tercatat.
 */
const { mockAuth, mockCreate, mockTautkan, mockRapikan, urutan } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockTautkan: vi.fn(),
  mockRapikan: vi.fn(),
  urutan: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ tautkanSumberPesanan: mockTautkan, rapikanSumberPesananBatal: mockRapikan }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: mockCreate }));
vi.mock("@elorae/db", () => ({ prisma: {} }));

import { PesananLamaTidakBisaDigantiError } from "@/lib/field-sales/ganti-pesanan";
import { submitFieldSalesOrder } from "./actions";

const baris = [{ itemId: "kaos", variantSku: "M", productName: "Kaos M", qty: 6, unitPrice: 35000 }];

describe("submitFieldSalesOrder — dokumen sumber (unit)", () => {
  beforeEach(() => {
    urutan.length = 0;
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockCreate.mockReset().mockResolvedValue({ orderId: "baru1", orderNo: "PUTUS/2", creditHold: false, kreditDitahan: false });
    mockTautkan.mockReset().mockImplementation(async () => void urutan.push("tautkan"));
    mockRapikan.mockReset().mockImplementation(async () => {
      urutan.push("rapikan");
      return { dibuka: 0, dipindah: 1 };
    });
  });

  it("an edit moves the old order's request/recommendation to the replacement, before linking the cart's own source", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, gantiOrderId: "lama1", sumber: "permintaan:req1" });
    expect(r).toEqual({ ok: true, orderId: "baru1", orderNo: "PUTUS/2", creditHold: false, kreditDitahan: false });
    // Dibatasi ke pesanan milik salesman ini: kiriman ulang tidak memeriksa ulang pemilik pesanan lama.
    expect(mockRapikan).toHaveBeenCalledWith("lama1", { salesmanId: "u1" });
    expect(mockTautkan).toHaveBeenCalledWith(
      { jenis: "permintaan", id: "req1" },
      { orderId: "baru1", orderNo: "PUTUS/2", userId: "u1", storeId: "s1" },
    );
    expect(urutan).toEqual(["rapikan", "tautkan"]);
  });

  it("an order from the phone queue links its source the same way; a plain order touches nothing", async () => {
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, idempotencyKey: "lokal-1", sumber: "rekomendasi:rk1" });
    expect(mockTautkan).toHaveBeenCalledWith({ jenis: "rekomendasi", id: "rk1" }, expect.objectContaining({ orderId: "baru1" }));
    expect(mockRapikan).not.toHaveBeenCalled();

    mockTautkan.mockClear();
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, sumber: null });
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, sumber: "pesanan:../x" });
    expect(mockTautkan).not.toHaveBeenCalled();
    expect(mockRapikan).not.toHaveBeenCalled();
  });

  it("nothing is moved or linked when the order was not recorded", async () => {
    mockCreate.mockRejectedValueOnce(new PesananLamaTidakBisaDigantiError());
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, gantiOrderId: "lama1", sumber: "permintaan:req1" });
    expect(r).toEqual({ ok: false, code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" });
    expect(mockRapikan).not.toHaveBeenCalled();
    expect(mockTautkan).not.toHaveBeenCalled();
  });
});
