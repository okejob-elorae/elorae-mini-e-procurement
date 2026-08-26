import { describe, expect, it } from 'vitest';
import {
  bagiKomisi,
  bandingkanLaporan,
  giliranTahap,
  stokTitipan,
  tahapSiklus,
  type BahanTahap,
} from './aturan';

const LENGKAP: BahanTahap = {
  adaLaporanSpg: true,
  adaLaporanToko: true,
  terkunci: true,
  adaSpg: true,
  semuaKomisiDibayar: true,
  adaNota: true,
  adaFakturPajak: true,
};

describe('tahapSiklus — enam tahap, diperiksa berurutan', () => {
  it('laporan selama salah satu laporan belum masuk', () => {
    expect(tahapSiklus({ ...LENGKAP, adaLaporanSpg: false })).toBe('laporan');
    expect(tahapSiklus({ ...LENGKAP, adaLaporanToko: false })).toBe('laporan');
  });

  it('cocok setelah dua laporan masuk tapi angkanya belum dikunci', () => {
    expect(tahapSiklus({ ...LENGKAP, terkunci: false })).toBe('cocok');
  });

  it('bayar_spg setelah dikunci selama komisinya belum dibayar', () => {
    expect(tahapSiklus({ ...LENGKAP, semuaKomisiDibayar: false })).toBe('bayar_spg');
  });

  it('MELEWATI bayar_spg kalau tokonya tidak punya SPG', () => {
    // Tanpa ini siklus toko tanpa SPG menggantung di "menunggu bayar gaji"
    // selamanya, dan rantainya tidak pernah sampai ke nota maupun pajak.
    expect(tahapSiklus({ ...LENGKAP, adaSpg: false, semuaKomisiDibayar: false, adaNota: false })).toBe(
      'nota',
    );
  });

  it('nota setelah gaji beres', () => {
    expect(tahapSiklus({ ...LENGKAP, adaNota: false })).toBe('nota');
  });

  it('pajak setelah nota ada', () => {
    expect(tahapSiklus({ ...LENGKAP, adaFakturPajak: false })).toBe('pajak');
  });

  it('selesai kalau ketiga nomornya lengkap', () => {
    expect(tahapSiklus(LENGKAP)).toBe('selesai');
  });

  it('tahap awal menang atas tahap akhir', () => {
    // Nomor nota yang sudah terisi tidak boleh membuat siklus tampak maju
    // padahal laporannya belum lengkap.
    expect(tahapSiklus({ ...LENGKAP, adaLaporanSpg: false, adaNota: true })).toBe('laporan');
  });
});

describe('giliranTahap', () => {
  it('menyebut giliran yang berbeda untuk tiap tahap', () => {
    expect(giliranTahap('laporan')).toBe('spg_dan_toko');
    expect(giliranTahap('cocok')).toBe('admin_konsi');
    expect(giliranTahap('bayar_spg')).toBe('keuangan');
    expect(giliranTahap('nota')).toBe('admin_penjualan');
    expect(giliranTahap('pajak')).toBe('admin_pajak');
    expect(giliranTahap('selesai')).toBe('tidak_ada');
  });
});

describe('bandingkanLaporan', () => {
  it('menyandingkan menurut nama barang, bukan urutan baris', () => {
    // SPG melapor lewat surel, toko lewat ekspedisi; urutannya tidak pernah sama.
    const hasil = bandingkanLaporan(
      [
        { itemName: 'Blus', qty: 5 },
        { itemName: 'Rok', qty: 3 },
      ],
      [
        { itemName: 'Rok', qty: 3 },
        { itemName: 'Blus', qty: 4 },
      ],
    );
    expect(hasil.find((b) => b.itemName === 'Blus')).toMatchObject({ qtySpg: 5, qtyToko: 4, selisih: 1 });
    expect(hasil.find((b) => b.itemName === 'Rok')?.selisih).toBe(0);
  });

  it('menampilkan barang yang hanya ada di satu laporan', () => {
    // Justru kasus yang paling perlu terlihat.
    const hasil = bandingkanLaporan([{ itemName: 'Blus', qty: 5 }], []);
    expect(hasil[0]).toMatchObject({ qtySpg: 5, qtyToko: null, selisih: null });
  });
});

describe('bagiKomisi', () => {
  it('menghitung dari qty dikali tarif per barang', () => {
    // Tarifnya melekat pada barang, berbeda tiap barang.
    const { totalKomisi } = bagiKomisi(
      [
        { qty: 10, commissionPerPcs: 500 },
        { qty: 4, commissionPerPcs: 100 },
      ],
      1,
    );
    expect(totalKomisi).toBe(5_400);
  });

  it('membagi rata antar SPG satu toko', () => {
    const { perSpg } = bagiKomisi([{ qty: 10, commissionPerPcs: 300 }], 2);
    expect(perSpg).toEqual([1_500, 1_500]);
  });

  it('memberikan sisa pembagian ke SPG pertama, tidak membuangnya', () => {
    // Membuangnya membuat total yang dibayarkan tidak pernah sama dengan
    // komisi yang dihitung, dan selisih receh itu kembali setiap bulan.
    const { totalKomisi, perSpg } = bagiKomisi([{ qty: 10, commissionPerPcs: 100 }], 3);
    expect(totalKomisi).toBe(1_000);
    expect(perSpg).toEqual([334, 333, 333]);
    expect(perSpg.reduce((a, b) => a + b, 0)).toBe(totalKomisi);
  });

  it('mengembalikan daftar kosong kalau tidak ada SPG', () => {
    const { totalKomisi, perSpg } = bagiKomisi([{ qty: 10, commissionPerPcs: 100 }], 0);
    expect(totalKomisi).toBe(1_000);
    expect(perSpg).toEqual([]);
  });
});

describe('stokTitipan', () => {
  it('menghitung sisa dari dikirim dikurangi terjual', () => {
    const hasil = stokTitipan(
      [
        { itemName: 'Blus', qty: 20 },
        { itemName: 'Rok', qty: 10 },
      ],
      [{ itemName: 'Blus', qty: 8 }],
    );
    expect(hasil.find((b) => b.itemName === 'Blus')?.sisa).toBe(12);
    expect(hasil.find((b) => b.itemName === 'Rok')?.sisa).toBe(10);
  });

  it('menjumlahkan beberapa pengiriman barang yang sama', () => {
    const hasil = stokTitipan(
      [
        { itemName: 'Blus', qty: 20 },
        { itemName: 'Blus', qty: 5 },
      ],
      [{ itemName: 'Blus', qty: 8 }],
    );
    expect(hasil[0]).toMatchObject({ dikirim: 25, terjual: 8, sisa: 17 });
  });

  it('MEMPERTAHANKAN sisa negatif, tidak menolkannya', () => {
    // Toko melaporkan menjual lebih banyak daripada yang pernah dikirim. Itu
    // pertanyaan yang harus terlihat, bukan disembunyikan jadi nol.
    const hasil = stokTitipan([{ itemName: 'Blus', qty: 5 }], [{ itemName: 'Blus', qty: 8 }]);
    expect(hasil[0].sisa).toBe(-3);
  });
});
