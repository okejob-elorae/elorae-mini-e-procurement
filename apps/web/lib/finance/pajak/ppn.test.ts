import { describe, expect, it } from "vitest";
import {
  PPN_BAWAAN,
  bacaPengaturanPpnMentah,
  periksaPengaturanPpn,
  pisahPpn,
  ppnBerlaku,
  tarifEfektif,
  type PengaturanPpn,
} from "./ppn";

const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP" };
const TGL = new Date("2026-10-08T03:00:00Z");

describe("pisahPpn — status PKP", () => {
  it("BELUM_DITETAPKAN (bawaan) berlaku seperti non-PKP: tanpa PPN, nilai utuh termasuk sen", () => {
    expect(pisahPpn(111_000.4, { pengaturan: PPN_BAWAAN, tanggal: TGL })).toEqual({
      dpp: 111_000.4,
      dppNilaiLain: 0,
      ppn: 0,
      total: 111_000.4,
      berlaku: false,
      tarifPersen: 0,
      selarasCoretax: true,
    });
  });

  it("NON_PKP: tanpa PPN, baik harga termasuk maupun tanpa PPN", () => {
    const p: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
    expect(pisahPpn(250_000, { pengaturan: p, tanggal: TGL, termasukPpn: true })).toMatchObject({ dpp: 250_000, ppn: 0, total: 250_000, berlaku: false });
    expect(pisahPpn(250_000, { pengaturan: p, tanggal: TGL, termasukPpn: false })).toMatchObject({ dpp: 250_000, ppn: 0, total: 250_000, berlaku: false });
  });
});

describe("pisahPpn — PKP, DPP nilai lain 11/12 (efektif 11%)", () => {
  it("harga termasuk PPN 111.000 → DPP 100.000, DPP nilai lain 91.667, PPN 11.000", () => {
    expect(pisahPpn(111_000, { pengaturan: PKP, tanggal: TGL })).toEqual({
      dpp: 100_000,
      dppNilaiLain: 91_667,
      ppn: 11_000,
      total: 111_000,
      berlaku: true,
      tarifPersen: 12,
      selarasCoretax: true,
    });
  });

  it("harga tanpa PPN 100.000 → PPN 11.000, total 111.000", () => {
    expect(pisahPpn(100_000, { pengaturan: PKP, tanggal: TGL, termasukPpn: false })).toEqual({
      dpp: 100_000,
      dppNilaiLain: 91_667,
      ppn: 11_000,
      total: 111_000,
      berlaku: true,
      tarifPersen: 12,
      selarasCoretax: true,
    });
  });

  it("termasukPpn bawaan mengikuti pengaturan hargaJualTermasukPpn", () => {
    const tanpa: PengaturanPpn = { ...PKP, hargaJualTermasukPpn: false };
    expect(pisahPpn(100_000, { pengaturan: tanpa, tanggal: TGL }).total).toBe(111_000);
    expect(pisahPpn(100_000, { pengaturan: PKP, tanggal: TGL }).total).toBe(100_000);
  });
});

describe("pisahPpn — pembulatan rupiah penuh, setengah ke atas (PER-11/PJ/2025 Ps 129)", () => {
  it("DPP tanpa PPN yang bersen dibulatkan ke rupiah penuh dulu (100,50 → 101; 100,49 → 100)", () => {
    expect(pisahPpn(100.5, { pengaturan: PKP, tanggal: TGL, termasukPpn: false }).dpp).toBe(101);
    expect(pisahPpn(100.49, { pengaturan: PKP, tanggal: TGL, termasukPpn: false }).dpp).toBe(100);
  });

  it("DPP nilai lain tepat setengah dibulatkan ke atas: 6 × 11/12 = 5,5 → 6; 18 → 16,5 → 17", () => {
    expect(pisahPpn(6, { pengaturan: PKP, tanggal: TGL, termasukPpn: false })).toMatchObject({ dppNilaiLain: 6, ppn: 1, total: 7 });
    expect(pisahPpn(18, { pengaturan: PKP, tanggal: TGL, termasukPpn: false })).toMatchObject({ dppNilaiLain: 17, ppn: 2, total: 20 });
  });

  it("PPN = pembulatan(DPP nilai lain × 12%) — rumus Coretax, bukan 11% × DPP", () => {
    // 100.001 × 11/12 = 91.667,58 → 91.668; × 12% = 11.000,16 → 11.000.
    expect(pisahPpn(100_000.5, { pengaturan: PKP, tanggal: TGL, termasukPpn: false })).toMatchObject({
      dpp: 100_001,
      dppNilaiLain: 91_668,
      ppn: 11_000,
      total: 111_001,
    });
  });

  it("DPP, DPP nilai lain, dan PPN selalu rupiah penuh untuk total rupiah penuh", () => {
    for (const total of [1, 7, 99, 1_234, 55_555, 149_900, 1_999_999, 87_654_321]) {
      const h = pisahPpn(total, { pengaturan: PKP, tanggal: TGL });
      expect(Number.isInteger(h.dpp), `${total}`).toBe(true);
      expect(Number.isInteger(h.dppNilaiLain), `${total}`).toBe(true);
      expect(Number.isInteger(h.ppn), `${total}`).toBe(true);
    }
  });
});

