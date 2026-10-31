import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cariFont, DAFTAR_FONT, FONT_BAWAAN, fontDikenal } from './fonts';

/**
 * Katalog huruf.
 *
 * Yang paling mungkin rusak di sini BUKAN logikanya — ia hampir tidak punya
 * logika — melainkan SAMBUNGANNYA: nama variabel CSS di katalog ini harus sama
 * persis dengan yang dideklarasikan `next/font` di layout. Yang meleset tidak
 * gagal di mana pun: pilihannya muncul, diklik, dan tidak mengubah apa pun.
 */

const layout = readFileSync('app/layout.tsx', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');

describe('sambungan ke layout', () => {
  it('setiap huruf punya variabel yang BENAR-BENAR dideklarasikan di layout', () => {
    const hilang = DAFTAR_FONT.filter((f) => !layout.includes(`'${f.variabel}'`));
    expect(hilang.map((f) => `${f.nama} (${f.variabel})`)).toEqual([]);
  });

  it('setiap variabel yang dideklarasikan ikut dipasang di elemen akar', () => {
    /*
     * Sebuah `next/font` yang dibuat tapi variabelnya tidak dipasang di <html>
     * menghasilkan @font-face yang tidak pernah bisa dirujuk siapa pun.
     */
    const akar = layout.slice(layout.indexOf('className={`'), layout.indexOf('suppressHydrationWarning'));
    const nama = DAFTAR_FONT.filter((f) => f.id !== 'jakarta').map((f) => f.variabel);
    const konstanta = layout.slice(layout.indexOf('const SEMUA_FONT'), layout.indexOf('.map((f) => f.variable)'));
    for (const v of nama) {
      const deklarasi = new RegExp(`const (\\w+) = \\w+\\({[^}]*'${v}'`, 's').exec(layout);
      expect(deklarasi, `variabel ${v} tidak punya deklarasi`).not.toBeNull();
      expect(konstanta, `${deklarasi![1]} tidak masuk SEMUA_FONT`).toContain(deklarasi![1]);
    }
    expect(akar).toContain('SEMUA_FONT');
    // Jakarta dipasang lewat variabelnya sendiri, bukan lewat SEMUA_FONT.
    expect(akar).toContain('appSans.variable');
  });

  it('saklar huruf aplikasi menunjuk ke huruf bawaan', () => {
    // Kalau `--font-app-sans` tidak punya nilai awal, pengguna yang belum
    // pernah memilih mendapat huruf sistem — bukan bawaan yang dimaksud.
    expect(globals).toContain('--font-app-sans: var(--font-jakarta)');
    expect(cariFont(FONT_BAWAAN).variabel).toBe('--font-jakarta');
  });
});

describe('katalog', () => {
  it('berisi dua puluh pilihan', () => {
    expect(DAFTAR_FONT).toHaveLength(20);
  });

  it('tidak punya id atau variabel kembar', () => {
    // Id kembar membuat satu pilihan mustahil dipilih; variabel kembar membuat
    // dua pilihan menghasilkan huruf yang sama.
    expect(new Set(DAFTAR_FONT.map((f) => f.id)).size).toBe(20);
    expect(new Set(DAFTAR_FONT.map((f) => f.variabel)).size).toBe(20);
  });

  it('setiap pilihan punya keterangan yang benar-benar menjelaskan', () => {
    // Keterangan kosong atau sekadar mengulang namanya tidak membantu siapa pun
    // memilih, dan itu satu-satunya guna kolom ini.
    for (const f of DAFTAR_FONT) {
      expect(f.keterangan.length).toBeGreaterThan(20);
      expect(f.keterangan).not.toBe(f.nama);
    }
  });

  it('menawarkan lebih dari satu jenis, bukan dua puluh grotesk yang mirip', () => {
    const jenis = new Set(DAFTAR_FONT.map((f) => f.jenis));
    expect(jenis.size).toBeGreaterThanOrEqual(3);
    expect(DAFTAR_FONT.filter((f) => f.jenis === 'serif').length).toBeGreaterThanOrEqual(2);
  });
});

describe('cariFont', () => {
  it('mengembalikan huruf yang diminta', () => {
    expect(cariFont('inter').nama).toBe('Inter');
  });

  it('jatuh ke bawaan untuk id yang tidak dikenal, tidak melempar', () => {
    /*
     * Id datang dari basis data dan localStorage — keduanya bisa memuat
     * pilihan lama yang sudah dicabut dari daftar. Melempar di sini akan
     * merusak seluruh halaman gara-gara sebuah huruf.
     */
    expect(cariFont('sudah-dihapus').id).toBe(FONT_BAWAAN);
    expect(cariFont(null).id).toBe(FONT_BAWAAN);
    expect(cariFont(undefined).id).toBe(FONT_BAWAAN);
  });
});

describe('fontDikenal', () => {
  it('menolak id yang tidak ada', () => {
    // Penjagaan penulisnya: id tak dikenal yang tersimpan akan diam-diam jatuh
    // ke bawaan tiap kali dibaca, dan tidak ada yang menjelaskan kenapa.
    expect(fontDikenal('inter')).toBe(true);
    expect(fontDikenal('sudah-dihapus')).toBe(false);
    expect(fontDikenal('')).toBe(false);
  });
});
