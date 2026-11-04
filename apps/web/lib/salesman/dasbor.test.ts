import { describe, expect, it } from "vitest";
import {
  jumlahkanPenjualan,
  kemajuanTarget,
  nomorTelepon,
  nomorWhatsApp,
  polaPesanan,
  susunPenjualanSalesman,
  susunRencanaKunjungan,
  tautanWhatsApp,
} from "./dasbor";

// 29 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-29T03:00:00Z");
const hari = (iso: string) => new Date(`${iso}T05:00:00Z`); // siang WIB

describe("susunPenjualanSalesman", () => {
  it("files each sale under its WIB day and its own channel, zero-filling the rest", () => {
    const t = susunPenjualanSalesman(
      [
        { tanggal: hari("2026-09-29"), jenis: "putus", nilai: 100 },
        { tanggal: hari("2026-09-29"), jenis: "putus", nilai: 50 },
        { tanggal: hari("2026-09-28"), jenis: "konsi", nilai: 30 },
        { tanggal: new Date("2026-09-27T17:30:00Z"), jenis: "van", nilai: 7 }, // 00:30 WIB 28 Sep
      ],
      HARI_INI,
      3,
    );
    expect(t).toEqual([
      { tanggal: "2026-09-27", putus: 0, konsi: 0, van: 0 },
      { tanggal: "2026-09-28", putus: 0, konsi: 30, van: 7 },
      { tanggal: "2026-09-29", putus: 150, konsi: 0, van: 0 },
    ]);
  });

  it("totals every channel separately and together", () => {
    const t = susunPenjualanSalesman(
      [
        { tanggal: hari("2026-09-29"), jenis: "putus", nilai: 100 },
        { tanggal: hari("2026-09-28"), jenis: "konsi", nilai: 30 },
      ],
      HARI_INI,
      2,
    );
    expect(jumlahkanPenjualan(t)).toEqual({ putus: 100, konsi: 30, van: 0, total: 130 });
  });
});

describe("kemajuanTarget", () => {
  it("measures progress and what is still needed per remaining day of the month", () => {
    // 29 Sep: tersisa 29 dan 30 → 2 hari termasuk hari ini.
    expect(kemajuanTarget(50_000_000, 22_850_000, HARI_INI)).toEqual({
      target: 50_000_000,
      capai: 22_850_000,
      persen: 46,
      sisa: 27_150_000,
      sisaHari: 2,
      perHari: 13_575_000,
      tercapai: false,
    });
  });

  it("reports a reached target without a daily need", () => {
    expect(kemajuanTarget(10_000_000, 12_000_000, HARI_INI)).toMatchObject({
      persen: 120,
      sisa: 0,
      perHari: null,
      tercapai: true,
    });
  });

  it("has nothing to show when no target is set", () => {
    expect(kemajuanTarget(null, 5_000, HARI_INI)).toBeNull();
    expect(kemajuanTarget(0, 5_000, HARI_INI)).toBeNull();
  });
});

