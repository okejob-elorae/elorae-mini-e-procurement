/**
 * Profil warna yang tertempel di berkas gambar.
 *
 * Browser menerjemahkan gambar ber-profil ke ruang warna layar. Untuk foto
 * itu benar; untuk screenshot dan ekspor desain sering KELIRU, karena profil
 * yang tertempel adalah profil monitor si pembuat — kejadian nyata: sebuah
 * JPG membawa profil monitor Samsung "S24R35xFZ", berkasnya menulis #CAC1B0,
 * dan browser menampilkannya sebagai #D0C8B7. Warna yang diambil pun ikut
 * bergeser.
 *
 * Melepas profil membuat browser memperlakukan gambar sebagai sRGB polos,
 * jadi angka di berkas sampai ke kanvas tanpa diterjemahkan. Hanya byte
 * profil yang dibuang; data gambar disalin utuh.
 */

export type FormatGambar = 'jpeg' | 'png' | 'webp' | 'lain';

export type ProfilWarna = { format: FormatGambar; adaProfil: boolean; nama: string | null };

const cocok = (b: Uint8Array, i: number, teks: string) =>
  i + teks.length <= b.length && [...teks].every((c, k) => b[i + k] === c.charCodeAt(0));
const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function formatDari(b: Uint8Array): FormatGambar {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && cocok(b, 1, 'PNG')) return 'png';
  if (cocok(b, 0, 'RIFF') && cocok(b, 8, 'WEBP')) return 'webp';
  return 'lain';
}

/** Nama dari tag 'desc' profil ICC (v2 'desc' atau v4 'mluc'). */
function namaIcc(icc: Uint8Array): string | null {
  try {
    const jumlahTag = be32(icc, 128);
    for (let t = 0; t < jumlahTag && t < 100; t++) {
      const e = 132 + t * 12;
      if (!cocok(icc, e, 'desc')) continue;
      const o = be32(icc, e + 4);
      if (cocok(icc, o, 'desc')) {
        const n = be32(icc, o + 8);
        const s = String.fromCharCode(...icc.subarray(o + 12, o + 12 + n)).replace(/\0+$/, '').trim();
        return s || null;
      }
      if (cocok(icc, o, 'mluc')) {
        // Rekaman pertama: bahasa(2) negara(2) panjang(4) offset(4) — panjang DULU.
        const panjang = be32(icc, o + 20);
        const offset = be32(icc, o + 24);
        let s = '';
        for (let k = 0; k + 1 < panjang; k += 2) s += String.fromCharCode(be16(icc, o + offset + k));
        return s.replace(/\0+$/, '').trim() || null;
      }
    }
  } catch {
    // Profil rusak: ada, tetapi tanpa nama yang bisa dibaca.
  }
  return null;
}

type Potongan = { mulai: number; akhir: number };

/** Segmen JPEG yang berisi profil ICC, plus potongan-potongan data profilnya. */
function segmenIccJpeg(b: Uint8Array): { segmen: Potongan[]; data: Uint8Array[] } {
  const segmen: Potongan[] = [];
  const data: Uint8Array[] = [];
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) break;
    const penanda = b[i + 1];
    if (penanda === 0xff) {
      i += 1;
      continue;
    }
    if (penanda === 0xda || penanda === 0xd9) break;
    if ((penanda >= 0xd0 && penanda <= 0xd7) || penanda === 0x01 || penanda === 0xd8) {
      i += 2;
      continue;
    }
    const panjang = be16(b, i + 2);
    const akhir = i + 2 + panjang;
    if (panjang < 2 || akhir > b.length) break;
    if (penanda === 0xe2 && cocok(b, i + 4, 'ICC_PROFILE\0')) {
      segmen.push({ mulai: i, akhir });
      data.push(b.subarray(i + 4 + 14, akhir));
    }
    i = akhir;
  }
  return { segmen, data };
}

type ChunkPng = { mulai: number; akhir: number; jenis: string; data: Uint8Array };

function chunkPng(b: Uint8Array): ChunkPng[] {
  const hasil: ChunkPng[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const panjang = be32(b, i);
    const jenis = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const akhir = i + 12 + panjang;
    if (akhir > b.length) break;
    hasil.push({ mulai: i, akhir, jenis, data: b.subarray(i + 8, i + 8 + panjang) });
    i = akhir;
    if (jenis === 'IEND') break;
  }
  return hasil;
}

