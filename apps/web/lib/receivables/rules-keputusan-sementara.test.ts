import { describe, expect, it } from "vitest";
import {
  ATURAN_BEBAN_TOKO,
  batasPotongNota,
  bebanDitagihKeToko,
  sisaBolehDilunasi,
  tertahanPiutang,
  type PorsiKlaim,
} from "./rules";

/**
 * Keputusan sementara pemilik 2026-10-06 ("ikuti usulan Claude dulu"), dengan
 * angka nyata dari audit: faktur 1.000.000, NRT 300.000, gudang menghitung
 * 100.000 — selisih 200.000.
 */

describe("bebanDitagihKeToko — toko hanya ditagih yang benar-benar ia ambil", () => {
  const nota = { nilaiKlaim: 300_000, nilaiFisik: 100_000 };

  it("aturan yang berlaku adalah 'yang dipotong'", () => {
    expect(ATURAN_BEBAN_TOKO).toBe("YANG_DIPOTONG");
  });

  it("toko memotong NRT penuh 300.000 → ditagih seluruh selisih 200.000", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 300_000 })).toBe(200_000);
  });

  it("toko baru memotong 150.000 → ditagih 50.000 (yang melebihi barang yang sampai)", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 150_000 })).toBe(50_000);
  });

  it("toko belum memotong apa pun → tidak ada yang ditagih (dulu 200.000: faktur 1 jt + beban 200 rb = 1,2 jt)", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 0 })).toBe(0);
  });

  it("toko memotong tidak lebih dari barang yang sampai → nol", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 100_000 })).toBe(0);
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 80_000 })).toBe(0);
  });

  it("tidak pernah melebihi selisih, dan nol kalau fisik ≥ klaim", () => {
    expect(bebanDitagihKeToko({ nilaiKlaim: 300_000, nilaiFisik: 300_000, sudahDipotong: 300_000 })).toBe(0);
    expect(bebanDitagihKeToko({ nilaiKlaim: 300_000, nilaiFisik: 0, sudahDipotong: 300_000 })).toBe(300_000);
  });

  it("dihitung dalam sen — pecahan desimal tidak menambah atau mengurangi satu sen", () => {
    expect(bebanDitagihKeToko({ nilaiKlaim: 100.3, nilaiFisik: 0.1, sudahDipotong: 50.2 })).toBe(50.1);
  });

  it("aturan lama (SELURUH_SELISIH) tetap bisa dipilih di satu tempat", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 0 }, "SELURUH_SELISIH")).toBe(200_000);
  });
});

describe("batasPotongNota — berapa sebuah NRT boleh dipotong di seluruh BKM hidup", () => {
  it("selama beban belum ditetapkan ke toko: sebesar klaim NRT", () => {
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: null, bebanTokoDitagih: null })).toBe(300_000);
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: 100_000, bebanTokoDitagih: null })).toBe(300_000);
  });

  it("sesudah ditetapkan ke toko tanpa tagihan: hanya sebesar barang yang sampai", () => {
    // Faktur 1 jt − potongan 100 rb = 900 rb: yang memang seharusnya dibayar toko.
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: 100_000, bebanTokoDitagih: 0 })).toBe(100_000);
  });

  it("sesudah ditetapkan ke toko dengan tagihan 50.000: fisik + yang ditagih balik", () => {
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: 100_000, bebanTokoDitagih: 50_000 })).toBe(150_000);
  });

  it("tagihan penuh mengembalikan batas ke nilai klaim, tidak lebih", () => {
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: 100_000, bebanTokoDitagih: 200_000 })).toBe(300_000);
    expect(batasPotongNota({ nilaiKlaim: 300_000, nilaiFisik: 100_000, bebanTokoDitagih: 999_000 })).toBe(300_000);
  });
});

const klaim = (status: PorsiKlaim["status"], nilaiFaktur: number, dilunasi: number, potonganRetur: PorsiKlaim["potonganRetur"]): PorsiKlaim => ({
  status,
  nilaiFaktur,
  nilaiDilunasiPiutangIni: dilunasi,
  potonganRetur,
});

