import { describe, expect, it } from "vitest";
import {
  ATURAN_KREDIT_BAWAAN,
  BAWAAN_BERLAKU_UNTUK_KONSI,
  MODE_KREDIT,
  bacaAturanKredit,
  batasKreditBerlaku,
  keadaanDariEksposur,
  lewatBatasNilai,
  nilaiKredit,
  type AturanKredit,
  type KeadaanTagihan,
} from "./kredit";

const bersih: KeadaanTagihan = { sisa: 0, belumDinota: 0, fakturTerbuka: 0, lewatJanji: 0, fakturLewatJanji: 0 };
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
      alasan: [
        { kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 10_500_000, batas: 10_000_000, sisaFaktur: 8_000_000, belumDinota: 0, pesanan: 2_500_000 },
      ],
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

  it("kolom toko kosong ikut bawaan Pengaturan — batas nilai dan batas faktur", () => {
    const k = { ...bersih, sisa: 18_000_000, fakturTerbuka: 3 };
    expect(nilaiKredit(k, aturan({ batasNilai: 20_000_000, batasFaktur: 3 }), { creditLimit: null, maxOpenInvoices: null }, 5_000_000).alasan).toEqual([
      { kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 23_000_000, batas: 20_000_000, sisaFaktur: 18_000_000, belumDinota: 0, pesanan: 5_000_000 },
      { kode: "MELEBIHI_BATAS_FAKTUR", faktur: 3, batas: 3 },
    ]);
  });

  it("toko tanpa batas kredit: batas nilai dan faktur dilewati, tagihan lewat janji tetap dinilai", () => {
    const k = { sisa: 50_000_000, belumDinota: 0, fakturTerbuka: 9, lewatJanji: 0, fakturLewatJanji: 0 };
    const ketat = aturan({ mode: "BLOKIR", batasNilai: 1_000_000, batasFaktur: 1 });
    expect(nilaiKredit(k, ketat, { creditLimit: 1, maxOpenInvoices: 0, noCreditLimit: true }, 5_000_000)).toEqual({ tingkat: "AMAN", alasan: [] });
    const menunggak = { ...k, lewatJanji: 2_000_000, fakturLewatJanji: 1 };
    expect(nilaiKredit(menunggak, ketat, { noCreditLimit: true }, 5_000_000)).toEqual({
      tingkat: "BLOKIR",
      alasan: [{ kode: "LEWAT_JANJI", nilai: 2_000_000, faktur: 1 }],
    });
  });

  it("beberapa alasan sekaligus dilaporkan semua", () => {
    const k = { sisa: 20_000_000, belumDinota: 0, fakturTerbuka: 5, lewatJanji: 4_000_000, fakturLewatJanji: 2 };
    const h = nilaiKredit(k, aturan({ batasNilai: 10_000_000, batasFaktur: 5 }), {}, 1);
    expect(h.alasan.map((a) => a.kode)).toEqual(["LEWAT_JANJI", "MELEBIHI_BATAS_NILAI", "MELEBIHI_BATAS_FAKTUR"]);
  });
});

