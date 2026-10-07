import { describe, expect, it } from "vitest";
import {
  bacaFilterSaluran,
  bandingkanPeriode,
  FILTER_SALURAN,
  kalimatBanding,
  kunciHariWib,
  MAKS_HARI_RENTANG,
  nilaiBersihSpg,
  nilaiSpgElorae,
  nilaiTitik,
  rentangTren,
  SALURAN,
  saluranMarketplace,
  seriFilter,
  susunTren,
  umurPiutang,
} from "./tren";

// 28 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-28T03:00:00Z");

describe("kunciHariWib", () => {
  it("files a sale by its Jakarta calendar day, not its UTC day", () => {
    expect(kunciHariWib(new Date("2026-09-27T17:30:00Z"))).toBe("2026-09-28"); // 00:30 WIB
    expect(kunciHariWib(new Date("2026-09-27T16:59:00Z"))).toBe("2026-09-27"); // 23:59 WIB
  });
});

const NOL = Object.fromEntries(SALURAN.map((k) => [k, 0]));

describe("susunTren", () => {
  it("returns one zero-filled point per day, oldest first, ending today", () => {
    const tren = susunTren([], HARI_INI, 3);
    expect(tren.map((t) => t.tanggal)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(tren.every((t) => t.marketplace === 0 && t.lapangan === 0 && SALURAN.every((k) => t[k] === 0))).toBe(true);
  });

  it("files each sale under its channel AND its group, on its own day", () => {
    const tren = susunTren(
      [
        { tanggal: new Date("2026-09-28T01:00:00Z"), nilai: 100, saluran: "shopee" },
        { tanggal: new Date("2026-09-28T02:00:00Z"), nilai: 50, saluran: "tiktok" },
        { tanggal: new Date("2026-09-28T02:30:00Z"), nilai: 5, saluran: "mpLain" },
        { tanggal: new Date("2026-09-27T05:00:00Z"), nilai: 30, saluran: "putus" },
        { tanggal: new Date("2026-09-27T06:00:00Z"), nilai: 7, saluran: "spg" },
      ],
      HARI_INI,
      2,
    );
    expect(tren).toEqual([
      { ...NOL, tanggal: "2026-09-27", marketplace: 0, lapangan: 37, putus: 30, spg: 7 },
      { ...NOL, tanggal: "2026-09-28", marketplace: 155, lapangan: 0, shopee: 100, tiktok: 50, mpLain: 5 },
    ]);
  });

  it("keeps the group totals equal to the sum of their channels", () => {
    const tren = susunTren(
      [
        { tanggal: new Date("2026-09-28T01:00:00Z"), nilai: 12, saluran: "tokopedia" },
        { tanggal: new Date("2026-09-28T01:00:00Z"), nilai: 3, saluran: "van" },
      ],
      HARI_INI,
      1,
    );
    expect(nilaiTitik(tren[0], "marketplace")).toBe(tren[0].marketplace);
    expect(nilaiTitik(tren[0], "lapangan")).toBe(tren[0].lapangan);
    expect(nilaiTitik(tren[0], "semua")).toBe(15);
  });

  it("drops sales outside the window instead of piling them on an edge", () => {
    const tren = susunTren([{ tanggal: new Date("2026-01-01T05:00:00Z"), nilai: 999, saluran: "shopee" }], HARI_INI, 7);
    expect(tren.reduce((s, t) => s + t.marketplace + t.shopee, 0)).toBe(0);
  });
});

describe("saluranMarketplace", () => {
  it("maps Jubelio channels, and never loses an unknown one", () => {
    expect(saluranMarketplace("SHOPEE")).toBe("shopee");
    expect(saluranMarketplace("TIKTOK")).toBe("tiktok");
    expect(saluranMarketplace("TOKOPEDIA")).toBe("tokopedia");
    expect(saluranMarketplace("OFFLINE")).toBe("mpLain");
    expect(saluranMarketplace("OTHER")).toBe("mpLain");
    expect(saluranMarketplace(null)).toBe("mpLain");
  });
});

describe("filter saluran", () => {
  it("reads only known choices; anything else is everything", () => {
    for (const f of FILTER_SALURAN) expect(bacaFilterSaluran(f)).toBe(f);
    expect(bacaFilterSaluran("lazada")).toBe("semua");
    expect(bacaFilterSaluran(undefined)).toBe("semua");
    expect(bacaFilterSaluran(["shopee"])).toBe("semua");
  });

  it("draws two lines for everything, one per channel for a group, one for a channel", () => {
    expect(seriFilter("semua")).toEqual(["marketplace", "lapangan"]);
    expect(seriFilter("marketplace")).toEqual(["shopee", "tiktok", "tokopedia", "mpLain"]);
    expect(seriFilter("lapangan")).toEqual(["putus", "van", "spg"]);
    expect(seriFilter("tiktok")).toEqual(["tiktok"]);
  });

  it("treats a point without channel detail as zero for that channel", () => {
    expect(nilaiTitik({ marketplace: 10, lapangan: 5 }, "shopee")).toBe(0);
    expect(nilaiTitik({ marketplace: 10, lapangan: 5 })).toBe(15);
  });
});

describe("bandingkanPeriode", () => {
  const tren = [1, 2, 3, 4, 5, 6].map((v, i) => ({ tanggal: `d${i}`, marketplace: v, lapangan: 0 }));

  it("compares the last N days with the N before them", () => {
    expect(bandingkanPeriode(tren, 3)).toEqual({ sekarang: 15, sebelumnya: 6, persen: 150 });
  });

  it("has no percentage when the earlier period sold nothing", () => {
    const sepi = [0, 0, 5].map((v, i) => ({ tanggal: `d${i}`, marketplace: v, lapangan: 0 }));
    expect(bandingkanPeriode(sepi, 1).persen).toBeNull();
  });

  it("compares only the chosen channel", () => {
    const rinci = susunTren(
      [
        { tanggal: new Date("2026-09-27T03:00:00Z"), nilai: 40, saluran: "shopee" },
        { tanggal: new Date("2026-09-27T03:00:00Z"), nilai: 1000, saluran: "putus" },
        { tanggal: new Date("2026-09-28T03:00:00Z"), nilai: 60, saluran: "shopee" },
        { tanggal: new Date("2026-09-28T03:00:00Z"), nilai: 10, saluran: "tiktok" },
      ],
      HARI_INI,
      2,
    );
    expect(bandingkanPeriode(rinci, 1, "shopee")).toEqual({ sekarang: 60, sebelumnya: 40, persen: 50 });
    expect(bandingkanPeriode(rinci, 1, "marketplace")).toEqual({ sekarang: 70, sebelumnya: 40, persen: 75 });
    expect(bandingkanPeriode(rinci, 1, "lapangan")).toEqual({ sekarang: 0, sebelumnya: 1000, persen: -100 });
  });
});

describe("umurPiutang", () => {
  it("ages each open invoice from its due date in Jakarta days", () => {
    const u = umurPiutang(
      [
        { dueDate: "2026-10-05T00:00:00.000Z", outstanding: 100 }, // not due yet
        { dueDate: "2026-09-28T00:00:00.000Z", outstanding: 10 }, // due today — not late
        { dueDate: "2026-09-18T00:00:00.000Z", outstanding: 20 }, // 10 days late
        { dueDate: "2026-08-14T00:00:00.000Z", outstanding: 40 }, // 45 days late
        { dueDate: "2026-06-01T00:00:00.000Z", outstanding: 80 }, // > 60 days late
        { dueDate: "2026-06-01T00:00:00.000Z", outstanding: 0 }, // settled — ignored
      ],
      HARI_INI,
    );
    expect(u).toEqual([
      { kunci: "belum", nilai: 110, jumlah: 2 },
      { kunci: "h1_30", nilai: 20, jumlah: 1 },
      { kunci: "h31_60", nilai: 40, jumlah: 1 },
      { kunci: "lebih60", nilai: 80, jumlah: 1 },
    ]);
  });
});

describe("rentangTren", () => {
  it("measures an inclusive range and starts the comparison right before it", () => {
    expect(rentangTren("2026-08-01", "2026-08-31")).toEqual({ panjang: 31, mulaiPembanding: "2026-07-01" });
    expect(rentangTren("2026-09-28", "2026-09-28")).toEqual({ panjang: 1, mulaiPembanding: "2026-09-27" });
  });

  it("refuses a range that ends before it starts", () => {
    expect(rentangTren("2026-09-10", "2026-09-01")).toBeNull();
  });

  it("refuses dates that do not exist and malformed input", () => {
    expect(rentangTren("2026-02-30", "2026-03-05")).toBeNull();
    expect(rentangTren("kemarin", "2026-03-05")).toBeNull();
  });

  it("refuses a range longer than a year", () => {
    expect(rentangTren("2025-01-01", "2026-09-28")).toBeNull();
    expect(rentangTren("2025-09-28", "2026-09-28")?.panjang).toBe(MAKS_HARI_RENTANG);
  });
});

describe("kalimatBanding", () => {
  it("menyebut arah, persen, dan nilai pembandingnya", () => {
    expect(kalimatBanding({ sekarang: 0, sebelumnya: 22_850_000 })).toEqual({
      jenis: "persen",
      arah: "turun",
      persen: 100,
      sebelumnya: 22_850_000,
    });
    expect(kalimatBanding({ sekarang: 150, sebelumnya: 100 })).toMatchObject({ arah: "naik", persen: 50 });
  });

  it("tidak pernah menulis persen di atas alas nol", () => {
    expect(kalimatBanding({ sekarang: 5_000, sebelumnya: 0 })).toEqual({ jenis: "dariNol" });
    expect(kalimatBanding({ sekarang: 0, sebelumnya: 0 })).toEqual({ jenis: "kosong" });
  });

  it("arah dari selisihnya, bukan dari persen yang dibulatkan ke nol", () => {
    expect(kalimatBanding({ sekarang: 996, sebelumnya: 1000 })).toMatchObject({ arah: "turun", persen: 0 });
    expect(kalimatBanding({ sekarang: 1000, sebelumnya: 1000 })).toMatchObject({ arah: "sama", persen: 0 });
  });
});

describe("nilaiBersihSpg", () => {
  it("mengurangi barang yang sudah dikembalikan pembeli", () => {
    expect(
      nilaiBersihSpg("300000", [
        { unitPrice: "100000", returnedQty: 1 },
        { unitPrice: "50000", returnedQty: 0 },
      ]),
    ).toBe(200_000);
  });

  it("tidak pernah di bawah nol", () => {
    expect(nilaiBersihSpg(100, [{ unitPrice: 100, returnedQty: 2 }])).toBe(0);
  });

  it("memakai harga bersih per potong untuk nota berpotongan", () => {
    // 2 × 100.000 diskon 20% → lineTotal 160.000; satu dikembalikan = 80.000, bukan 100.000.
    expect(nilaiBersihSpg(160_000, [{ unitPrice: 100_000, qty: 2, lineTotal: 160_000, returnedQty: 1 }])).toBe(80_000);
  });
});

describe("nilaiSpgElorae — KEPUTUSAN 19: penjualan SPG di toko KONSI dihitung dengan harga Elorae", () => {
  it("toko KONSI: nilai harga toko dikurangi margin toko (100.000 margin 25% → 75.000)", () => {
    expect(nilaiSpgElorae(100_000, { termsType: "KONSI", marginPercent: "25" })).toBe(75_000);
    expect(nilaiSpgElorae(200_000, { termsType: "KONSI", marginPercent: 25 })).toBe(150_000);
  });

  it("toko PUTUS: nilai nota apa adanya — kasir sudah mencatat harga Elorae", () => {
    expect(nilaiSpgElorae(100_000, { termsType: "PUTUS", marginPercent: 25 })).toBe(100_000);
  });

  it("margin KONSI yang tidak sah: harga tidak pernah dinaikkan, jadi dipakai apa adanya", () => {
    expect(nilaiSpgElorae(100_000, { termsType: "KONSI", marginPercent: null })).toBe(100_000);
    expect(nilaiSpgElorae(100_000, { termsType: "KONSI", marginPercent: 100 })).toBe(100_000);
  });

  it("nota bernilai nol (semua barang dikembalikan) tetap nol", () => {
    expect(nilaiSpgElorae(0, { termsType: "KONSI", marginPercent: 25 })).toBe(0);
  });
});