describe("pisahPpn — harga termasuk PPN: dpp + ppn = total PERSIS", () => {
  it("untuk setiap total 1 … 30.000 dan sampel besar: menjumlah persis, PPN ±Rp1 dari rumus Coretax", () => {
    const totals = [...Array.from({ length: 30_000 }, (_, i) => i + 1), 123_456_789, 999_999_999, 4_800_000_000];
    let tidakSelaras = 0;
    for (const total of totals) {
      const h = pisahPpn(total, { pengaturan: PKP, tanggal: TGL });
      expect(h.dpp + h.ppn).toBe(total);
      expect(h.total).toBe(total);
      const rumus = Math.floor((2 * h.dppNilaiLain * 1200 + 10_000) / 20_000);
      if (h.selarasCoretax) expect(h.ppn).toBe(rumus);
      else {
        tidakSelaras++;
        expect(Math.abs(h.ppn - rumus)).toBeLessThanOrEqual(1);
      }
      // PPN efektif 11/111 dari total, paling jauh Rp1.
      expect(Math.abs(h.ppn - (total * 11) / 111)).toBeLessThanOrEqual(1.01);
    }
    // dpp + pajak(dpp) naik 2 kira-kira setiap 9 rupiah DPP (PPN naik Rp1), jadi
    // ±1 dari 10 total tidak punya pasangan selaras-Coretax — terukur 9,9%.
    expect(tidakSelaras / totals.length).toBeGreaterThan(0.08);
    expect(tidakSelaras / totals.length).toBeLessThan(0.11);
  });

  it("total bersen: sen jatuh ke DPP, PPN tetap rupiah penuh, total utuh", () => {
    const h = pisahPpn(111_000.4, { pengaturan: PKP, tanggal: TGL });
    expect(h).toMatchObject({ ppn: 11_000, dpp: 100_000.4, total: 111_000.4, dppNilaiLain: 91_667 });
    const h2 = pisahPpn(111_000.6, { pengaturan: PKP, tanggal: TGL });
    expect(h2.dpp + h2.ppn).toBeCloseTo(111_000.6, 10);
    expect(Number.isInteger(h2.ppn)).toBe(true);
  });
});

describe("pisahPpn — retur, nol, nilai tidak sah", () => {
  it("nilai negatif (retur) simetris dengan nilai positifnya", () => {
    for (const v of [111_000, 7, 55_555, 100_000.5]) {
      for (const termasukPpn of [true, false]) {
        const pos = pisahPpn(v, { pengaturan: PKP, tanggal: TGL, termasukPpn });
        const neg = pisahPpn(-v, { pengaturan: PKP, tanggal: TGL, termasukPpn });
        expect(neg.dpp).toBe(-pos.dpp);
        expect(neg.dppNilaiLain).toBe(-pos.dppNilaiLain);
        expect(neg.ppn).toBe(-pos.ppn);
        expect(neg.total).toBe(-pos.total);
      }
    }
  });

  it("nol → semuanya nol, tanpa -0", () => {
    const h = pisahPpn(0, { pengaturan: PKP, tanggal: TGL });
    expect(Object.is(h.dpp, 0) && Object.is(h.ppn, 0) && Object.is(h.total, 0)).toBe(true);
  });

  it("NaN/Infinity ditolak, bukan diam-diam nol", () => {
    expect(() => pisahPpn(Number.NaN, { pengaturan: PKP, tanggal: TGL })).toThrow(RangeError);
    expect(() => pisahPpn(Number.POSITIVE_INFINITY, { pengaturan: PKP, tanggal: TGL })).toThrow(RangeError);
  });
});

