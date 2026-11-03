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

describe('hitungSisaPiutang — uang yang masuk di kantor, bukan lewat BKM', () => {
  it('faktur yang dibayar penuh di kantor tidak lagi terbuka', () => {
    // Tanpa ini layar piutang dan HP sales masih menagih faktur yang sudah
    // dibayar, dan BKM bisa melunasinya sekali lagi.
    expect(hitungSisaPiutang(1_000_000, [], 0, 1_000_000)).toBe(0);
  });

  it('pembayaran kantor, BKM terverifikasi, dan bayar sebelum impor sama-sama mengurangi', () => {
    expect(
      hitungSisaPiutang(
        1_000_000,
        [{ status: 'TERVERIFIKASI', nilaiFaktur: 300_000, potonganRetur: [], nilaiDilunasiPiutangIni: 300_000 }],
        100_000,
        250_000,
      ),
    ).toBe(350_000);
  });

  it('faktur bersen yang dilunasi penuh di kantor bersisa nol', () => {
    // Dibulatkan sesudah dikurangi: 1.000,50 − 1.000,50 = 0, bukan
    // pembulatan 1.001 dikurangi 1.000,50.
    expect(hitungSisaPiutang(1_000.5, [], 0, 1_000.5)).toBe(0);
  });

  it('tidak pernah negatif', () => {
    expect(hitungSisaPiutang(500_000, [], 0, 700_000)).toBe(0);
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

describe("giliranRetur — keputusan selisih menurut hasil cek sales", () => {
  const cek = (status: "DITANYAKAN" | "DITEMUKAN" | "TIDAK_DITEMUKAN", lain: { adaSusulanSesudahLapor?: boolean; batasLewat?: boolean } = {}) => ({
    status,
    adaSusulanSesudahLapor: lain.adaSusulanSesudahLapor ?? false,
    batasLewat: lain.batasLewat ?? false,
  });

  it("sales belum melapor → giliran sales", async () => {
    const { giliranRetur } = await import("./rules");
    expect(giliranRetur("keputusan", cek("DITANYAKAN"))).toBe("sales");
  });

  it("ditemukan dan susulannya belum dihitung → giliran gudang", async () => {
    const { giliranRetur } = await import("./rules");
    expect(giliranRetur("keputusan", cek("DITEMUKAN"))).toBe("gudang");
  });

  it("ditemukan, susulan sudah dihitung, masih ada sisa → sales memeriksa lagi", async () => {
    const { giliranRetur } = await import("./rules");
    expect(giliranRetur("keputusan", cek("DITEMUKAN", { adaSusulanSesudahLapor: true }))).toBe("sales");
  });

  it("tidak ditemukan, atau batas lapor lewat → giliran keuangan", async () => {
    const { giliranRetur } = await import("./rules");
    expect(giliranRetur("keputusan", cek("TIDAK_DITEMUKAN"))).toBe("keuangan");
    expect(giliranRetur("keputusan", cek("DITANYAKAN", { batasLewat: true }))).toBe("keuangan");
    expect(giliranRetur("keputusan", cek("DITEMUKAN", { batasLewat: true }))).toBe("keuangan");
  });

  it("tanpa cek perilakunya tetap", async () => {
    const { giliranRetur } = await import("./rules");
    expect(giliranRetur("keputusan", null)).toBe("keuangan");
    expect(giliranRetur("cek", cek("DITANYAKAN"))).toBe("gudang");
  });
});

describe("bolehDibebankanKeSales — P88, 14 hari kalender WIB", () => {
  // Selisih lahir 1 Okt 10.00 WIB (03.00Z).
  const lahir = new Date("2026-10-01T03:00:00Z");

  it("batasnya dipatok 14 hari", async () => {
    const { BATAS_HARI_LAPOR_SELISIH } = await import("./rules");
    expect(BATAS_HARI_LAPOR_SELISIH).toBe(14);
  });

  it("tidak ditemukan → boleh seketika", async () => {
    const { bolehDibebankanKeSales } = await import("./rules");
    expect(bolehDibebankanKeSales({ cek: "TIDAK_DITEMUKAN", dibuatPada: lahir, sekarang: lahir }).boleh).toBe(true);
  });

  it("ditanyakan/ditemukan: hari ke-13 belum, hari ke-14 boleh tepat sejak tengah malam WIB", async () => {
    const { bolehDibebankanKeSales } = await import("./rules");
    for (const c of ["DITANYAKAN", "DITEMUKAN"] as const) {
      // 14 Okt 23.59 WIB = hari ke-13
      expect(bolehDibebankanKeSales({ cek: c, dibuatPada: lahir, sekarang: new Date("2026-10-14T16:59:00Z") }).boleh).toBe(false);
      // 15 Okt 00.00 WIB = hari ke-14
      const h = bolehDibebankanKeSales({ cek: c, dibuatPada: lahir, sekarang: new Date("2026-10-14T17:00:00Z") });
      expect(h.boleh).toBe(true);
      expect(h.mulai).toBe("2026-10-15");
    }
  });
});

describe("statusBebanSales", () => {
  it("lunas begitu potongan menutup besarnya, dalam sen", async () => {
    const { statusBebanSales } = await import("./rules");
    expect(statusBebanSales(100_000, 100_000, "DITETAPKAN")).toBe("LUNAS");
    expect(statusBebanSales(100_000, 99_999.99, "DITETAPKAN")).toBe("DITETAPKAN");
    // Besarnya turun di bawah yang sudah dipotong (barang ketemu, P87) → tetap lunas.
    expect(statusBebanSales(40_000, 100_000, "LUNAS")).toBe("LUNAS");
    // Besarnya naik sesudah lunas → kembali ditetapkan.
    expect(statusBebanSales(150_000, 100_000, "LUNAS")).toBe("DITETAPKAN");
  });

  it("nol tanpa potongan tidak mengubah status", async () => {
    const { statusBebanSales } = await import("./rules");
    expect(statusBebanSales(0, 0, "DITETAPKAN")).toBe("DITETAPKAN");
    expect(statusBebanSales(0, 0, "LUNAS")).toBe("LUNAS");
  });
});

describe("tertahanPiutangRinci & pisahTahananRetur — Q15", () => {
  type P = import("./rules").PorsiKlaim;
  const bkm = (nilaiFaktur: number, dilunasi: number, potonganRetur: P["potonganRetur"], status: P["status"] = "TERVERIFIKASI"): P => ({
    status,
    nilaiFaktur,
    nilaiDilunasiPiutangIni: dilunasi,
    potonganRetur,
  });
  const belumDihitung = (n: number) => ({ nilaiKlaim: n, nilaiFisik: null, bebanTerbuka: true });
  const dihitungNolTerbuka = (n: number) => ({ nilaiKlaim: n, nilaiFisik: 0, bebanTerbuka: true });
  const tetap = (n: number) => ({ nilaiKlaim: n, nilaiFisik: null, bebanTerbuka: true, tetap: true });

  it("(a) potongan belum dihitung", async () => {
    const { tertahanPiutangRinci, pisahTahananRetur } = await import("./rules");
    const r = tertahanPiutangRinci([bkm(600_000, 600_000, [belumDihitung(300_000)])]);
    expect(r).toEqual({ lepasSendiri: 300_000, tetap: 0, jenisLepas: "BELUM_DIHITUNG" });
    expect(pisahTahananRetur(700_000, r)).toEqual({ bebas: 400_000, ditahan: 300_000, nilaiTertahan: 300_000, sebab: "BELUM_DIHITUNG" });
  });

  it("(b) dihitung nol, beban terbuka → menunggu beban", async () => {
    const { tertahanPiutangRinci } = await import("./rules");
    expect(tertahanPiutangRinci([bkm(600_000, 600_000, [dihitungNolTerbuka(300_000)])]).jenisLepas).toBe("MENUNGGU_BEBAN");
  });

  it("(c) keduanya pada satu BKM → campuran", async () => {
    const { tertahanPiutangRinci } = await import("./rules");
    expect(
      tertahanPiutangRinci([bkm(600_000, 600_000, [belumDihitung(100_000), dihitungNolTerbuka(100_000)])]).jenisLepas,
    ).toBe("CAMPURAN");
  });

  it("(d) BKM gabungan diprorata per faktur", async () => {
    const { tertahanPiutangRinci } = await import("./rules");
    expect(tertahanPiutangRinci([bkm(600_000, 300_000, [belumDihitung(300_000)])]).lepasSendiri).toBe(150_000);
  });

  it("(e) tahanan tetap saja", async () => {
    const { tertahanPiutangRinci, pisahTahananRetur } = await import("./rules");
    const r = tertahanPiutangRinci([bkm(1_000_000, 1_000_000, [tetap(300_000)])]);
    expect(r).toEqual({ lepasSendiri: 0, tetap: 300_000, jenisLepas: null });
    expect(pisahTahananRetur(300_000, r)).toEqual({ bebas: 300_000, ditahan: 0, nilaiTertahan: 300_000, sebab: null });
  });

  it("(f) campuran lepas + tetap pada satu faktur", async () => {
    const { pisahTahananRetur } = await import("./rules");
    expect(pisahTahananRetur(700, { lepasSendiri: 300, tetap: 200, jenisLepas: "BELUM_DIHITUNG" })).toEqual({
      bebas: 400,
      ditahan: 300,
      nilaiTertahan: 500,
      sebab: "BELUM_DIHITUNG",
    });
  });

  it("(g) potongan di atas nilai BKM dibatasi", async () => {
    const { tertahanPiutangRinci } = await import("./rules");
    expect(tertahanPiutangRinci([bkm(200_000, 200_000, [belumDihitung(300_000)])]).lepasSendiri).toBe(200_000);
  });

  it("(h) BKM yang belum terverifikasi atau ditolak tidak menahan apa pun", async () => {
    const { tertahanPiutangRinci } = await import("./rules");
    for (const st of ["DIKIRIM", "DITOLAK"] as const) {
      expect(tertahanPiutangRinci([bkm(600_000, 600_000, [belumDihitung(300_000)], st)])).toEqual({
        lepasSendiri: 0,
        tetap: 0,
        jenisLepas: null,
      });
    }
  });

  it("(i) tertahanPiutang sama dengan lepasSendiri", async () => {
    const { tertahanPiutang, tertahanPiutangRinci } = await import("./rules");
    const kasus = [
      [bkm(600_000, 600_000, [belumDihitung(300_000)])],
      [bkm(600_000, 300_000, [belumDihitung(300_000), tetap(100_000)])],
      [bkm(1_000_000, 1_000_000, [tetap(300_000)])],
    ];
    for (const k of kasus) expect(tertahanPiutang(k)).toBe(tertahanPiutangRinci(k).lepasSendiri);
  });
});
