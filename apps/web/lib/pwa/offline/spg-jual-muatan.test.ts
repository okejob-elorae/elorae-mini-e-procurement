import { describe, expect, it } from "vitest";
import {
  jumlahPotongTertahan,
  muatanDiskon,
  muatanKirimNotaSpg,
  muatanPembeli,
  namaPembeliTertahan,
  susunNotaTertahan,
  ubahanTanpaBagian,
} from "./spg-jual-muatan";

const WAKTU = new Date("2026-10-03T13:05:00.000Z");

const dasar = {
  idempotencyKey: "kunci-keranjang-1",
  storeId: "toko-1",
  storeName: "Toko Satu",
  visitId: "kunjungan-1",
  waktuJual: WAKTU,
  baris: [
    { itemId: "i1", variantSku: "KAOS-M", qty: 2, productName: "Kaos — M", unitPrice: 100_000 },
    { itemId: "i2", variantSku: null, qty: 1, productName: "Topi", unitPrice: 50_000 },
  ],
  pembeli: null,
  diskonManual: null,
  totalPratinjau: 230_000,
  potonganPratinjau: 20_000,
};

describe("susunNotaTertahan", () => {
  it("keeps the cart's idempotency key as the queue id, so a send that reached the server is never recorded twice", () => {
    const n = susunNotaTertahan(dasar);
    expect(n?.localId).toBe("kunci-keranjang-1");
    expect(n?.waktuJual).toBe("2026-10-03T13:05:00.000Z");
    expect(n?.visitId).toBe("kunjungan-1");
    expect(n?.totalPratinjau).toBe(230_000);
    expect(n?.potonganPratinjau).toBe(20_000);
    expect(n?.lines).toEqual(dasar.baris);
  });

  it("drops zero and non-integer quantities, and queues nothing for a cart left empty", () => {
    const n = susunNotaTertahan({
      ...dasar,
      baris: [
        { itemId: "i1", variantSku: "A", qty: 0, productName: "A", unitPrice: 1 },
        { itemId: "i2", variantSku: "B", qty: 1.5, productName: "B", unitPrice: 1 },
        { itemId: "i3", variantSku: "C", qty: 3, productName: "C", unitPrice: 1 },
      ],
    });
    expect(n?.lines.map((l) => l.itemId)).toEqual(["i3"]);
    expect(susunNotaTertahan({ ...dasar, baris: [{ itemId: "i1", variantSku: null, qty: 0, productName: "A", unitPrice: 1 }] })).toBeNull();
  });

  it("refuses a missing key or an invalid sale time", () => {
    expect(susunNotaTertahan({ ...dasar, idempotencyKey: "" })).toBeNull();
    expect(susunNotaTertahan({ ...dasar, waktuJual: new Date("bukan tanggal") })).toBeNull();
  });

  it("stores a zero discount as no discount, and keeps the GPS when there is one", () => {
    const n = susunNotaTertahan({ ...dasar, diskonManual: { jenis: "PERSEN", nilai: 0, alasan: "x" }, posisi: { lat: -6.2, lng: 106.8 } });
    expect(n?.diskonManual).toBeNull();
    expect(n?.saleLat).toBe(-6.2);
    expect(n?.saleLng).toBe(106.8);
  });
});

describe("muatanKirimNotaSpg", () => {
  it("sends from the queue as an offline sale, at the time it was sold, in the visit it was sold in, with the same key", () => {
    const n = susunNotaTertahan({
      ...dasar,
      pembeli: { nama: " Ani ", hp: " 0812 3456 7890 ", setuju: true },
      diskonManual: { jenis: "RUPIAH", nilai: 5_000, alasan: "  jahitan lepas  " },
    });
    expect(n).not.toBeNull();
    const m = muatanKirimNotaSpg(n!);
    expect(m).toEqual({
      idempotencyKey: "kunci-keranjang-1",
      luring: true,
      waktuJual: "2026-10-03T13:05:00.000Z",
      visitId: "kunjungan-1",
      lines: [
        { itemId: "i1", variantSku: "KAOS-M", qty: 2 },
        { itemId: "i2", variantSku: null, qty: 1 },
      ],
      pembeli: { nama: "Ani", hp: "0812 3456 7890", setuju: true },
      diskonManual: { jenis: "RUPIAH", nilai: 5_000, alasan: "jahitan lepas" },
      saleLat: null,
      saleLng: null,
    });
  });

  it("never sends the screen's prices — the server prices the sale itself", () => {
    const m = muatanKirimNotaSpg(susunNotaTertahan(dasar)!);
    expect(JSON.stringify(m)).not.toContain("unitPrice");
    expect(JSON.stringify(m)).not.toContain("totalPratinjau");
  });
});

describe("muatanPembeli / muatanDiskon", () => {
  it("sends only the id of an existing customer, not the name kept for display", () => {
    expect(muatanPembeli({ id: "c1", nama: "Budi" })).toEqual({ id: "c1" });
    expect(muatanPembeli(null)).toBeNull();
  });

  it("carries the member registration request only when asked — a receipt queued before members existed sends none", () => {
    expect(muatanPembeli({ id: "c1", nama: "Budi", daftarMember: true })).toEqual({ id: "c1", daftarMember: true });
    expect(muatanPembeli({ nama: " Ani ", hp: "0812", setuju: true, daftarMember: true })).toEqual({ nama: "Ani", hp: "0812", setuju: true, daftarMember: true });
    expect(muatanPembeli({ nama: "Ani", hp: "0812", setuju: true, daftarMember: false })).toEqual({ nama: "Ani", hp: "0812", setuju: true });
    expect(muatanPembeli({ nama: "Ani", hp: "0812", setuju: true })).not.toHaveProperty("daftarMember");
  });

  it("treats an empty reason as no reason", () => {
    expect(muatanDiskon({ jenis: "PERSEN", nilai: 5, alasan: "   " })).toEqual({ jenis: "PERSEN", nilai: 5, alasan: null });
    expect(muatanDiskon({ jenis: "PERSEN", nilai: Number.NaN, alasan: null })).toBeNull();
  });
});

describe("ubahanTanpaBagian", () => {
  it("drops only the rejected part and puts the receipt back in line", () => {
    expect(ubahanTanpaBagian("diskon")).toEqual({ diskonManual: null, syncState: "pending", error: undefined });
    expect(ubahanTanpaBagian("pembeli")).toEqual({ pembeli: null, syncState: "pending", error: undefined });
  });
});

describe("display helpers", () => {
  it("counts pieces and reads the shopper's name in either shape", () => {
    expect(jumlahPotongTertahan({ lines: dasar.baris })).toBe(3);
    expect(namaPembeliTertahan({ id: "c1", nama: "Budi" })).toBe("Budi");
    expect(namaPembeliTertahan({ nama: " Ani ", hp: "0812", setuju: true })).toBe("Ani");
    expect(namaPembeliTertahan(null)).toBeNull();
  });
});
