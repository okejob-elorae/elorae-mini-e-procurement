import { describe, expect, it } from "vitest";
import {
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

// Aturan beban toko sementara (2026-10-06: faktur beban `BEBAN/<NRT>` dan batas
// potong NRT) dicabut oleh keputusan 1 (2026-11-02, P84): selisih yang ditanggung
// toko tetap terbuka di nota asalnya, tidak ditagih lewat faktur baru.

// `bebanDitagihKeToko` tinggal sebagai pembantu USANG untuk pratinjau lama di
// `return-queries.ts`; perilakunya dikunci di sini sampai pemanggil itu dibuang.
describe("bebanDitagihKeToko (usang) — perilakunya tidak berubah", () => {
  const nota = { nilaiKlaim: 300_000, nilaiFisik: 100_000 };

  it("hanya bagian yang dipotong melebihi barang yang sampai, tidak pernah melebihi selisih", () => {
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 300_000 })).toBe(200_000);
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 150_000 })).toBe(50_000);
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 0 })).toBe(0);
    expect(bebanDitagihKeToko({ nilaiKlaim: 300_000, nilaiFisik: 300_000, sudahDipotong: 300_000 })).toBe(0);
  });

  it("dihitung dalam sen, dan aturan seluruh-selisih tetap bisa dipilih", () => {
    expect(bebanDitagihKeToko({ nilaiKlaim: 100.3, nilaiFisik: 0.1, sudahDipotong: 50.2 })).toBe(50.1);
    expect(bebanDitagihKeToko({ ...nota, sudahDipotong: 0 }, "SELURUH_SELISIH")).toBe(200_000);
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
