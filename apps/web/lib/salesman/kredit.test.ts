import { describe, expect, it } from "vitest";
import { ATURAN_KREDIT_BAWAAN, bacaAturanKredit, nilaiKredit, type AturanKredit, type KeadaanTagihan } from "./kredit";

const bersih: KeadaanTagihan = { sisa: 0, fakturTerbuka: 0, lewatJanji: 0, fakturLewatJanji: 0 };
const aturan = (x: Partial<AturanKredit> = {}): AturanKredit => ({ ...ATURAN_KREDIT_BAWAAN, ...x });

describe("nilaiKredit", () => {
  it("toko tanpa tagihan → aman", () => {
    expect(nilaiKredit(bersih, aturan(), {}, 5_000_000)).toEqual({ tingkat: "AMAN", alasan: [] });
  });

  it("tagihan lewat janji → tingkat mengikuti mode (bawaan PERINGATAN)", () => {
    const k = { ...bersih, sisa: 3_000_000, fakturTerbuka: 2, lewatJanji: 1_000_000, fakturLewatJanji: 1 };
    expect(nilaiKredit(k, aturan(), {}, 0)).toEqual({
      tingkat: "PERINGATAN",
      alasan: [{ kode: "LEWAT_JANJI", nilai: 1_000_000, faktur: 1 }],
    });
    expect(nilaiKredit(k, aturan({ mode: "TAHAN" }), {}, 0).tingkat).toBe("TAHAN");
    expect(nilaiKredit(k, aturan({ mode: "BLOKIR" }), {}, 0).tingkat).toBe("BLOKIR");
  });

  it("batas nilai menghitung sisa SESUDAH pesanan ini", () => {
    const k = { ...bersih, sisa: 8_000_000, fakturTerbuka: 1 };
    expect(nilaiKredit(k, aturan({ batasNilai: 10_000_000 }), {}, 1_500_000).tingkat).toBe("AMAN");
    expect(nilaiKredit(k, aturan({ batasNilai: 10_000_000 }), {}, 2_500_000)).toEqual({
      tingkat: "PERINGATAN",
      alasan: [{ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 10_500_000, batas: 10_000_000 }],
    });
  });

  it("batas faktur: pesanan baru akan jadi faktur berikutnya", () => {
    const k = { ...bersih, sisa: 1_000_000, fakturTerbuka: 3 };
    expect(nilaiKredit(k, aturan({ batasFaktur: 4 }), {}, 100).tingkat).toBe("AMAN");
    expect(nilaiKredit(k, aturan({ batasFaktur: 3 }), {}, 100).alasan).toEqual([
      { kode: "MELEBIHI_BATAS_FAKTUR", faktur: 3, batas: 3 },
    ]);
  });

  it("batas per toko menimpa bawaan — termasuk 0", () => {
    const k = { ...bersih, sisa: 500_000, fakturTerbuka: 1 };
    expect(nilaiKredit(k, aturan({ batasNilai: 100_000 }), { creditLimit: 5_000_000 }, 1).tingkat).toBe("AMAN");
    expect(nilaiKredit(k, aturan(), { maxOpenInvoices: 0 }, 1).alasan[0]).toMatchObject({ kode: "MELEBIHI_BATAS_FAKTUR" });
  });

  it("beberapa alasan sekaligus dilaporkan semua", () => {
    const k = { sisa: 20_000_000, fakturTerbuka: 5, lewatJanji: 4_000_000, fakturLewatJanji: 2 };
    const h = nilaiKredit(k, aturan({ batasNilai: 10_000_000, batasFaktur: 5 }), {}, 1);
    expect(h.alasan.map((a) => a.kode)).toEqual(["LEWAT_JANJI", "MELEBIHI_BATAS_NILAI", "MELEBIHI_BATAS_FAKTUR"]);
  });
});

describe("bacaAturanKredit", () => {
  it("kosong atau rusak → bawaan, tidak melempar", () => {
    expect(bacaAturanKredit(null)).toEqual(ATURAN_KREDIT_BAWAAN);
    expect(bacaAturanKredit("{bukan json")).toEqual(ATURAN_KREDIT_BAWAAN);
  });

  it("nilai yang sah dipakai, yang tidak sah diganti bawaan per kolom", () => {
    expect(bacaAturanKredit(JSON.stringify({ mode: "BLOKIR", batasNilai: 5000000, batasFaktur: 3, hariToleransi: 7 }))).toEqual({
      mode: "BLOKIR",
      batasNilai: 5_000_000,
      batasFaktur: 3,
      hariToleransi: 7,
    });
    expect(bacaAturanKredit(JSON.stringify({ mode: "ASAL", batasNilai: -1, batasFaktur: "x", hariToleransi: -3 }))).toEqual(
      ATURAN_KREDIT_BAWAAN,
    );
  });
});