describe("pisahPpn — tanpa DPP nilai lain, tarif lain", () => {
  it("pakaiDppNilaiLain false: PPN 12% penuh, DPP nilai lain = DPP", () => {
    const p: PengaturanPpn = { ...PKP, pakaiDppNilaiLain: false };
    expect(pisahPpn(112_000, { pengaturan: p, tanggal: TGL })).toMatchObject({
      dpp: 100_000,
      dppNilaiLain: 100_000,
      ppn: 12_000,
      total: 112_000,
      selarasCoretax: true,
    });
  });

  it("tarif 11% dengan nilai lain → efektif 10,0833%", () => {
    const p: PengaturanPpn = { ...PKP, tarifPersen: 11 };
    const h = pisahPpn(100_000, { pengaturan: p, tanggal: TGL, termasukPpn: false });
    // 91.667 × 11% = 10.083,37 → 10.083.
    expect(h).toMatchObject({ dppNilaiLain: 91_667, ppn: 10_083, total: 110_083, tarifPersen: 11 });
  });
});

describe("ppnBerlaku / tarifEfektif", () => {
  it("berlakuSejak dibaca sebagai awal hari WIB", () => {
    const p: PengaturanPpn = { ...PKP, berlakuSejak: "2026-11-01" };
    expect(ppnBerlaku(p, new Date("2026-10-31T16:59:59.999Z"))).toBe(false);
    expect(ppnBerlaku(p, new Date("2026-10-31T17:00:00.000Z"))).toBe(true);
    expect(pisahPpn(111_000, { pengaturan: p, tanggal: new Date("2026-10-15T03:00:00Z") })).toMatchObject({ ppn: 0, berlaku: false });
    expect(ppnBerlaku({ ...PPN_BAWAAN, berlakuSejak: "2020-01-01" }, TGL)).toBe(false);
  });

  it("tarif efektif 11 (12 × 11/12), 12 tanpa nilai lain", () => {
    expect(tarifEfektif(PPN_BAWAAN)).toBe(11);
    expect(tarifEfektif({ ...PPN_BAWAAN, pakaiDppNilaiLain: false })).toBe(12);
    expect(tarifEfektif({ ...PPN_BAWAAN, tarifPersen: 11 })).toBe(10.0833);
  });
});

describe("bacaPengaturanPpnMentah — lunak, jatuh ke bawaan", () => {
  it("kosong, rusak, atau bukan objek → bawaan (BELUM_DITETAPKAN, 12%, 11/12, termasuk PPN)", () => {
    for (const v of [null, undefined, "", "bukan json", "[1,2]", 42, [] as unknown]) {
      expect(bacaPengaturanPpnMentah(v)).toEqual(PPN_BAWAAN);
    }
    expect(PPN_BAWAAN).toEqual({ statusPkp: "BELUM_DITETAPKAN", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null });
  });

  it("membaca teks JSON SystemSetting; kunci tidak sah jatuh ke bawaan satu per satu", () => {
    expect(
      bacaPengaturanPpnMentah(
        JSON.stringify({ statusPkp: "PKP", tarifPersen: "11", pakaiDppNilaiLain: false, hargaJualTermasukPpn: false, berlakuSejak: "2026-11-01" }),
      ),
    ).toEqual({ statusPkp: "PKP", tarifPersen: 11, pakaiDppNilaiLain: false, hargaJualTermasukPpn: false, berlakuSejak: "2026-11-01" });
    expect(
      bacaPengaturanPpnMentah({ statusPkp: "YA", tarifPersen: 0, pakaiDppNilaiLain: "ya", berlakuSejak: "2026-02-30" }),
    ).toEqual(PPN_BAWAAN);
    expect(bacaPengaturanPpnMentah({ tarifPersen: 12.345 }).tarifPersen).toBe(12);
  });
});

describe("periksaPengaturanPpn — ketat untuk menyimpan", () => {
  it("menerima isian lengkap; tanggal kosong = null", () => {
    expect(
      periksaPengaturanPpn({ statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: "" }),
    ).toEqual({ ok: true, pengaturan: { ...PKP } });
  });

  it("menyebut setiap kunci yang salah", () => {
    expect(periksaPengaturanPpn("x")).toEqual({ ok: false, galat: ["BENTUK_TIDAK_SAH"] });
    expect(
      periksaPengaturanPpn({ statusPkp: "PKP?", tarifPersen: 150, pakaiDppNilaiLain: 1, hargaJualTermasukPpn: true, berlakuSejak: "1/11/2026" }),
    ).toEqual({ ok: false, galat: ["STATUS_TIDAK_SAH", "TARIF_TIDAK_SAH", "SAKLAR_TIDAK_SAH", "TANGGAL_TIDAK_SAH"] });
  });
});