describe("susunRencanaKunjungan", () => {
  const toko = (storeId: string, x: Partial<Parameters<typeof susunRencanaKunjungan>[0][number]> = {}) => ({
    storeId,
    nama: storeId,
    kunjunganTerakhir: hari("2026-09-28"),
    tagih: false,
    sisaTagihan: 0,
    lat: null,
    lng: null,
    ...x,
  });

  it("lists only stores that need a visit, collections first", () => {
    const r = susunRencanaKunjungan(
      [
        toko("baru-dikunjungi"),
        toko("lama", { kunjunganTerakhir: hari("2026-09-01") }),
        toko("tagih", { tagih: true, sisaTagihan: 14_200_000 }),
      ],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(r.map((x) => [x.storeId, x.alasan])).toEqual([
      ["tagih", ["tagih"]],
      ["lama", ["lama"]],
    ]);
    expect(r[1].hariSejak).toBe(28);
  });

  it("treats a store this salesman never visited as due, ahead of merely old visits", () => {
    const r = susunRencanaKunjungan(
      [toko("lama", { kunjunganTerakhir: hari("2026-09-01") }), toko("belum", { kunjunganTerakhir: null })],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(r.map((x) => x.storeId)).toEqual(["belum", "lama"]);
    expect(r[0].hariSejak).toBeNull();
  });

  it("puts the larger unpaid bill first when the phone does not know where it is", () => {
    const r = susunRencanaKunjungan(
      [
        toko("kecil", { tagih: true, sisaTagihan: 12_480_000, kunjunganTerakhir: null }),
        toko("besar", { tagih: true, sisaTagihan: 14_200_000, kunjunganTerakhir: null }),
      ],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(r.map((x) => x.storeId)).toEqual(["besar", "kecil"]);
  });

  it("orders stores of the same urgency by distance when the phone knows where it is", () => {
    const r = susunRencanaKunjungan(
      [
        toko("jauh", { kunjunganTerakhir: null, lat: -6.9, lng: 107.6 }),
        toko("dekat", { kunjunganTerakhir: null, lat: -6.2001, lng: 106.8001 }),
        toko("tanpa-titik", { kunjunganTerakhir: null }),
      ],
      { batasHari: 14, hariIni: HARI_INI, posisi: { lat: -6.2, lng: 106.8 } },
    );
    expect(r.map((x) => x.storeId)).toEqual(["dekat", "jauh", "tanpa-titik"]);
    expect(r[0].jarakMeter).toBeLessThan(50);
    expect(r[2].jarakMeter).toBeNull();
  });
});

describe("polaPesanan", () => {
  it("uses the median gap between orders to say when the store usually reorders", () => {
    const p = polaPesanan([hari("2026-08-01"), hari("2026-08-15"), hari("2026-08-29"), hari("2026-09-10")], HARI_INI);
    // Jeda 14, 14, 12 → median 14. Terakhir 10 Sep → 19 hari lalu.
    expect(p).toEqual({ terakhir: hari("2026-09-10"), hariSejak: 19, jedaMedian: 14, waktunya: true });
  });

  it("needs at least two orders to know a rhythm", () => {
    expect(polaPesanan([hari("2026-09-20")], HARI_INI)).toMatchObject({ hariSejak: 9, jedaMedian: null, waktunya: false });
    expect(polaPesanan([], HARI_INI)).toEqual({ terakhir: null, hariSejak: null, jedaMedian: null, waktunya: false });
  });
});

describe("WhatsApp", () => {
  it("normalises Indonesian numbers to the international form WhatsApp expects", () => {
    expect(nomorWhatsApp("0812-3456-7890")).toBe("6281234567890");
    expect(nomorWhatsApp("+62 812 3456 7890")).toBe("6281234567890");
    expect(nomorWhatsApp("6281234567890")).toBe("6281234567890");
    expect(nomorWhatsApp("812 3456 7890")).toBe("6281234567890");
  });

  it("refuses what cannot be a phone number instead of opening a broken chat", () => {
    expect(nomorWhatsApp(null)).toBeNull();
    expect(nomorWhatsApp("")).toBeNull();
    expect(nomorWhatsApp("12345")).toBeNull();
  });

  it("refuses Indonesian landlines — WhatsApp would open a chat nobody can answer", () => {
    expect(nomorWhatsApp("+62 22 4201234")).toBeNull();
    expect(nomorWhatsApp("(021) 555-1234")).toBeNull();
    expect(nomorWhatsApp("0274 512345")).toBeNull();
  });

  it("still accepts a foreign mobile number as it was typed", () => {
    expect(nomorWhatsApp("+65 9123 4567")).toBe("6591234567");
  });

  it("offers a plain phone call for any valid number, landline included", () => {
    expect(nomorTelepon("+62 22 4201234")).toBe("+62224201234");
    expect(nomorTelepon("0812-3456-7890")).toBe("+6281234567890");
    expect(nomorTelepon("12")).toBeNull();
    expect(nomorTelepon(null)).toBeNull();
  });

  it("builds a chat link with the message already typed", () => {
    expect(tautanWhatsApp("0812 3456 7890", "Halo & salam")).toBe(
      "https://wa.me/6281234567890?text=Halo%20%26%20salam",
    );
    expect(tautanWhatsApp(null, "x")).toBeNull();
  });
});
