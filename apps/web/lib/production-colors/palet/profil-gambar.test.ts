import { describe, expect, it } from 'vitest';
import { bacaProfilWarna, buangProfilWarna } from './profil-gambar';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** Profil ICC minimal: header 128 byte, satu tag deskripsi. */
function icc(nama: string, jenis: 'desc' | 'mluc' = 'desc'): number[] {
  let isi: number[];
  if (jenis === 'desc') {
    isi = [...ascii('desc'), 0, 0, 0, 0, ...be32(nama.length + 1), ...ascii(nama), 0];
  } else {
    const utf16 = [...nama].flatMap((c) => be16(c.charCodeAt(0)));
    isi = [...ascii('mluc'), 0, 0, 0, 0, ...be32(1), ...be32(12), ...ascii('enUS'), ...be32(utf16.length), ...be32(28), ...utf16];
  }
  const offsetTag = 128 + 4 + 12;
  const header = new Array(128).fill(0);
  const total = offsetTag + isi.length;
  header.splice(0, 4, ...be32(total));
  return [...header, ...be32(1), ...ascii('desc'), ...be32(offsetTag), ...be32(isi.length), ...isi];
}

function jpeg(denganProfil: string | null): Uint8Array {
  const app0 = [0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const profil = denganProfil ? icc(denganProfil) : [];
  const app2Isi = [...ascii('ICC_PROFILE'), 0, 1, 1, ...profil];
  const app2 = denganProfil ? [0xff, 0xe2, ...be16(app2Isi.length + 2), ...app2Isi] : [];
  const dqt = [0xff, 0xdb, ...be16(5), 0, 1, 2];
  // Data scan sengaja berisi 0xFF 0x00 dan byte yang mirip penanda: harus disalin utuh.
  const sos = [0xff, 0xda, ...be16(8), 1, 1, 0, 0, 0x3f, 0, 0x12, 0xff, 0x00, 0xe2, 0x34, 0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app2, ...dqt, ...sos]);
}

function pngChunk(jenis: string, data: number[]): number[] {
  return [...be32(data.length), ...ascii(jenis), ...data, 0xde, 0xad, 0xbe, 0xef];
}

function png(denganProfil: string | null): Uint8Array {
  const tanda = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const iccp = denganProfil ? pngChunk('iCCP', [...ascii(denganProfil), 0, 0, 0x78, 0x9c, 1, 2, 3]) : [];
  const gama = denganProfil ? pngChunk('gAMA', be32(45455)) : [];
  const idat = pngChunk('IDAT', [1, 2, 3, 4]);
  const iend = pngChunk('IEND', []);
  return new Uint8Array([...tanda, ...ihdr, ...iccp, ...gama, ...idat, ...iend]);
}

function webp(denganProfil: string | null): Uint8Array {
  const chunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
  const vp8x = chunk('VP8X', [denganProfil ? 0x20 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const iccp = denganProfil ? chunk('ICCP', icc(denganProfil)) : [];
  const vp8l = chunk('VP8L', [0x2f, 1, 2, 3, 4]);
  const isi = [...ascii('WEBP'), ...vp8x, ...iccp, ...vp8l];
  return new Uint8Array([...ascii('RIFF'), ...le32(isi.length), ...isi]);
}

describe('bacaProfilWarna', () => {
  it('membaca nama profil dari JPEG, termasuk profil monitor seperti S24R35xFZ', () => {
    expect(bacaProfilWarna(jpeg('S24R35xFZ'))).toEqual({ format: 'jpeg', adaProfil: true, nama: 'S24R35xFZ' });
    expect(bacaProfilWarna(jpeg(null))).toEqual({ format: 'jpeg', adaProfil: false, nama: null });
  });

  it('membaca nama profil dari PNG dan WebP', () => {
    expect(bacaProfilWarna(png('Display P3'))).toEqual({ format: 'png', adaProfil: true, nama: 'Display P3' });
    expect(bacaProfilWarna(webp('Display P3'))).toEqual({ format: 'webp', adaProfil: true, nama: 'Display P3' });
    expect(bacaProfilWarna(png(null)).adaProfil).toBe(false);
  });

  it('membaca deskripsi ICC versi 4 (mluc)', () => {
    const profil = icc('Display P3', 'mluc');
    const app2Isi = [...ascii('ICC_PROFILE'), 0, 1, 1, ...profil];
    const berkas = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, ...be16(app2Isi.length + 2), ...app2Isi, 0xff, 0xd9]);
    expect(bacaProfilWarna(berkas).nama).toBe('Display P3');
  });

  /*
   * Potongan nyata dari profil "S24R35xFZ" di berkas yang dilaporkan: tag
   * mluc dengan panjang 18 di depan offset 28. Fixture sintetis di atas
   * pernah dibangun dengan urutan yang sama kelirunya dengan pembacanya,
   * jadi keduanya lulus bersama sambil menghasilkan nama sampah.
   */
  it('membaca mluc dengan urutan panjang-lalu-offset seperti di berkas sungguhan', () => {
    const nama = [...'S24R35xFZ'].flatMap((c) => be16(c.charCodeAt(0)));
    const mluc = [...ascii('mluc'), 0, 0, 0, 0, ...be32(1), ...be32(12), ...ascii('enUS'), ...be32(18), ...be32(28), ...nama];
    const header = new Array(128).fill(0);
    const profil = [...header, ...be32(1), ...ascii('desc'), ...be32(144), ...be32(mluc.length), ...mluc];
    const app2Isi = [...ascii('ICC_PROFILE'), 0, 1, 1, ...profil];
    const berkas = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, ...be16(app2Isi.length + 2), ...app2Isi, 0xff, 0xd9]);
    expect(bacaProfilWarna(berkas).nama).toBe('S24R35xFZ');
  });

  it('tidak melempar untuk berkas yang bukan gambar atau rusak', () => {
    expect(bacaProfilWarna(new Uint8Array([1, 2, 3]))).toEqual({ format: 'lain', adaProfil: false, nama: null });
    expect(bacaProfilWarna(new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0xff, 0xff])).format).toBe('jpeg');
  });
});

describe('buangProfilWarna', () => {
  /*
   * Gambar tanpa profil dianggap sRGB oleh setiap browser, jadi tidak ada
   * yang diterjemahkan: angka yang tertulis di berkas sampai ke kanvas utuh.
   * Selain profil, SATU byte pun tidak boleh berubah — data gambarnya harus
   * tetap bisa dibuka.
   */
  it('melepas profil JPEG dan menyalin sisanya byte demi byte', () => {
    const tanpa = buangProfilWarna(jpeg('S24R35xFZ'));
    expect([...tanpa]).toEqual([...jpeg(null)]);
    expect(bacaProfilWarna(tanpa).adaProfil).toBe(false);
  });

  it('melepas iCCP dan gAMA dari PNG tanpa menyentuh potongan lain', () => {
    expect([...buangProfilWarna(png('Display P3'))]).toEqual([...png(null)]);
  });

  it('melepas ICCP dari WebP, mematikan bendera profilnya, dan membetulkan ukuran RIFF', () => {
    const tanpa = buangProfilWarna(webp('Display P3'));
    expect([...tanpa]).toEqual([...webp(null)]);
  });

  it('mengembalikan berkas yang sama kalau tidak ada profil atau formatnya tidak dikenal', () => {
    const polos = jpeg(null);
    expect(buangProfilWarna(polos)).toBe(polos);
    const lain = new Uint8Array([1, 2, 3]);
    expect(buangProfilWarna(lain)).toBe(lain);
  });
});
