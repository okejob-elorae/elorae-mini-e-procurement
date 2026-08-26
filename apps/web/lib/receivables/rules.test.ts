import { describe, expect, it } from 'vitest';
import {
  hitungSisaPiutang,
  keadaanPiutang,
  nilaiDiakui,
  returTertahan,
  type PotonganRetur,
} from './rules';

/**
 * Tes ini menjaga dua aturan uang yang jadi alasan program ini ada. Setiap
 * kasus di sini pernah terjadi sungguhan di lapangan — bukan kasus karangan
 * untuk mengejar cakupan.
 */

const TERBUKA = (klaim: number, fisik: number | null): PotonganRetur => ({
  nilaiKlaim: klaim,
  nilaiFisik: fisik,
  bebanTerbuka: true,
});

describe('returTertahan — retur diakui sebesar fisik, bukan sebesar klaim', () => {
  it('menahan PENUH selama gudang belum menghitung', () => {
    // Kasus paling sering: sales memotong retur, barangnya belum sampai gudang.
    expect(returTertahan([TERBUKA(870_000, null)])).toBe(870_000);
  });

  it('tidak menahan apa pun kalau fisik sama dengan klaim', () => {
    expect(returTertahan([TERBUKA(500_000, 500_000)])).toBe(0);
  });

  it('menahan sebesar selisihnya saja, bukan seluruh klaim', () => {
    // Toko klaim 3 dus, sampai 2 dus. Yang ditahan satu dus, bukan tiganya.
    expect(returTertahan([TERBUKA(1_500_000, 1_000_000)])).toBe(500_000);
  });

  it('tidak menahan lagi setelah bebannya diputuskan', () => {
    // Selisih tetap ada, tapi sudah ada yang menanggung — faktur dilepas.
    expect(
      returTertahan([{ nilaiKlaim: 1_500_000, nilaiFisik: 1_000_000, bebanTerbuka: false }]),
    ).toBe(0);
  });

  it('tidak menahan apa pun kalau fisik LEBIH dari klaim', () => {
    // Gudang menerima lebih banyak dari yang ditulis toko. Bukan utang toko.
    expect(returTertahan([TERBUKA(500_000, 700_000)])).toBe(0);
  });

  it('membedakan gudang belum menghitung dari gudang menghitung nol', () => {
    // null = belum dicek → tahan penuh lewat cabang pertama.
    // 0    = sudah dicek, tidak ada barang sampai → tahan penuh lewat selisih.
    // Nilainya kebetulan sama, jalurnya berbeda, dan bedanya penting: yang
    // kedua sudah bisa dibebankan ke seseorang, yang pertama belum.
    expect(returTertahan([TERBUKA(400_000, null)])).toBe(400_000);
    expect(returTertahan([TERBUKA(400_000, 0)])).toBe(400_000);
    expect(
      returTertahan([{ nilaiKlaim: 400_000, nilaiFisik: 0, bebanTerbuka: false }]),
    ).toBe(0);
  });

  it('menjumlahkan beberapa potongan retur pada satu klaim', () => {
    expect(returTertahan([TERBUKA(300_000, null), TERBUKA(1_000_000, 800_000)])).toBe(500_000);
  });
});

describe('nilaiDiakui — klaim bukan lunas', () => {
  it('nol selama klaim masih menunggu verifikasi', () => {
    // Inti Aturan 1. Sales sudah lapor, uang belum terlihat di rekening.
    expect(
      nilaiDiakui({ status: 'DIKIRIM', nilaiFaktur: 7_050_000, potonganRetur: [] }),
    ).toBe(0);
  });

  it('nol untuk klaim yang ditolak', () => {
    expect(
      nilaiDiakui({ status: 'DITOLAK', nilaiFaktur: 7_050_000, potonganRetur: [] }),
    ).toBe(0);
  });

  it('penuh setelah terverifikasi dan tidak ada retur menggantung', () => {
    expect(
      nilaiDiakui({ status: 'TERVERIFIKASI', nilaiFaktur: 7_050_000, potonganRetur: [] }),
    ).toBe(7_050_000);
  });

  it('dikurangi retur yang tertahan meski sudah terverifikasi', () => {
    expect(
      nilaiDiakui({
        status: 'TERVERIFIKASI',
        nilaiFaktur: 7_050_000,
        potonganRetur: [TERBUKA(870_000, null)],
      }),
    ).toBe(6_180_000);
  });

  it('tidak pernah negatif walau retur tertahan melebihi nilai faktur', () => {
    expect(
      nilaiDiakui({
        status: 'TERVERIFIKASI',
        nilaiFaktur: 500_000,
        potonganRetur: [TERBUKA(900_000, null)],
      }),
    ).toBe(0);
  });
});