type ChunkWebp = { mulai: number; akhir: number; fourcc: string; data: Uint8Array };

function chunkWebp(b: Uint8Array): ChunkWebp[] {
  const hasil: ChunkWebp[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = String.fromCharCode(...b.subarray(i, i + 4));
    const ukuran = le32(b, i + 4);
    const akhir = i + 8 + ukuran + (ukuran % 2);
    if (i + 8 + ukuran > b.length) break;
    hasil.push({ mulai: i, akhir: Math.min(akhir, b.length), fourcc, data: b.subarray(i + 8, i + 8 + ukuran) });
    i = akhir;
  }
  return hasil;
}

/** PNG yang ikut membuang gamma/primer: tanpa profil, keduanya pun memerintahkan browser menerjemahkan warna. */
const CHUNK_PNG_WARNA = new Set(['iCCP', 'cHRM', 'gAMA']);

export function bacaProfilWarna(b: Uint8Array): ProfilWarna {
  const format = formatDari(b);
  try {
    if (format === 'jpeg') {
      const { data } = segmenIccJpeg(b);
      if (data.length === 0) return { format, adaProfil: false, nama: null };
      const gabung = new Uint8Array(data.reduce((s, d) => s + d.length, 0));
      let o = 0;
      for (const d of data) {
        gabung.set(d, o);
        o += d.length;
      }
      return { format, adaProfil: true, nama: namaIcc(gabung) };
    }
    if (format === 'png') {
      const iccp = chunkPng(b).find((c) => c.jenis === 'iCCP');
      if (!iccp) return { format, adaProfil: false, nama: null };
      const nol = iccp.data.indexOf(0);
      const nama = String.fromCharCode(...iccp.data.subarray(0, nol < 0 ? 0 : nol)).trim();
      return { format, adaProfil: true, nama: nama || null };
    }
    if (format === 'webp') {
      const iccp = chunkWebp(b).find((c) => c.fourcc === 'ICCP');
      return iccp ? { format, adaProfil: true, nama: namaIcc(iccp.data) } : { format, adaProfil: false, nama: null };
    }
  } catch {
    // Berkas yang tidak terbaca strukturnya diperlakukan sebagai tanpa profil.
  }
  return { format, adaProfil: false, nama: null };
}

function tanpaPotongan(b: Uint8Array, buang: Potongan[]): Uint8Array {
  const hasil = new Uint8Array(b.length - buang.reduce((s, p) => s + (p.akhir - p.mulai), 0));
  let tulis = 0;
  let baca = 0;
  for (const p of [...buang].sort((x, y) => x.mulai - y.mulai)) {
    hasil.set(b.subarray(baca, p.mulai), tulis);
    tulis += p.mulai - baca;
    baca = p.akhir;
  }
  hasil.set(b.subarray(baca), tulis);
  return hasil;
}

/** Berkas yang sama tanpa profil warna. Mengembalikan array yang SAMA kalau tidak ada yang perlu dibuang. */
export function buangProfilWarna(b: Uint8Array): Uint8Array {
  const format = formatDari(b);
  try {
    if (format === 'jpeg') {
      const { segmen } = segmenIccJpeg(b);
      return segmen.length ? tanpaPotongan(b, segmen) : b;
    }
    if (format === 'png') {
      const buang = chunkPng(b).filter((c) => CHUNK_PNG_WARNA.has(c.jenis));
      return buang.length ? tanpaPotongan(b, buang) : b;
    }
    if (format === 'webp') {
      const chunks = chunkWebp(b);
      const iccp = chunks.find((c) => c.fourcc === 'ICCP');
      if (!iccp) return b;
      const hasil = tanpaPotongan(b, [iccp]);
      const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
      // Posisi VP8X tidak bergeser selama ia berada sebelum ICCP, seperti yang diwajibkan spesifikasi.
      if (vp8x && vp8x.mulai < iccp.mulai) hasil[vp8x.mulai + 8] &= ~0x20;
      const ukuranRiff = hasil.length - 8;
      hasil.set([ukuranRiff & 0xff, (ukuranRiff >>> 8) & 0xff, (ukuranRiff >>> 16) & 0xff, (ukuranRiff >>> 24) & 0xff], 4);
      return hasil;
    }
  } catch {
    // Struktur tak terbaca: jangan merusak berkasnya, pakai apa adanya.
  }
  return b;
}