describe("satu angka kredit — pesanan disetujui yang belum masuk nota ikut dihitung (Q10)", () => {
  // Contoh pemilik: batas 20 jt, faktur 15 jt, disetujui belum dinota 4 jt, pesanan baru 2 jt → 21 jt.
  const eksposur = { receivableOutstanding: 15_000_000, undeliveredOrderResidual: 4_000_000, openInvoiceCount: 1 };
  const keadaan = keadaanDariEksposur(eksposur, { lewatJanji: 0, fakturLewatJanji: 0 });

  it("keadaanDariEksposur memetakan angka gerbang apa adanya", () => {
    expect(keadaan).toEqual({ sisa: 15_000_000, belumDinota: 4_000_000, fakturTerbuka: 1, lewatJanji: 0, fakturLewatJanji: 0 });
    expect(keadaanDariEksposur(eksposur, { lewatJanji: 500_000, fakturLewatJanji: 1 })).toMatchObject({ lewatJanji: 500_000, fakturLewatJanji: 1 });
  });

  it("21 jt dari batas 20 jt di setiap mode, dengan rincian lengkap", () => {
    for (const mode of MODE_KREDIT) {
      expect(nilaiKredit(keadaan, aturan({ mode, batasNilai: 20_000_000 }), {}, 2_000_000)).toEqual({
        tingkat: mode,
        alasan: [
          {
            kode: "MELEBIHI_BATAS_NILAI",
            sisaSesudah: 21_000_000,
            batas: 20_000_000,
            sisaFaktur: 15_000_000,
            belumDinota: 4_000_000,
            pesanan: 2_000_000,
          },
        ],
      });
    }
  });

  it("batas 21 jt: sama dengan batas bukan lewat → aman di setiap mode", () => {
    for (const mode of MODE_KREDIT) {
      expect(nilaiKredit(keadaan, aturan({ mode, batasNilai: 21_000_000 }), {}, 2_000_000)).toEqual({ tingkat: "AMAN", alasan: [] });
    }
  });

  it("pesanan disetujui belum dinota tidak pernah dihitung sebagai faktur terbuka", () => {
    const k = keadaanDariEksposur({ receivableOutstanding: 0, undeliveredOrderResidual: 9_000_000, openInvoiceCount: 0 }, { lewatJanji: 0, fakturLewatJanji: 0 });
    expect(nilaiKredit(k, aturan({ batasFaktur: 1 }), {}, 1).alasan).toEqual([]);
  });

  it("keadaan dari halaman lama tanpa belumDinota dihitung nol", () => {
    const lama = { sisa: 8_000_000, fakturTerbuka: 1, lewatJanji: 0, fakturLewatJanji: 0 } as unknown as KeadaanTagihan;
    expect(nilaiKredit(lama, aturan({ batasNilai: 10_000_000 }), {}, 2_500_000).alasan).toEqual([
      { kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 10_500_000, batas: 10_000_000, sisaFaktur: 8_000_000, belumDinota: 0, pesanan: 2_500_000 },
    ]);
    const rusak = { ...lama, belumDinota: Number.NaN };
    expect(nilaiKredit(rusak, aturan({ batasNilai: 10_000_000 }), {}, 1_000_000).tingkat).toBe("AMAN");
  });
});

