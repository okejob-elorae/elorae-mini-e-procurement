import { describe, expect, it } from 'vitest';
import {
  bebanDiakui,
  bolehPindahKonten,
  kontenTerlambat,
  LABEL_PLATFORM,
  nilaiBebanDiakui,
  pengirimanBerangkat,
  SEMUA_PLATFORM,
  stokKembaliSaatBatal,
  stokPerluKeluar,
  tierKol,
} from './aturan';
import type { Tahap } from './tahap';

describe('Aturan 1 — kolaborasi yang disepakati bukan beban', () => {
  it('TIDAK mengakui fee selama kontennya belum tayang', () => {
    /*
     * Bentuk yang sama persis dengan "klaim bukan lunas" di modul piutang:
     * sebelum ada bukti bahwa yang dijanjikan terjadi, angkanya nol.
     */
    for (const t of ['PROSPEK', 'DEAL', 'SAMPEL_DIKIRIM', 'DRAF', 'DRAF_DISETUJUI'] as Tahap[]) {
      expect(bebanDiakui(t)).toBe(false);
      expect(nilaiBebanDiakui(t, 2_500_000)).toBe(0);
    }
  });

  it('mengakui fee begitu tayang, dan tetap sesudahnya', () => {
    // Mencabut pengakuan di tahap sesudahnya akan membuat beban muncul lalu
    // hilang lagi tanpa ada yang membatalkannya.
    for (const t of ['TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI'] as Tahap[]) {
      expect(nilaiBebanDiakui(t, 2_500_000)).toBe(2_500_000);
    }
  });

  it('TIDAK mengakui fee kolaborasi yang keluar jalur', () => {
    for (const t of ['DITOLAK', 'GHOSTING', 'BATAL'] as Tahap[]) expect(nilaiBebanDiakui(t, 2_500_000)).toBe(0);
  });
});

describe('Aturan 2 — stok bergerak saat pengiriman berangkat, bukan saat direncanakan', () => {
  it('berangkat = tanggal kirim DAN resi terisi', () => {
    expect(pengirimanBerangkat({ sentAt: '2026-10-07', trackingNo: 'JNE1' })).toBe(true);
    expect(pengirimanBerangkat({ sentAt: null, trackingNo: 'JNE1' })).toBe(false);
    expect(pengirimanBerangkat({ sentAt: '2026-10-07', trackingNo: '  ' })).toBe(false);
  });

  it('stok keluar sekali saja per pengiriman', () => {
    expect(stokPerluKeluar({ sentAt: '2026-10-07', trackingNo: 'A', stockIssuedAt: null })).toBe(true);
    // Kalau setiap simpan berikutnya juga mengeluarkan stok, satu paket
    // menguras gudang berkali-kali.
    expect(stokPerluKeluar({ sentAt: '2026-10-07', trackingNo: 'A', stockIssuedAt: '2026-10-07' })).toBe(false);
  });

  it('TIDAK PERNAH menarik kembali barang yang sudah berangkat', () => {
    /*
     * Pembatalan adalah keputusan di atas kertas, bukan kurir yang berbalik
     * arah. Mengembalikan stoknya membuat gudang mengaku punya barang yang
     * tidak ada.
     */
    expect(stokKembaliSaatBatal()).toBe(false);
  });
});

describe('platform', () => {
  it('Shopee ikut jadi platform, dan setiap platform berlabel', () => {
    expect(SEMUA_PLATFORM).toContain('SHOPEE');
    for (const p of SEMUA_PLATFORM) expect(LABEL_PLATFORM[p].length).toBeGreaterThan(0);
  });
});

describe('tierKol', () => {
  it('dihitung dari akun dengan pengikut TERBANYAK, bukan dijumlahkan', () => {
    // Menjumlahkan pengikut lintas platform menghitung orang yang sama dua kali.
    expect(tierKol([9_000, 40_000])).toBe('mikro');
  });

  it('memberi tier terendah pada KOL tanpa akun sama sekali', () => {
    expect(tierKol([])).toBe('nano');
  });

  it('memisahkan keempat tingkatnya di ambangnya', () => {
    expect(tierKol([9_999])).toBe('nano');
    expect(tierKol([10_000])).toBe('mikro');
    expect(tierKol([99_999])).toBe('mikro');
    expect(tierKol([100_000])).toBe('makro');
    expect(tierKol([1_000_000])).toBe('mega');
  });
});

describe('perpindahan status konten', () => {
  it('membolehkan mundur dari review ke draft', () => {
    // Konten memang bolak-balik saat direvisi; ini bukan kemunduran yang salah.
    expect(bolehPindahKonten('REVIEW', 'DRAFT')).toBe(true);
  });

  it('tidak membawa konten yang sudah tayang ke mana pun', () => {
    expect(bolehPindahKonten('TAYANG', 'DRAFT')).toBe(false);
  });

  it('membolehkan konten batal dihidupkan lagi sebagai ide', () => {
    // Berbeda dari brief: konten batal tidak pernah menggerakkan stok atau uang,
    // jadi menghidupkannya tidak meninggalkan apa pun yang perlu dibereskan.
    expect(bolehPindahKonten('BATAL', 'IDE')).toBe(true);
  });
});

describe('kontenTerlambat', () => {
  const kemarin = new Date('2026-08-27T00:00:00Z');
  const sekarang = new Date('2026-08-28T00:00:00Z');

  it('menandai yang lewat jadwal dan belum tayang', () => {
    expect(kontenTerlambat('DIJADWALKAN', kemarin, sekarang)).toBe(true);
  });

  it('TIDAK menandai yang sudah tayang atau batal', () => {
    /*
     * Tanggalnya lewat, tapi pekerjaannya selesai. Menandainya merah membuat
     * daftar penuh peringatan yang tidak menuntut apa pun — dan orang berhenti
     * melihat peringatan.
     */
    expect(kontenTerlambat('TAYANG', kemarin, sekarang)).toBe(false);
    expect(kontenTerlambat('BATAL', kemarin, sekarang)).toBe(false);
  });

  it('tidak menandai yang belum punya jadwal', () => {
    expect(kontenTerlambat('IDE', null, sekarang)).toBe(false);
  });
});
