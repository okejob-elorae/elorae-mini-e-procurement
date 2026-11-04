import { describe, expect, it } from 'vitest';
import { cariBarisJudul, normalisasiJudul, petakanKolom } from './kolom';
import { keRupiah, keTanggal } from './nilai';
import { bacaLembar, sudahLunas } from './baris';

/**
 * Impor faktur. Setiap kasus di sini adalah bentuk berkas yang benar-benar
 * dikirim toko atau kantor — bukan kasus karangan untuk mengejar cakupan.
 */

describe('keRupiah — pemisah desimal adalah tanda baca terakhir, kalau diikuti 1–2 angka', () => {
  it('membaca titik ribuan sebagai ribuan, bukan desimal', () => {
    // Kalau salah, 1.250.000 jadi 1,25 — salah sejuta kali lipat.
    expect(keRupiah('1.250.000')).toBe(1_250_000);
  });

  it('membaca koma desimal sebagai desimal', () => {
    expect(keRupiah('1250000,50')).toBe(1_250_000.5);
  });

  it('membuang awalan Rp dan spasi', () => {
    expect(keRupiah('Rp 1.250.000')).toBe(1_250_000);
    expect(keRupiah('  Rp1.250.000  ')).toBe(1_250_000);
  });

  it('membaca campuran titik ribuan dan koma desimal', () => {
    expect(keRupiah('1.250.000,75')).toBe(1_250_000.75);
  });

  it('membaca angka Excel apa adanya', () => {
    expect(keRupiah(1_250_000)).toBe(1_250_000);
  });

  it('membaca negatif', () => {
    expect(keRupiah('-250.000')).toBe(-250_000);
  });

  it('mengembalikan null untuk sel kosong atau bukan angka', () => {
    expect(keRupiah('')).toBeNull();
    expect(keRupiah('   ')).toBeNull();
    expect(keRupiah(null)).toBeNull();
    expect(keRupiah('lunas')).toBeNull();
  });

  it('membedakan nol dari kosong', () => {
    // Perbedaan yang menentukan sebuah faktur lunas atau masih hidup.
    expect(keRupiah('0')).toBe(0);
    expect(keRupiah(0)).toBe(0);
    expect(keRupiah('')).toBeNull();
  });
});

describe('keTanggal', () => {
  const hari = (d: Date | null) =>
    d === null
      ? null
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);

  it('membaca ISO', () => {
    expect(hari(keTanggal('2026-08-21'))).toBe('2026-08-21');
  });

  it('membaca hari/bulan/tahun', () => {
    expect(hari(keTanggal('21/08/2026'))).toBe('2026-08-21');
  });

  it('membaca tahun dua digit: lebih dari 70 berarti 19xx', () => {
    expect(hari(keTanggal('21-08-26'))).toBe('2026-08-21');
    expect(hari(keTanggal('21-08-71'))).toBe('1971-08-21');
  });

  it('mendarat tepat tengah malam WIB', () => {
    // Jatuh tempo yang bergeser sehari menandai faktur lewat tempo lebih cepat.
    expect(keTanggal('2026-08-21')?.toISOString()).toBe('2026-08-20T17:00:00.000Z');
  });

  it('membaca tanggal Excel', () => {
    expect(hari(keTanggal(46255))).toBe('2026-08-21');
  });

  it('menolak bulan atau hari yang mustahil', () => {
    expect(keTanggal('2026-13-01')).toBeNull();
    expect(keTanggal('32/01/2026')).toBeNull();
  });
});

describe('petakanKolom', () => {
  it('mengenali sinonim apa pun ejaannya', () => {
    const peta = petakanKolom(['No. Faktur', 'Nama Pelanggan', 'Jatuh Tempo', 'Grand Total', 'Sisa Piutang']);
    expect(peta).toEqual({ no_faktur: 0, toko: 1, jatuh_tempo: 2, nilai: 3, sisa: 4 });
  });

  it('mengabaikan judul yang tidak dikenali, bukan menggagalkan berkasnya', () => {
    const peta = petakanKolom(['No Faktur', 'Kolom Aneh', 'Total']);
    expect(peta).toEqual({ no_faktur: 0, nilai: 2 });
  });

  it('memakai kolom paling kiri kalau ada dua yang cocok', () => {
    const peta = petakanKolom(['Total', 'Grand Total']);
    expect(peta.nilai).toBe(0);
  });

  it('menormalkan tanda baca dan huruf besar', () => {
    expect(normalisasiJudul('  No. FAKTUR ')).toBe('nofaktur');
  });
});

