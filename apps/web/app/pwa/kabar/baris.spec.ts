import { describe, expect, it } from "vitest";
import { susunBarisKabar, type BarisAntrean } from "./baris";

const baris = (over: Partial<BarisAntrean>): BarisAntrean => ({
  id: "n1",
  type: "PESANAN_DIKIRIM",
  title: "Pesanan PUT/2026/0012 sudah dikirim",
  body: "Toko Maju · nota DLV/1 · Rp 100.000",
  data: { type: "PESANAN_DIKIRIM", orderId: "o1", deliveryId: "d1" },
  readAt: null,
  createdAt: new Date("2026-09-30T03:15:00Z"),
  ...over,
});

describe("susunBarisKabar", () => {
  // 30 Sep 2026 10.00 WIB
  const sekarang = new Date("2026-09-30T03:00:00Z");

  it("kabar hari ini (WIB) hanya menampilkan jamnya", () => {
    const [b] = susunBarisKabar([baris({})], sekarang);
    expect(b.hariIni).toBe(true);
    expect(b.waktu).toBe("10.15");
  });

  it("hari dihitung menurut WIB, bukan UTC: 29 Sep 20.00 UTC sudah 30 Sep di Jakarta", () => {
    const [b] = susunBarisKabar([baris({ createdAt: new Date("2026-09-29T20:00:00Z") })], sekarang);
    expect(b.hariIni).toBe(true);
    expect(b.waktu).toBe("03.00");
  });

  it("kabar hari lain menampilkan tanggal dan jam", () => {
    const [b] = susunBarisKabar([baris({ createdAt: new Date("2026-09-28T07:30:00Z") })], sekarang);
    expect(b.hariIni).toBe(false);
    expect(b.waktu).toContain("28");
    expect(b.waktu).toContain("14.30");
  });

  it("membawa tautan, status dibaca, dan teksnya apa adanya", () => {
    const [belum, sudah] = susunBarisKabar(
      [baris({}), baris({ id: "n2", type: "WO_COMPLETED", data: { woId: "w1" }, readAt: new Date() })],
      sekarang,
    );
    expect(belum).toMatchObject({
      id: "n1",
      jenis: "PESANAN_DIKIRIM",
      judul: "Pesanan PUT/2026/0012 sudah dikirim",
      isi: "Toko Maju · nota DLV/1 · Rp 100.000",
      dibaca: false,
      href: "/pwa/orders/o1",
    });
    expect(sudah).toMatchObject({ id: "n2", dibaca: true, href: null });
  });
});
