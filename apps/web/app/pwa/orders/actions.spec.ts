import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth, penulis, dan perapian sumber ditirukan (perilakunya di basis
 * data diuji di `lib/field-sales/isi-keranjang-batal.test.ts`). Yang dipasak di
 * aksi: membatalkan pesanan sendiri ikut membuka lagi permintaan SPG /
 * rekomendasi yang ditautkan ke pesanan itu — sebelumnya tetap DIPROSES/SELESAI
 * menunjuk pesanan yang sudah batal — dan perapian dibatasi ke salesman ini.
 */
const { mockAuth, mockBatal, mockRapikan, urutan } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockBatal: vi.fn(),
  mockRapikan: vi.fn(),
  urutan: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/field-sales/writer", () => ({ cancelFieldSalesOrderBySalesman: mockBatal }));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ rapikanSumberPesananBatal: mockRapikan }));
vi.mock("@/lib/field-sales/pwa-queries", () => ({ salinanPesananSaya: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { BatalPesananError } from "@/lib/field-sales/ganti-pesanan";
import { batalkanPesananSayaAction } from "./actions";

describe("batalkanPesananSayaAction — dokumen sumber (unit)", () => {
  beforeEach(() => {
    urutan.length = 0;
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockBatal.mockReset().mockImplementation(async () => {
      urutan.push("batal");
      return { orderNo: "PUTUS/7" };
    });
    mockRapikan.mockReset().mockImplementation(async () => {
      urutan.push("rapikan");
      return { dibuka: 1, dipindah: 0 };
    });
  });

  it("cancelling reopens the linked request, scoped to this salesman, after the cancel commits", async () => {
    const r = await batalkanPesananSayaAction("pesanan1", "toko batal pesan");
    expect(r).toEqual({ ok: true, orderNo: "PUTUS/7" });
    expect(mockRapikan).toHaveBeenCalledWith("pesanan1", { salesmanId: "u1" });
    expect(urutan).toEqual(["batal", "rapikan"]);
  });

  it("a refused cancel touches no source document", async () => {
    mockBatal.mockReset().mockRejectedValue(new BatalPesananError("SUDAH_DIPUTUSKAN"));
    const r = await batalkanPesananSayaAction("pesanan1", "toko batal pesan");
    expect(r).toEqual({ ok: false, code: "SUDAH_DIPUTUSKAN" });
    expect(mockRapikan).not.toHaveBeenCalled();
  });

  it("no phone access: nothing is cancelled or tidied", async () => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: [] } });
    const r = await batalkanPesananSayaAction("pesanan1", "toko batal pesan");
    expect(r).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(mockBatal).not.toHaveBeenCalled();
    expect(mockRapikan).not.toHaveBeenCalled();
  });
});