describe('cariBarisJudul', () => {
  it('melewati kop dan baris kosong', () => {
    // Berkas nyata selalu diawali nama perusahaan dan baris kosong.
    const sel = [['PT Contoh'], [], ['Laporan Piutang'], ['No Faktur', 'Toko', 'Total', 'Sisa']];
    expect(cariBarisJudul(sel)).toBe(3);
  });

  it('menyerah setelah 20 baris', () => {
    const sel = Array.from({ length: 30 }, () => ['x']);
    expect(cariBarisJudul(sel)).toBe(-1);
  });
});

describe('bacaLembar — kolom tak ada / sel kosong / benar-benar nol', () => {
  const JUDUL = ['No Faktur', 'Kode Toko', 'Jatuh Tempo', 'Total', 'Sisa'];

  it('sisa NOL berarti fakturnya sudah lunas', () => {
    // Aturan yang brief sebut wajib benar. Kalau `0` terbaca sebagai "kosong",
    // faktur yang sudah lunas dihidupkan kembali jadi tagihan.
    const { baris } = bacaLembar([JUDUL, ['INV-1', 'TK-1', '2026-09-01', '1.000.000', '0']]);
    expect(baris[0].sisaTertulis).toBe(0);
    expect(baris[0].sisa).toBe(0);
    expect(sudahLunas(baris[0])).toBe(true);
  });

  it('sel sisa KOSONG berarti tidak ada informasi — sisa = nilai penuh', () => {
    const { baris } = bacaLembar([JUDUL, ['INV-2', 'TK-1', '2026-09-01', '1.000.000', '']]);
    expect(baris[0].sisaTertulis).toBeUndefined();
    expect(baris[0].sisa).toBe(1_000_000);
    expect(sudahLunas(baris[0])).toBe(false);
  });

  it('kolom sisa TIDAK ADA berarti sisa = nilai penuh', () => {
    const { baris, adaKolomSisa } = bacaLembar([
      ['No Faktur', 'Kode Toko', 'Jatuh Tempo', 'Total'],
      ['INV-3', 'TK-1', '2026-09-01', '1.000.000'],
    ]);
    expect(adaKolomSisa).toBe(false);
    expect(baris[0].sisaTertulis).toBeUndefined();
    expect(baris[0].sisa).toBe(1_000_000);
  });

  it('membatasi sisa ke nilai fakturnya', () => {
    // Berkas nyata kadang membawa sisa lebih besar dari nilainya — bunga,
    // denda, atau salah ketik. Memakainya apa adanya menagih lebih dari
    // yang pernah ditagihkan.
    const { baris } = bacaLembar([JUDUL, ['INV-4', 'TK-1', '2026-09-01', '1.000.000', '1.500.000']]);
    expect(baris[0].sisa).toBe(1_000_000);
  });

  it('tidak membiarkan sisa negatif', () => {
    const { baris } = bacaLembar([JUDUL, ['INV-5', 'TK-1', '2026-09-01', '1.000.000', '-50.000']]);
    expect(baris[0].sisa).toBe(0);
  });

  it('melaporkan masalah tanpa membuang barisnya', () => {
    // Pengguna harus melihat apa yang TIDAK akan masuk sebelum menyimpan.
    const { baris } = bacaLembar([JUDUL, ['', 'TK-1', '2026-09-01', 'abc', '']]);
    expect(baris).toHaveLength(1);
    expect(baris[0].masalah).toContain('NO_FAKTUR_KOSONG');
    expect(baris[0].masalah).toContain('NILAI_TIDAK_TERBACA');
  });

  it('menandai faktur tanpa toko', () => {
    const { baris } = bacaLembar([JUDUL, ['INV-6', '', '2026-09-01', '1.000.000', '']]);
    expect(baris[0].masalah).toContain('TOKO_KOSONG');
  });

  it('melewati baris kosong tanpa melaporkannya', () => {
    const { baris } = bacaLembar([
      JUDUL,
      ['INV-7', 'TK-1', '2026-09-01', '1.000.000', ''],
      ['', '', '', '', ''],
      [],
    ]);
    expect(baris).toHaveLength(1);
  });

  it('membawa nomor baris asli untuk dilaporkan', () => {
    const { baris } = bacaLembar([
      ['PT Contoh'],
      [],
      JUDUL,
      ['INV-8', 'TK-1', '2026-09-01', '1.000.000', ''],
    ]);
    expect(baris[0].baris).toBe(4);
  });
});
