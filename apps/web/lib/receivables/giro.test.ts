import { describe, expect, it } from 'vitest';
import {
  MASA_BERLAKU_GIRO_HARI,
  giroKedaluwarsa,
  giroMenahanVerifikasi,
  hariWib,
  kelompokGiro,
  periksaGiro,
  ringkasGiro,
  tambahHari,
  tanggalWib,
} from './giro';

/**
 * Aturan giro pada laporan pelunasan.
 *
 * Yang paling mahal kalau salah di sini bukan validasinya, melainkan
 * `giroMenahanVerifikasi`: giro yang dianggap lunas sebelum cair adalah Aturan 1
 * yang runtuh lewat pintu belakang — bilyetnya ada di laci, uangnya belum.
 */

const d = (teks: string) => tanggalWib(teks) as Date;

describe('tanggalWib / hariWib', () => {
  it('membaca YYYY-MM-DD sebagai tengah malam WIB, bukan UTC', () => {
    expect(d('2026-09-30').toISOString()).toBe('2026-09-29T17:00:00.000Z');
    expect(hariWib(d('2026-09-30'))).toBe('2026-09-30');
  });

  it('menolak teks yang bukan tanggal', () => {
    expect(tanggalWib('')).toBeNull();
    expect(tanggalWib('30/09/2026')).toBeNull();
    expect(tanggalWib('2026-02-31')).toBeNull();
  });

  it('menghitung hari WIB dari jam berapa pun', () => {
    // 23.30 WIB masih hari yang sama; 00.30 WIB sudah besok — walau UTC-nya
    // masih kemarin.
    expect(hariWib(new Date('2026-09-30T16:30:00Z'))).toBe('2026-09-30');
    expect(hariWib(new Date('2026-09-30T17:30:00Z'))).toBe('2026-10-01');
  });
});

describe('tambahHari', () => {
  it('melewati akhir bulan dan akhir tahun', () => {
    expect(tambahHari('2026-01-31', 1)).toBe('2026-02-01');
    expect(tambahHari('2026-12-20', 70)).toBe('2027-02-28');
  });

  it('mengembalikan null untuk teks yang tidak sah', () => {
    expect(tambahHari('kemarin', 3)).toBeNull();
  });
});

describe('periksaGiro — batas bilyet giro', () => {
  const sah = {
    nomor: 'BG 123456',
    bank: 'BCA',
    tanggalTerbit: d('2026-09-01'),
    tanggalEfektif: d('2026-09-15'),
  };

  it('menerima giro yang lengkap dan dalam masa berlaku', () => {
    const h = periksaGiro(sah);
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.giro.nomor).toBe('BG 123456');
      expect(h.giro.bank).toBe('BCA');
    }
  });

  it('merapikan spasi nomor dan bank', () => {
    const h = periksaGiro({ ...sah, nomor: '  BG 1 ', bank: ' Mandiri ' });
    expect(h.ok && h.giro).toMatchObject({ nomor: 'BG 1', bank: 'Mandiri' });
  });

  it('menuntut nomor, bank, dan kedua tanggal', () => {
    expect(periksaGiro({ ...sah, nomor: '  ' })).toEqual({ ok: false, alasan: 'GIRO_NOMOR_WAJIB' });
    expect(periksaGiro({ ...sah, bank: '' })).toEqual({ ok: false, alasan: 'GIRO_BANK_WAJIB' });
    expect(periksaGiro({ ...sah, tanggalTerbit: null })).toEqual({ ok: false, alasan: 'GIRO_TANGGAL_WAJIB' });
    expect(periksaGiro({ ...sah, tanggalEfektif: null })).toEqual({ ok: false, alasan: 'GIRO_TANGGAL_WAJIB' });
  });

  it('menolak tanggal efektif yang mendahului tanggal terbit', () => {
    expect(periksaGiro({ ...sah, tanggalEfektif: d('2026-08-31') })).toEqual({
      ok: false,
      alasan: 'GIRO_EFEKTIF_SEBELUM_TERBIT',
    });
  });

  it('menerima efektif sama dengan tanggal terbit (giro tidak mundur)', () => {
    expect(periksaGiro({ ...sah, tanggalEfektif: d('2026-09-01') }).ok).toBe(true);
  });

  it('menerima tepat hari ke-70 dan menolak hari ke-71 (PBI 18/41/PBI/2016)', () => {
    // Masa berlaku bilyet giro 70 hari sejak tanggal terbit. Giro dengan tanggal
    // efektif di luarnya tidak bisa diunjukkan ke bank — menerimanya berarti
    // menerima kertas yang tidak akan pernah jadi uang.
    expect(MASA_BERLAKU_GIRO_HARI).toBe(70);
    expect(periksaGiro({ ...sah, tanggalEfektif: d('2026-11-10') }).ok).toBe(true);
    expect(periksaGiro({ ...sah, tanggalEfektif: d('2026-11-11') })).toEqual({
      ok: false,
      alasan: 'GIRO_LEWAT_MASA_BERLAKU',
    });
  });
});

