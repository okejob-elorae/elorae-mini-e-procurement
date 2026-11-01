import { describe, expect, it } from "vitest";
import { gabungBaris, susunBarisKabar, type BarisAntrean, type BarisKabar } from "./baris";

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

  it("kabar tim juga bertautan ke layar HP, bukan halaman kantor", () => {
    const [tagih, ditolak, pesananKantor] = susunBarisKabar(
      [
        baris({ id: "a", type: "AR_OVERDUE", data: { receivableId: "r1", thresholdDays: "7" } }),
        baris({ id: "b", type: "FIELD_SALES_ORDER_REJECTED", data: { orderId: "o9", storeId: "s1" } }),
        baris({ id: "c", type: "PENDING_ORDER_APPROVAL", data: { orderId: "o9" } }),
      ],
      sekarang,
    );
    expect(tagih.href).toBe("/pwa/collections/r1");
    expect(ditolak.href).toBe("/pwa/orders/o9");
    // Persetujuan pesanan dikerjakan di kantor — di HP ketukannya hanya menandai dibaca.
    expect(pesananKantor.href).toBeNull();
  });

  it("data JSON berupa teks (kolom JSON MariaDB) tetap terbaca", () => {
    const [b] = susunBarisKabar([baris({ data: JSON.stringify({ orderId: "o1" }) })], sekarang);
    expect(b.href).toBe("/pwa/orders/o1");
  });

  it("membawa data dan waktu dibuat (ISO) untuk mengurutkan halaman berikutnya", () => {
    const [b] = susunBarisKabar([baris({})], sekarang);
    expect(b.data).toEqual({ type: "PESANAN_DIKIRIM", orderId: "o1", deliveryId: "d1" });
    expect(b.dibuat).toBe("2026-09-30T03:15:00.000Z");
  });
});

describe("gabungBaris", () => {
  const b = (id: string, dibuat: string, dibaca = false): BarisKabar => ({
    id,
    jenis: "PESANAN_DIKIRIM",
    judul: id,
    isi: "",
    data: null,
    waktu: "",
    hariIni: false,
    dibaca,
    href: null,
    dibuat,
  });

  it("menyatukan halaman tanpa kembar, terbaru di atas", () => {
    const pertama = [b("n3", "2026-10-03T00:00:00.000Z"), b("n2", "2026-10-02T00:00:00.000Z")];
    const lanjut = [b("n2", "2026-10-02T00:00:00.000Z"), b("n1", "2026-10-01T00:00:00.000Z")];
    expect(gabungBaris(pertama, lanjut).map((x) => x.id)).toEqual(["n3", "n2", "n1"]);
  });

  it("baris kembar diambil dari daftar pertama — status dibaca terbaru yang berlaku", () => {
    const segar = [b("n1", "2026-10-01T00:00:00.000Z", true)];
    const lama = [b("n1", "2026-10-01T00:00:00.000Z", false)];
    expect(gabungBaris(segar, lama)).toEqual([segar[0]]);
  });

  it("waktu yang sama diurutkan menurut id menurun, seperti kursor halaman", () => {
    const t = "2026-10-01T00:00:00.000Z";
    expect(gabungBaris([b("a", t), b("c", t)], [b("b", t)]).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("baris yang sudah tergeser dari halaman pertama tetap tersimpan", () => {
    // Halaman pertama sesudah segarkan tidak lagi memuat n2 (tergeser kabar baru n4).
    const pertamaBaru = [b("n4", "2026-10-04T00:00:00.000Z"), b("n3", "2026-10-03T00:00:00.000Z")];
    const simpanan = [b("n3", "2026-10-03T00:00:00.000Z"), b("n2", "2026-10-02T00:00:00.000Z"), b("n1", "2026-10-01T00:00:00.000Z")];
    expect(gabungBaris(pertamaBaru, simpanan).map((x) => x.id)).toEqual(["n4", "n3", "n2", "n1"]);
  });
});