describe('hitungSisaPiutang', () => {
  it('tidak berkurang sepeser pun oleh klaim yang belum diverifikasi', () => {
    expect(
      hitungSisaPiutang(10_000_000, [
        {
          status: 'DIKIRIM',
          nilaiFaktur: 10_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 10_000_000,
        },
      ]),
    ).toBe(10_000_000);
  });

  it('nol setelah klaim penuh terverifikasi', () => {
    expect(
      hitungSisaPiutang(10_000_000, [
        {
          status: 'TERVERIFIKASI',
          nilaiFaktur: 10_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 10_000_000,
        },
      ]),
    ).toBe(0);
  });

  it('membagi klaim yang melunasi beberapa piutang menurut porsinya', () => {
    // Satu transfer melunasi dua faktur. Piutang yang dihitung kebagian 40%.
    expect(
      hitungSisaPiutang(4_000_000, [
        {
          status: 'TERVERIFIKASI',
          nilaiFaktur: 10_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 4_000_000,
        },
      ]),
    ).toBe(0);
  });

  it('menyisakan retur tertahan secara proporsional pada klaim gabungan', () => {
    // Retur tertahan 1.000.000 dari klaim 10.000.000; piutang ini 40% dari klaim,
    // jadi yang tersisa 40% dari yang tertahan = 400.000.
    expect(
      hitungSisaPiutang(4_000_000, [
        {
          status: 'TERVERIFIKASI',
          nilaiFaktur: 10_000_000,
          potonganRetur: [TERBUKA(1_000_000, null)],
          nilaiDilunasiPiutangIni: 4_000_000,
        },
      ]),
    ).toBe(400_000);
  });

  it('menjumlahkan beberapa klaim atas satu piutang', () => {
    expect(
      hitungSisaPiutang(10_000_000, [
        {
          status: 'TERVERIFIKASI',
          nilaiFaktur: 6_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 6_000_000,
        },
        {
          status: 'DIKIRIM',
          nilaiFaktur: 4_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 4_000_000,
        },
      ]),
    ).toBe(4_000_000);
  });

  it('tidak pernah negatif walau terbayar melebihi nilai piutang', () => {
    expect(
      hitungSisaPiutang(1_000_000, [
        {
          status: 'TERVERIFIKASI',
          nilaiFaktur: 5_000_000,
          potonganRetur: [],
          nilaiDilunasiPiutangIni: 5_000_000,
        },
      ]),
    ).toBe(0);
  });
});

describe('keadaanPiutang — enam keadaan, diperiksa berurutan', () => {
  const HARI_INI = new Date('2026-08-26T00:00:00Z');
  const KEMARIN = new Date('2026-08-20T00:00:00Z');
  const BESOK = new Date('2026-09-05T00:00:00Z');
  const dasar = {
    sisa: 5_000_000,
    klaimMenunggu: null,
    nilaiTertahan: 0,
    kontrabon: null,
    hariIni: HARI_INI,
  };

  it('lunas menang atas segalanya', () => {
    expect(
      keadaanPiutang({
        ...dasar,
        sisa: 0,
        klaimMenunggu: { docNo: 'BKM/1' },
        nilaiTertahan: 900_000,
        kontrabon: { docNo: 'TT/1', janjiBayar: KEMARIN },
      }),
    ).toBe('lunas');
  });

  it('klaim menang atas lewat tempo — sales yang sudah lapor tidak dimarahi', () => {
    expect(
      keadaanPiutang({
        ...dasar,
        klaimMenunggu: { docNo: 'BKM/1' },
        kontrabon: { docNo: 'TT/1', janjiBayar: KEMARIN },
      }),
    ).toBe('klaim');
  });

  it('tertahan menang atas lewat tempo', () => {
    expect(
      keadaanPiutang({
        ...dasar,
        nilaiTertahan: 870_000,
        kontrabon: { docNo: 'TT/1', janjiBayar: KEMARIN },
      }),
    ).toBe('tertahan');
  });

  it('lewat kalau janji bayar sudah terlewat', () => {
    expect(
      keadaanPiutang({ ...dasar, kontrabon: { docNo: 'TT/1', janjiBayar: KEMARIN } }),
    ).toBe('lewat');
  });

  it('tt kalau janji bayarnya belum sampai', () => {
    expect(
      keadaanPiutang({ ...dasar, kontrabon: { docNo: 'TT/1', janjiBayar: BESOK } }),
    ).toBe('tt');
  });

  it('belum kalau tidak ada apa-apa yang menggantung', () => {
    expect(keadaanPiutang(dasar)).toBe('belum');
  });
});