describe('giroMenahanVerifikasi — giro belum lunas sampai cair', () => {
  it('menahan selama giro masih menunggu', () => {
    expect(giroMenahanVerifikasi('MENUNGGU')).toBe(true);
  });

  it('tidak menahan setelah cair, dan tidak menahan klaim tanpa giro', () => {
    expect(giroMenahanVerifikasi('CAIR')).toBe(false);
    expect(giroMenahanVerifikasi(null)).toBe(false);
    expect(giroMenahanVerifikasi(undefined)).toBe(false);
  });
});

describe('kelompokGiro — kapan giro harus disetorkan', () => {
  const hariIni = new Date('2026-09-30T03:00:00Z'); // 10.00 WIB

  it('memisahkan lewat, hari ini, tujuh hari ke depan, dan nanti', () => {
    expect(kelompokGiro(d('2026-09-29'), hariIni)).toBe('LEWAT');
    expect(kelompokGiro(d('2026-09-30'), hariIni)).toBe('HARI_INI');
    expect(kelompokGiro(d('2026-10-01'), hariIni)).toBe('PEKAN_INI');
    expect(kelompokGiro(d('2026-10-07'), hariIni)).toBe('PEKAN_INI');
    expect(kelompokGiro(d('2026-10-08'), hariIni)).toBe('NANTI');
  });

  it('membandingkan hari kalender WIB, bukan selisih jam', () => {
    // 23.50 WIB tanggal 30 masih "hari ini" untuk giro efektif tanggal 30.
    const larut = new Date('2026-09-30T16:50:00Z');
    expect(kelompokGiro(d('2026-09-30'), larut)).toBe('HARI_INI');
    // 00.10 WIB tanggal 1 — giro tanggal 30 sudah lewat.
    const dini = new Date('2026-09-30T17:10:00Z');
    expect(kelompokGiro(d('2026-09-30'), dini)).toBe('LEWAT');
  });
});

describe('giroKedaluwarsa', () => {
  it('lewat 70 hari sejak terbit, bilyetnya tidak bisa lagi diunjukkan', () => {
    const terbit = d('2026-07-01');
    expect(giroKedaluwarsa(terbit, d('2026-09-09'))).toBe(false); // hari ke-70
    expect(giroKedaluwarsa(terbit, d('2026-09-10'))).toBe(true);
  });
});

describe('ringkasGiro', () => {
  it('menjumlahkan tiap kelompok dan menyebut yang harus disetor hari ini', () => {
    const hariIni = new Date('2026-09-30T03:00:00Z');
    const r = ringkasGiro(
      [
        { tanggalEfektif: d('2026-09-20'), nilai: 1_000_000 },
        { tanggalEfektif: d('2026-09-30'), nilai: 2_500_000 },
        { tanggalEfektif: d('2026-10-03'), nilai: 700_000 },
        { tanggalEfektif: d('2026-12-01'), nilai: 300_000 },
        { tanggalEfektif: d('2026-09-28'), nilai: 500_000 },
      ],
      hariIni,
    );
    expect(r.LEWAT).toEqual({ jumlah: 2, nilai: 1_500_000 });
    expect(r.HARI_INI).toEqual({ jumlah: 1, nilai: 2_500_000 });
    expect(r.PEKAN_INI).toEqual({ jumlah: 1, nilai: 700_000 });
    expect(r.NANTI).toEqual({ jumlah: 1, nilai: 300_000 });
  });
});
