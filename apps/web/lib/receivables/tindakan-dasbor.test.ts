import { describe, expect, it } from 'vitest';
import { susunTindakan, tautanPiutang, tautanRetur, type BahanTindakan } from './tindakan-dasbor';

/*
 * Daftar "Perlu tindakan hari ini" di beranda piutang.
 *
 * Dua kesalahan nyata yang dijaga di sini:
 * - faktur lewat JATUH TEMPO tanpa kontrabon tidak tercantum sama sekali;
 * - BKM yang dicatat admin sendiri berbunyi "sales sudah lapor" dan berada di
 *   puncak daftar, padahal admin itu tidak boleh memutuskannya (PEMERIKSA_SAMA).
 */
const hariIni = new Date('2026-10-06T10:00:00+07:00');

const faktur = (
  invoiceNo: string,
  p: Partial<BahanTindakan['piutang'][number]> = {},
): BahanTindakan['piutang'][number] => ({
  invoiceNo,
  storeName: 'Toko Sinar Jaya',
  dueDate: '2026-09-19T17:00:00.000Z',
  outstanding: 1_000_000,
  keadaan: 'belum',
  keadaanTampil: 'belum',
  alasan: {},
  ...p,
});

const bahan = (b: Partial<BahanTindakan>): BahanTindakan => ({
  piutang: [],
  klaimMenunggu: [],
  retur: [],
  penontonId: 'admin',
  hariIni,
  ...b,
});

describe('susunTindakan', () => {
  it('mencantumkan faktur lewat jatuh tempo, menaut ke daftar yang tersaring pada faktur itu', () => {
    const t = susunTindakan(
      bahan({
        piutang: [
          faktur('INV/IMP/001', { keadaanTampil: 'jatuh_tempo', alasan: { hariLewatJatuhTempo: 16 } }),
          faktur('INV/2026/0200'),
        ],
      }),
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      jenis: 'jatuh_tempo',
      judul: 'INV/IMP/001',
      nilai: 1_000_000,
      konteks: { toko: 'Toko Sinar Jaya', hari: 16 },
      tautan: '/backoffice/piutang?keadaan=jatuh_tempo&cari=INV%2FIMP%2F001',
    });
  });

  it('lewat janji bayar menaut ke ?keadaan=lewat pada fakturnya', () => {
    const [t] = susunTindakan(
      bahan({ piutang: [faktur('INV/2026/0103', { keadaan: 'lewat', keadaanTampil: 'lewat', alasan: { hariTerlambat: 27 } })] }),
    );
    expect(t).toMatchObject({
      jenis: 'lewat',
      konteks: { hari: 27 },
      tautan: '/backoffice/piutang?keadaan=lewat&cari=INV%2F2026%2F0103',
    });
  });

  it('BKM milik penonton sendiri diberi tanda, menyebut pelapornya, dan turun di bawah pekerjaan yang bisa ia kerjakan', () => {
    const t = susunTindakan(
      bahan({
        piutang: [faktur('INV/IMP/005', { keadaanTampil: 'jatuh_tempo', alasan: { hariLewatJatuhTempo: 1 } })],
        klaimMenunggu: [
          {
            id: 'k1',
            docNo: 'BKM/2026/0004',
            receivedAmount: 8_530_000,
            createdAt: new Date('2026-08-27T10:00:00+07:00'),
            storeName: 'Toko Sinar Jaya',
            salesmanId: 'admin',
            createdById: 'admin',
            pelapor: 'Administrator',
          },
          {
            id: 'k2',
            docNo: 'BKM/2026/0007',
            receivedAmount: 2_000_000,
            createdAt: new Date('2026-10-01T10:00:00+07:00'),
            storeName: 'Toko Makmur',
            salesmanId: 'budi',
            createdById: 'budi',
            pelapor: 'Budi',
          },
        ],
      }),
    );
    const milikSendiri = t.find((x) => x.judul === 'BKM/2026/0004');
    const rekan = t.find((x) => x.judul === 'BKM/2026/0007');
    expect(milikSendiri?.konteks).toMatchObject({ milikSaya: true, pelapor: 'Administrator', hari: 40 });
    expect(rekan?.konteks).toMatchObject({ milikSaya: false, pelapor: 'Budi', hari: 5 });
    expect(rekan?.tautan).toBe('/backoffice/pelunasan/k2');
    // Yang tidak bisa ia putuskan sendiri tidak boleh menutupi yang bisa.
    const urutan = t.map((x) => x.judul);
    expect(urutan.indexOf('BKM/2026/0004')).toBeGreaterThan(urutan.indexOf('INV/IMP/005'));
    expect(urutan.indexOf('BKM/2026/0004')).toBeGreaterThan(urutan.indexOf('BKM/2026/0007'));
  });

  it('terurut dari risiko terbesar dan dibatasi dua puluh baris', () => {
    const piutang = Array.from({ length: 30 }, (_, i) =>
      faktur(`INV/${i}`, { keadaanTampil: 'jatuh_tempo', alasan: { hariLewatJatuhTempo: i + 1 } }),
    );
    const t = susunTindakan(bahan({ piutang }));
    expect(t).toHaveLength(20);
    expect(t[0].judul).toBe('INV/29');
    const risiko = t.map((x) => x.risiko);
    expect([...risiko].sort((a, b) => b - a)).toEqual(risiko);
  });
});