describe('bahanPotonganRetur — nilai fisik diprorata per potongan', () => {
  it('tidak menahan potongan yang bukan retur', async () => {
    // Potongan promosi bukan janji tentang barang yang akan datang.
    const { bahanPotonganRetur } = await import('./rules');
    expect(bahanPotonganRetur([{ nilaiPotongan: 500_000, retur: null }])).toEqual([]);
  });

  it('menahan penuh selama gudang belum menghitung', async () => {
    const { bahanPotonganRetur, returTertahan } = await import('./rules');
    const bahan = bahanPotonganRetur([
      { nilaiPotongan: 600_000, retur: { nilaiKlaim: 1_000_000, nilaiFisik: null, bebanDiputuskan: false } },
    ]);
    expect(returTertahan(bahan)).toBe(600_000);
  });

  it('memprorata satu NRT yang dipotong lewat dua pembayaran', async () => {
    // Kasus yang membuat prorata ada. Tanpa prorata seluruh selisih 200.000
    // lenyap karena tiap potongan tampak sudah tertutup nilai fisik penuh.
    const { bahanPotonganRetur, returTertahan } = await import('./rules');
    const retur = { nilaiKlaim: 1_000_000, nilaiFisik: 800_000, bebanDiputuskan: false };
    const pertama = returTertahan(bahanPotonganRetur([{ nilaiPotongan: 600_000, retur }]));
    const kedua = returTertahan(bahanPotonganRetur([{ nilaiPotongan: 400_000, retur }]));
    expect(pertama).toBeCloseTo(120_000, 6);
    expect(kedua).toBeCloseTo(80_000, 6);
    expect(pertama + kedua).toBeCloseTo(200_000, 6);
  });

  it('melepas potongan begitu bebannya diputuskan', async () => {
    const { bahanPotonganRetur, returTertahan } = await import('./rules');
    const bahan = bahanPotonganRetur([
      { nilaiPotongan: 600_000, retur: { nilaiKlaim: 1_000_000, nilaiFisik: 800_000, bebanDiputuskan: true } },
    ]);
    expect(returTertahan(bahan)).toBe(0);
  });

  it('memperlakukan NRT bernilai nol sebagai belum dihitung', async () => {
    // Tidak bisa diprorata. Arahnya aman: piutang terlihat lebih besar.
    const { bahanPotonganRetur, returTertahan } = await import('./rules');
    const bahan = bahanPotonganRetur([
      { nilaiPotongan: 300_000, retur: { nilaiKlaim: 0, nilaiFisik: 0, bebanDiputuskan: false } },
    ]);
    expect(returTertahan(bahan)).toBe(300_000);
  });

  it('tidak menahan apa pun kalau gudang menerima lebih dari klaim', async () => {
    const { bahanPotonganRetur, returTertahan } = await import('./rules');
    const bahan = bahanPotonganRetur([
      { nilaiPotongan: 500_000, retur: { nilaiKlaim: 500_000, nilaiFisik: 700_000, bebanDiputuskan: false } },
    ]);
    expect(returTertahan(bahan)).toBe(0);
  });
});

describe('langkahRetur — empat langkah, diperiksa berurutan', () => {
  const dasar = {
    dibatalkan: false,
    adaNotaToko: true,
    adaHitunganFinal: true,
    nilaiKlaim: 1_000_000,
    nilaiFisik: 800_000 as number | null,
    bebanDiputuskan: false,
  };

  it('batal menang atas segalanya', async () => {
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, dibatalkan: true })).toBe('batal');
  });

  it('jodoh untuk penerimaan gudang tanpa nota toko', async () => {
    // Fisiknya sudah terhitung; yang kurang adalah nota mana yang ia lunasi.
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, adaNotaToko: false })).toBe('jodoh');
  });

  it('cek selama gudang belum menutup hitungan', async () => {
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, adaHitunganFinal: false, nilaiFisik: null })).toBe('cek');
  });

  it('cek juga kalau hitungannya masih draft', async () => {
    // Angka yang masih bisa berubah tidak boleh dianggap sudah dihitung.
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, adaHitunganFinal: false })).toBe('cek');
  });

  it('keputusan kalau fisik kurang dan belum ada yang menanggung', async () => {
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur(dasar)).toBe('keputusan');
  });

  it('beres begitu bebannya diputuskan', async () => {
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, bebanDiputuskan: true })).toBe('beres');
  });

  it('beres kalau fisik sama atau lebih dari klaim', async () => {
    const { langkahRetur } = await import('./rules');
    expect(langkahRetur({ ...dasar, nilaiFisik: 1_000_000 })).toBe('beres');
    expect(langkahRetur({ ...dasar, nilaiFisik: 1_200_000 })).toBe('beres');
  });
});

describe('giliranRetur', () => {
  it('cek adalah giliran gudang, keputusan dan jodoh giliran keuangan', async () => {
    const { giliranRetur } = await import('./rules');
    expect(giliranRetur('cek')).toBe('gudang');
    expect(giliranRetur('keputusan')).toBe('keuangan');
    expect(giliranRetur('jodoh')).toBe('keuangan');
    expect(giliranRetur('beres')).toBe('tidak_ada');
    expect(giliranRetur('batal')).toBe('tidak_ada');
  });
});
