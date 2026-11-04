import { describe, expect, it } from "vitest";
import { bacaAturanMember, MEMBER_BAWAAN, sahkanAturanMember } from "@/lib/spg/member";
import { aturanDariIsian, bacaAngka, bacaRupiah, isianDariAturan, kodeTingkatDariNama, salahIsian, type IsianMember } from "./member-isian";

describe("isian kartu Member & pelanggan", () => {
  it("round-trips the saved rule unchanged, so an untouched card is not 'changed'", () => {
    expect(aturanDariIsian(isianDariAturan(MEMBER_BAWAAN))).toEqual(MEMBER_BAWAAN);
    expect(sahkanAturanMember(aturanDariIsian(isianDariAturan(MEMBER_BAWAAN)))).toEqual(MEMBER_BAWAAN);
  });

  it("reads rupiah with thousand separators and percentages with a decimal comma", () => {
    expect(bacaRupiah("1.500.000")).toBe(1_500_000);
    expect(bacaRupiah(" 250 000 ")).toBe(250_000);
    expect(bacaRupiah("1,5jt")).toBeNaN();
    expect(bacaRupiah("")).toBeNaN();
    expect(bacaAngka("2,5")).toBe(2.5);
    expect(bacaAngka("")).toBeNaN();
    expect(bacaAngka("-1")).toBeNaN();
  });

  it("forces the first tier to start at Rp0 and derives unique codes for new tiers", () => {
    const isian: IsianMember = {
      ...isianDariAturan(MEMBER_BAWAAN),
      tingkat: [
        { kunci: "a", kode: "MEMBER", nama: "Member", minBelanja: "999", diskonPersen: "0" },
        { kunci: "b", kode: null, nama: "  Platinum  Plus ", minBelanja: "2.000.000", diskonPersen: "7,5" },
        { kunci: "c", kode: null, nama: "Platinum plus", minBelanja: "9.000.000", diskonPersen: "12" },
      ],
    };
    const a = aturanDariIsian(isian);
    expect(a.tingkat).toEqual([
      { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 0 },
      { kode: "PLATINUM_PLUS", nama: "Platinum Plus", minBelanja: 2_000_000, diskonPersen: 7.5 },
      { kode: "PLATINUM_PLUS_2", nama: "Platinum plus", minBelanja: 9_000_000, diskonPersen: 12 },
    ]);
    // Yang disahkan terbaca kembali persis sama oleh pembaca penulis nota.
    const sah = sahkanAturanMember(a);
    expect(sah).not.toBeNull();
    expect(bacaAturanMember(JSON.stringify(sah))).toEqual(sah);
  });

  it("keeps an existing tier's code when it is renamed — receipts store the NAME, not the code", () => {
    const isian = isianDariAturan(MEMBER_BAWAAN);
    isian.tingkat[1] = { ...isian.tingkat[1], nama: "Perak" };
    expect(aturanDariIsian(isian).tingkat[1]).toEqual({ kode: "SILVER", nama: "Perak", minBelanja: 1_500_000, diskonPersen: 5 });
  });

  it("derives a code from accented names and never exceeds 20 characters", () => {
    expect(kodeTingkatDariNama("Eloraé Prioritas", new Set())).toBe("ELORAE_PRIORITAS");
    expect(kodeTingkatDariNama("!!!", new Set())).toBe("TINGKAT");
    const panjang = kodeTingkatDariNama("Pelanggan Sangat Setia Sekali", new Set(["PELANGGAN_SANGAT_SET"]));
    expect(panjang.length).toBeLessThanOrEqual(20);
    expect(panjang).toBe("PELANGGAN_SANGAT_S_2");
  });

  it("refuses tiers whose minimum does not rise, and marks exactly the fields that are wrong", () => {
    const isian = isianDariAturan(MEMBER_BAWAAN);
    isian.tingkat[2] = { ...isian.tingkat[2], minBelanja: "1.000.000" };
    isian.periodeBulan = "0";
    isian.hariTidur = "5";
    isian.bagianTokoPersen = "12,345";
    isian.minBelanjaDaftar = "abc";
    const a = aturanDariIsian(isian);
    expect(sahkanAturanMember(a)).toBeNull();
    const s = salahIsian(a);
    expect([...s.tingkat]).toEqual([2]);
    expect(s).toMatchObject({ periodeBulan: true, hariTidur: true, bagianTokoPersen: true, minBelanjaDaftar: true });
    expect(salahIsian(MEMBER_BAWAAN)).toMatchObject({ periodeBulan: false, hariTidur: false, bagianTokoPersen: false, minBelanjaDaftar: false });
    expect(salahIsian(MEMBER_BAWAAN).tingkat.size).toBe(0);
  });

  it("refuses an empty tier name and more than six tiers", () => {
    const kosong = isianDariAturan(MEMBER_BAWAAN);
    kosong.tingkat[1] = { ...kosong.tingkat[1], nama: "   " };
    expect(sahkanAturanMember(aturanDariIsian(kosong))).toBeNull();
    expect(salahIsian(aturanDariIsian(kosong)).tingkat.has(1)).toBe(true);
    const banyak = isianDariAturan(MEMBER_BAWAAN);
    banyak.tingkat = Array.from({ length: 7 }, (_, i) => ({ kunci: String(i), kode: null, nama: `T${i}`, minBelanja: String(i * 1000), diskonPersen: "1" }));
    expect(sahkanAturanMember(aturanDariIsian(banyak))).toBeNull();
    banyak.tingkat = banyak.tingkat.slice(0, 6);
    expect(sahkanAturanMember(aturanDariIsian(banyak))).not.toBeNull();
  });
});
