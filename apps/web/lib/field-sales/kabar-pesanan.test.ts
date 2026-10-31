import { describe, expect, it } from "vitest";
import { kabarPesananDisetujui, kabarPesananDitolak, type KeputusanDisetujui } from "./kabar-pesanan";

const biasa = (s: string) => s.replace(/ /g, " ");
const dasar: KeputusanDisetujui = {
  orderId: "o1",
  orderNo: "PUTUS-001",
  orderType: "PUTUS",
  storeName: "Toko Maju",
  total: 1_250_000,
  ajuanDiubah: 0,
  ajuanDiterima: 0,
  ditambahKantor: 0,
};

describe("kabarPesananDisetujui", () => {
  it("PUTUS: nama toko dan total akhir, menaut ke pesanan", () => {
    const k = kabarPesananDisetujui(dasar);
    expect(k.jenis).toBe("PESANAN_DISETUJUI");
    expect(k.judul).toBe("Pesanan PUTUS-001 disetujui");
    expect(biasa(k.isi)).toBe("Toko Maju · total Rp 1.250.000.");
    expect(k.data).toEqual({ orderId: "o1" });
  });

  it("menyebut harga ajuan yang diubah kantor", () => {
    expect(kabarPesananDisetujui({ ...dasar, ajuanDiubah: 2, ajuanDiterima: 1 }).isi).toContain(
      "Harga ajuan Anda diubah kantor untuk 2 barang.",
    );
    expect(kabarPesananDisetujui({ ...dasar, ajuanDiterima: 1 }).isi).toContain("Harga ajuan Anda disetujui.");
  });

  it("KONSI: tidak menyebut harga, menyebut barang tambahan kantor", () => {
    const k = kabarPesananDisetujui({ ...dasar, orderType: "KONSI", orderNo: "KONSI-9", ditambahKantor: 3 });
    expect(k.isi).not.toContain("Rp");
    expect(k.isi).toBe("Toko Maju · transfer konsinyasi disetujui. Kantor menambahkan 3 barang baru.");
  });
});

describe("kabarPesananDitolak", () => {
  it("membawa alasan penolakan", () => {
    const k = kabarPesananDitolak({ orderId: "o1", orderNo: "PUTUS-001", storeName: "Toko Maju", alasan: " stok habis " });
    expect(k).toEqual({
      jenis: "PESANAN_DITOLAK",
      judul: "Pesanan PUTUS-001 ditolak",
      isi: "Toko Maju · alasan: stok habis",
      data: { orderId: "o1" },
    });
  });

  it("tanpa alasan tertulis tetap terbaca", () => {
    expect(kabarPesananDitolak({ orderId: "o1", orderNo: "X", storeName: "T", alasan: null }).isi).toBe("T · tanpa alasan tertulis.");
  });
});