describe("tertahanPiutang / sisaBolehDilunasi — bagian sisa yang tidak boleh dilunasi BKM lain", () => {
  const nrtBelumDihitung = [{ nilaiKlaim: 300_000, nilaiFisik: null, bebanTerbuka: true }];

  it("BKM 1 jt terverifikasi dengan potongan retur 300 rb belum dihitung → 300 rb ditahan, nol boleh dilunasi", () => {
    const list = [klaim("TERVERIFIKASI", 1_000_000, 1_000_000, nrtBelumDihitung)];
    expect(tertahanPiutang(list)).toBe(300_000);
    expect(sisaBolehDilunasi(300_000, 300_000)).toBe(0);
  });

  it("BKM 500 rb dengan potongan retur 300 rb → sisa 800 rb, 300 rb ditahan, 500 rb boleh dilunasi", () => {
    const list = [klaim("TERVERIFIKASI", 500_000, 500_000, nrtBelumDihitung)];
    expect(tertahanPiutang(list)).toBe(300_000);
    expect(sisaBolehDilunasi(800_000, 300_000)).toBe(500_000);
  });

  it("BKM yang belum terverifikasi tidak menahan apa pun (Aturan 1: ia sendiri belum diakui)", () => {
    expect(tertahanPiutang([klaim("DIKIRIM", 1_000_000, 1_000_000, nrtBelumDihitung)])).toBe(0);
    expect(tertahanPiutang([klaim("DITOLAK", 1_000_000, 1_000_000, nrtBelumDihitung)])).toBe(0);
  });

  it("BKM gabungan: tahanannya diprorata menurut porsi faktur ini", () => {
    // BKM 2 jt melunasi dua faktur 1 jt; potongan retur 300 rb tertahan → 150 rb per faktur.
    expect(tertahanPiutang([klaim("TERVERIFIKASI", 2_000_000, 1_000_000, nrtBelumDihitung)])).toBe(150_000);
  });

  it("tahanan tidak pernah melebihi nilai BKM-nya", () => {
    const besar = [{ nilaiKlaim: 900_000, nilaiFisik: null, bebanTerbuka: true }];
    expect(tertahanPiutang([klaim("TERVERIFIKASI", 500_000, 500_000, besar)])).toBe(500_000);
  });

  it("begitu gudang menghitung penuh, tidak ada lagi yang ditahan", () => {
    const beres = [{ nilaiKlaim: 300_000, nilaiFisik: 300_000, bebanTerbuka: true }];
    expect(tertahanPiutang([klaim("TERVERIFIKASI", 1_000_000, 1_000_000, beres)])).toBe(0);
  });

  it("tahanan TETAP (nota dibatalkan / menggantung) tidak lepas sendiri, jadi boleh dilunasi BKM lain", () => {
    // Nota 300 rb dibatalkan sesudah dipotong: toko berutang 300 rb, dan BKM berikutnya cara menagihnya.
    const batal = [{ nilaiKlaim: 300_000, nilaiFisik: 0, bebanTerbuka: true, tetap: true }];
    expect(tertahanPiutang([klaim("TERVERIFIKASI", 1_000_000, 1_000_000, batal)])).toBe(0);
    expect(sisaBolehDilunasi(300_000, 0)).toBe(300_000);
  });

  it("campuran: hanya bagian yang benar-benar lepas sendiri yang ditahan dari BKM lain", () => {
    // BKM 500 rb: retur sementara 300 rb + retur batal 400 rb → tertahan 500 rb (dibatasi BKM).
    // Begitu yang sementara beres, tetap tertahan 400 rb → yang lepas sendiri hanya 100 rb.
    const campur = [
      { nilaiKlaim: 300_000, nilaiFisik: null, bebanTerbuka: true },
      { nilaiKlaim: 400_000, nilaiFisik: 0, bebanTerbuka: true, tetap: true },
    ];
    expect(tertahanPiutang([klaim("TERVERIFIKASI", 500_000, 500_000, campur)])).toBe(100_000);
  });

  it("sisaBolehDilunasi tidak pernah negatif dan dibulatkan ke rupiah", () => {
    expect(sisaBolehDilunasi(100_000, 150_000)).toBe(0);
    expect(sisaBolehDilunasi(333_334, 333_333.33)).toBe(1);
  });
});
