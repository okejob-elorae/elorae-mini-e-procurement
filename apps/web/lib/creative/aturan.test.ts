import { describe, expect, it } from 'vitest';
import {
  bebanDiakui,
  bolehPindahBrief,
  bolehPindahKonten,
  kontenTerlambat,
  langkahBerikutBrief,
  nilaiBebanDiakui,
  stokKeluarSaat,
  stokKembaliSaatBatal,
  tierKol,
  type StatusBrief,
} from './aturan';

const SEMUA_BRIEF: StatusBrief[] = [
  'DRAFT',
  'DIKIRIM',
  'DISETUJUI',
  'KONTEN_DITERIMA',
  'TAYANG',
  'SELESAI',
  'BATAL',
];

describe('Aturan 1 — brief terkirim bukan beban', () => {
  it('TIDAK mengakui fee selama kontennya belum tayang', () => {
    /*
     * Bentuk yang sama persis dengan "klaim bukan lunas" di modul piutang:
     * sebelum ada bukti bahwa yang dijanjikan terjadi, angkanya nol.
     */
    for (const s of ['DRAFT', 'DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA'] as StatusBrief[]) {
      expect(bebanDiakui(s)).toBe(false);
      expect(nilaiBebanDiakui(s, 2_500_000)).toBe(0);
    }
  });

  it('mengakui fee begitu tayang', () => {
    expect(nilaiBebanDiakui('TAYANG', 2_500_000)).toBe(2_500_000);
  });

  it('tetap mengakui fee setelah selesai', () => {
    // SELESAI hanya bisa dicapai lewat TAYANG; mencabut pengakuannya di sana
    // akan membuat beban muncul lalu hilang lagi tanpa ada yang membatalkannya.
    expect(nilaiBebanDiakui('SELESAI', 2_500_000)).toBe(2_500_000);
  });

  it('TIDAK mengakui fee brief yang dibatalkan', () => {
    expect(nilaiBebanDiakui('BATAL', 2_500_000)).toBe(0);
  });
});

describe('Aturan 2 — stok bergerak saat dikirim, bukan saat direncanakan', () => {
  it('mengeluarkan stok TEPAT pada perpindahan draft ke dikirim', () => {
    expect(stokKeluarSaat('DRAFT', 'DIKIRIM')).toBe(true);
  });

  it('TIDAK mengeluarkan stok dua kali pada perpindahan berikutnya', () => {
    // Kalau setiap tahap sesudahnya juga mengeluarkan stok, satu brief menguras
    // gudang lima kali untuk satu paket yang sama.
    expect(stokKeluarSaat('DIKIRIM', 'DISETUJUI')).toBe(false);
    expect(stokKeluarSaat('DISETUJUI', 'KONTEN_DITERIMA')).toBe(false);
    expect(stokKeluarSaat('KONTEN_DITERIMA', 'TAYANG')).toBe(false);
  });

  it('TIDAK mengeluarkan stok saat draft dibatalkan', () => {
    expect(stokKeluarSaat('DRAFT', 'BATAL')).toBe(false);
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

describe('perpindahan status brief', () => {
  it('menolak lompatan yang melewati tahap', () => {
    // Langsung dari DRAFT ke TAYANG berarti stoknya tidak pernah keluar.
    expect(bolehPindahBrief('DRAFT', 'TAYANG')).toBe(false);
    expect(bolehPindahBrief('DRAFT', 'DIKIRIM')).toBe(true);
  });

  it('TIDAK BISA menghidupkan kembali brief yang dibatalkan', () => {
    /*
     * Menghidupkannya berarti stoknya harus dikeluarkan ulang, dan tidak ada
     * yang mengingatkan. Yang benar adalah membuat brief baru.
     */
    for (const s of SEMUA_BRIEF) expect(bolehPindahBrief('BATAL', s)).toBe(false);
    expect(langkahBerikutBrief('BATAL')).toEqual([]);
  });

  it('tidak membawa brief selesai ke mana pun', () => {
    for (const s of SEMUA_BRIEF) expect(bolehPindahBrief('SELESAI', s)).toBe(false);
  });

  it('membolehkan pembatalan dari setiap tahap yang belum tayang', () => {
    for (const s of ['DRAFT', 'DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA'] as StatusBrief[]) {
      expect(bolehPindahBrief(s, 'BATAL')).toBe(true);
    }
    // ...tapi tidak setelah tayang: kontennya sudah terlanjur ada di publik.
    expect(bolehPindahBrief('TAYANG', 'BATAL')).toBe(false);
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