describe("lewatBatasNilai — perbandingan per sen", () => {
  it("sama dengan batas bukan lewat; pecahan float tidak memutus beda", () => {
    expect(lewatBatasNilai(21_000_000, 21_000_000)).toBe(false);
    expect(lewatBatasNilai(0.1 + 0.2, 0.3)).toBe(false);
    expect(lewatBatasNilai(21_000_000.01, 21_000_000)).toBe(true);
    expect(lewatBatasNilai(20_999_999.99, 21_000_000)).toBe(false);
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

describe("batasKreditBerlaku — satu arti kolom kosong untuk semua pemeriksaan", () => {
  const bawaan = { batasNilai: 20_000_000, batasFaktur: 5 };
  const bawaanKosong = { batasNilai: null, batasFaktur: null };

  it("toko punya batas sendiri: angka toko, bawaan diabaikan — 0 juga sah", () => {
    expect(batasKreditBerlaku({ creditLimit: 15_000_000, maxOpenInvoices: 2 }, bawaan)).toEqual({
      nilai: { sumber: "TOKO", nilai: 15_000_000 },
      faktur: { sumber: "TOKO", nilai: 2 },
    });
    expect(batasKreditBerlaku({ creditLimit: 0, maxOpenInvoices: 0 }, bawaan)).toEqual({
      nilai: { sumber: "TOKO", nilai: 0 },
      faktur: { sumber: "TOKO", nilai: 0 },
    });
  });

  it("kolom toko kosong, bawaan diisi: ikut bawaan", () => {
    expect(batasKreditBerlaku({ creditLimit: null, maxOpenInvoices: null }, bawaan)).toEqual({
      nilai: { sumber: "BAWAAN", nilai: 20_000_000 },
      faktur: { sumber: "BAWAAN", nilai: 5 },
    });
    // Tidak dikirim sama dengan kosong.
    expect(batasKreditBerlaku({}, bawaan).nilai).toEqual({ sumber: "BAWAAN", nilai: 20_000_000 });
  });

  it("kolom toko kosong, bawaan juga kosong: tidak dibatasi (keadaan pabrik)", () => {
    expect(batasKreditBerlaku({ creditLimit: null, maxOpenInvoices: null }, bawaanKosong)).toEqual({
      nilai: { sumber: "BAWAAN_KOSONG", nilai: null },
      faktur: { sumber: "BAWAAN_KOSONG", nilai: null },
    });
    expect(batasKreditBerlaku({}, ATURAN_KREDIT_BAWAAN).nilai.nilai).toBeNull();
  });

  it("tanpa batas kredit: menang atas angka toko dan bawaan, untuk nilai dan faktur", () => {
    expect(batasKreditBerlaku({ creditLimit: 15_000_000, maxOpenInvoices: 2, noCreditLimit: true }, bawaan)).toEqual({
      nilai: { sumber: "TANPA_BATAS", nilai: null },
      faktur: { sumber: "TANPA_BATAS", nilai: null },
    });
    expect(batasKreditBerlaku({ noCreditLimit: true }, bawaanKosong).nilai).toEqual({ sumber: "TANPA_BATAS", nilai: null });
    // false sama dengan tidak dicentang.
    expect(batasKreditBerlaku({ creditLimit: null, noCreditLimit: false }, bawaan).nilai).toEqual({ sumber: "BAWAAN", nilai: 20_000_000 });
  });

  it("P21: toko konsinyasi berkolom kosong tidak dibatasi sama sekali; angka sendiri tetap berlaku", () => {
    expect(BAWAAN_BERLAKU_UNTUK_KONSI).toBe(false);
    expect(batasKreditBerlaku({ creditLimit: null, termsType: "KONSI" }, { batasNilai: 20_000_000, batasFaktur: 3 })).toEqual({
      nilai: { sumber: "KONSI_KOSONG", nilai: null },
      faktur: { sumber: "KONSI_KOSONG", nilai: null },
    });
    expect(batasKreditBerlaku({ creditLimit: null, termsType: "KONSI" }, bawaan).nilai).toEqual({ sumber: "KONSI_KOSONG", nilai: null });
    expect(batasKreditBerlaku({ creditLimit: 7_000_000, termsType: "KONSI" }, bawaan).nilai).toEqual({ sumber: "TOKO", nilai: 7_000_000 });
    expect(batasKreditBerlaku({ creditLimit: 7_000_000, termsType: "KONSI", noCreditLimit: true }, bawaan).nilai).toEqual({
      sumber: "TANPA_BATAS",
      nilai: null,
    });
    expect(batasKreditBerlaku({ creditLimit: null, termsType: "PUTUS" }, bawaan).nilai).toEqual({ sumber: "BAWAAN", nilai: 20_000_000 });
  });

  it("nilaiKredit memakai batas yang sama dengan batasKreditBerlaku", () => {
    const k = { ...bersih, sisa: 19_000_000, fakturTerbuka: 1 };
    for (const toko of [
      { creditLimit: 15_000_000 },
      { creditLimit: null },
      { creditLimit: null, noCreditLimit: true },
    ]) {
      for (const a of [aturan(bawaan), aturan(bawaanKosong)]) {
        const batas = batasKreditBerlaku(toko, a).nilai.nilai;
        const lewat = nilaiKredit(k, a, toko, 2_000_000).alasan.some((x) => x.kode === "MELEBIHI_BATAS_NILAI");
        expect(lewat).toBe(batas !== null && 21_000_000 > batas);
      }
    }
  });
});