describe('nota retur yang belum dihitung', () => {
  const nota = {
    id: 'n1',
    jenis: 'NRT' as const,
    salesmanId: 'budi',
    nomor: 'NRT-4510',
    storeName: 'Toko Sinar Jaya',
    langkah: 'cek' as const,
    selisih: 0,
    nilaiKlaim: 640_000,
    nilaiFisik: null,
  };

  it('tidak membawa nilai klaim ke orang yang boleh menghitungnya', () => {
    const [t] = susunTindakan(bahan({ retur: [nota], penontonId: 'gudang-1', bolehMenghitung: true }));
    expect(t.nilai).toBe(0);
    expect(t.konteks.klaimTersembunyi).toBe(true);
  });

  it('pelapornya dan yang tidak menghitung tetap melihat nilainya', () => {
    expect(susunTindakan(bahan({ retur: [nota], penontonId: 'budi', bolehMenghitung: true }))[0].nilai).toBe(640_000);
    expect(susunTindakan(bahan({ retur: [nota], penontonId: 'keuangan', bolehMenghitung: false }))[0].nilai).toBe(640_000);
  });
});

describe('tautanPiutang', () => {
  it('menyusun saringan alamat daftar piutang', () => {
    expect(tautanPiutang({})).toBe('/backoffice/piutang');
    expect(tautanPiutang({ keadaan: 'lewat' })).toBe('/backoffice/piutang?keadaan=lewat');
    expect(tautanPiutang({ keadaan: 'tertahan', cari: 'INV 1' })).toBe('/backoffice/piutang?keadaan=tertahan&cari=INV+1');
  });
});

describe('tautan baris retur dan faktur tertahan', () => {
  it('faktur tertahan menaut ke daftar piutang yang tersaring pada faktur itu', () => {
    const [t] = susunTindakan(
      bahan({ piutang: [faktur('INV/2026/0110', { keadaan: 'tertahan', keadaanTampil: 'tertahan', alasan: { nilaiTertahan: 800_000 } })] }),
    );
    expect(t.jenis).toBe('tertahan');
    expect(t.tautan).toBe('/backoffice/piutang?keadaan=tertahan&cari=INV%2F2026%2F0110');
    expect(t.nilai).toBe(800_000);
  });

  it('nota gudang tanpa pasangan menaut ke daftar retur ?langkah=jodoh pada nomornya', () => {
    const [t] = susunTindakan(
      bahan({
        retur: [
          {
            id: 'g1',
            jenis: 'GUDANG_YATIM',
            salesmanId: null,
            nomor: 'NRI/26/08/0003',
            storeName: null,
            langkah: 'jodoh',
            selisih: 0,
            nilaiKlaim: null,
            nilaiFisik: 120_000,
          },
        ],
      }),
    );
    expect(t.jenis).toBe('jodoh');
    expect(t.tautan).toBe('/backoffice/retur-toko?langkah=jodoh&cari=NRI%2F26%2F08%2F0003');
  });

  it('nota retur toko tetap menaut ke rinciannya', () => {
    const [t] = susunTindakan(
      bahan({
        retur: [
          { id: 'n9', jenis: 'NRT', salesmanId: null, nomor: 'NRT-1', storeName: 'X', langkah: 'keputusan', selisih: 5, nilaiKlaim: 10, nilaiFisik: 5 },
        ],
      }),
    );
    expect(t.tautan).toBe('/backoffice/retur-toko/n9');
  });
});

describe('tautanRetur', () => {
  it('menyusun saringan alamat daftar retur', () => {
    expect(tautanRetur({})).toBe('/backoffice/retur-toko');
    expect(tautanRetur({ langkah: 'cek' })).toBe('/backoffice/retur-toko?langkah=cek');
  });
});
