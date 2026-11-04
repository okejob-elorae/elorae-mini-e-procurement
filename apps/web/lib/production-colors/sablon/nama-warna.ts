import { normalisasiHex } from '../palet/warna';

/**
 * Kamus nama warna varian yang lazim di marketplace Indonesia — nama yang
 * ditulis toko di Shopee/TikTok dan dipilih pembeli ("Hitam", "Army", "Mocca",
 * "Broken White"). Nilai hex-nya perkiraan warna yang umumnya dimaksud, bukan
 * standar: satu toko bisa menyebut "mocca" untuk warna yang sedikit berbeda.
 * Nama yang tidak ada di sini dipetakan sendiri oleh tim, sekali, lalu diingat.
 *
 * `keluarga` mengelompokkan warna untuk preset tren lokal saat data penjualan
 * belum ada.
 */
export type KeluargaWarnaLokal = 'NETRAL' | 'EARTH' | 'PASTEL' | 'CERAH';

export type EntriWarna = { kunci: string; label: string; hex: string; keluarga: KeluargaWarnaLokal; alias: readonly string[] };

export const KAMUS_WARNA: readonly EntriWarna[] = [
  // Netral
  { kunci: 'hitam', label: 'Hitam', hex: '#1b1b1c', keluarga: 'NETRAL', alias: ['hitam', 'black', 'blk', 'item', 'jet black'] },
  { kunci: 'putih', label: 'Putih', hex: '#f4f4f1', keluarga: 'NETRAL', alias: ['putih', 'white', 'wht', 'ptih'] },
  { kunci: 'broken-white', label: 'Broken white', hex: '#efe9dc', keluarga: 'NETRAL', alias: ['broken white', 'brokenwhite', 'bw', 'off white', 'offwhite', 'putih tulang', 'ivory', 'gading'] },
  { kunci: 'cream', label: 'Cream', hex: '#e8dcc2', keluarga: 'NETRAL', alias: ['cream', 'krem', 'creme'] },
  { kunci: 'abu-misty', label: 'Abu misty', hex: '#c9ccce', keluarga: 'NETRAL', alias: ['abu misty', 'misty', 'misty grey', 'abu muda', 'light grey', 'light gray', 'silver'] },
  { kunci: 'abu', label: 'Abu-abu', hex: '#8e9094', keluarga: 'NETRAL', alias: ['abu', 'abu abu', 'grey', 'gray', 'gry'] },
  { kunci: 'abu-tua', label: 'Abu tua', hex: '#4d4f53', keluarga: 'NETRAL', alias: ['abu tua', 'dark grey', 'dark gray', 'charcoal', 'anthracite'] },
  { kunci: 'navy', label: 'Navy', hex: '#232c43', keluarga: 'NETRAL', alias: ['navy', 'nvy', 'dongker', 'biru dongker', 'biru navy', 'navy blue'] },
  { kunci: 'maroon', label: 'Maroon', hex: '#6b2230', keluarga: 'NETRAL', alias: ['maroon', 'marun', 'merah maroon', 'merah marun', 'burgundy', 'wine'] },
  // Earth tone
  { kunci: 'mocca', label: 'Mocca', hex: '#9b7b62', keluarga: 'EARTH', alias: ['mocca', 'mocha', 'moka', 'mokka'] },
  { kunci: 'milo', label: 'Milo', hex: '#a58a6d', keluarga: 'EARTH', alias: ['milo'] },
  { kunci: 'coksu', label: 'Coklat susu', hex: '#b89479', keluarga: 'EARTH', alias: ['coksu', 'coklat susu', 'cokelat susu', 'coklat muda', 'latte'] },
  { kunci: 'coklat', label: 'Coklat', hex: '#5e4332', keluarga: 'EARTH', alias: ['coklat', 'cokelat', 'brown', 'coklat tua', 'dark brown', 'choco', 'chocolate'] },
  { kunci: 'khaki', label: 'Khaki', hex: '#b9a57f', keluarga: 'EARTH', alias: ['khaki', 'kaki'] },
  { kunci: 'camel', label: 'Camel', hex: '#b38a58', keluarga: 'EARTH', alias: ['camel', 'caramel', 'karamel'] },
  { kunci: 'army', label: 'Army', hex: '#535a3c', keluarga: 'EARTH', alias: ['army', 'hijau army', 'olive drab'] },
  { kunci: 'olive', label: 'Olive', hex: '#6f6f3c', keluarga: 'EARTH', alias: ['olive', 'zaitun', 'hijau olive', 'hijau zaitun'] },
  { kunci: 'sage', label: 'Sage', hex: '#a4ae94', keluarga: 'EARTH', alias: ['sage', 'hijau sage', 'sage green'] },
  { kunci: 'terracotta', label: 'Terracotta', hex: '#b0573a', keluarga: 'EARTH', alias: ['terracotta', 'terakota', 'bata', 'merah bata', 'rust'] },
  { kunci: 'mustard', label: 'Mustard', hex: '#d0a13a', keluarga: 'EARTH', alias: ['mustard', 'kuning mustard', 'kunyit'] },
  { kunci: 'taupe', label: 'Taupe', hex: '#8f8074', keluarga: 'EARTH', alias: ['taupe', 'stone', 'abu coklat'] },
  { kunci: 'nude', label: 'Nude', hex: '#d7b8a1', keluarga: 'EARTH', alias: ['nude', 'beige', 'almond', 'skin'] },
  // Pastel & dusty
  { kunci: 'dusty-pink', label: 'Dusty pink', hex: '#d2a3a0', keluarga: 'PASTEL', alias: ['dusty pink', 'dusty', 'pink dusty', 'dusty rose'] },
  { kunci: 'salem', label: 'Salem', hex: '#f0a38c', keluarga: 'PASTEL', alias: ['salem', 'salmon', 'peach', 'persik'] },
  { kunci: 'lilac', label: 'Lilac', hex: '#c3aed1', keluarga: 'PASTEL', alias: ['lilac', 'lilak', 'lavender', 'lavendel', 'ungu muda'] },
  { kunci: 'baby-blue', label: 'Baby blue', hex: '#a9c7e2', keluarga: 'PASTEL', alias: ['baby blue', 'biru muda', 'sky blue', 'light blue', 'biru langit'] },
  { kunci: 'mint', label: 'Mint', hex: '#b4dcc5', keluarga: 'PASTEL', alias: ['mint', 'hijau mint', 'mint green'] },
  { kunci: 'butter', label: 'Butter', hex: '#f1e1a1', keluarga: 'PASTEL', alias: ['butter', 'kuning pastel', 'kuning muda', 'lemon'] },
  { kunci: 'baby-pink', label: 'Baby pink', hex: '#f3c6cf', keluarga: 'PASTEL', alias: ['baby pink', 'pink muda', 'soft pink', 'pink pastel'] },
  // Cerah
  { kunci: 'merah', label: 'Merah', hex: '#c8102e', keluarga: 'CERAH', alias: ['merah', 'red'] },
  { kunci: 'kuning', label: 'Kuning', hex: '#f6c700', keluarga: 'CERAH', alias: ['kuning', 'yellow'] },
  { kunci: 'oranye', label: 'Oranye', hex: '#f36f21', keluarga: 'CERAH', alias: ['oranye', 'orange', 'oren', 'jingga'] },
  { kunci: 'hijau', label: 'Hijau', hex: '#2e8b57', keluarga: 'CERAH', alias: ['hijau', 'green'] },
  { kunci: 'hijau-botol', label: 'Hijau botol', hex: '#1e4d3a', keluarga: 'CERAH', alias: ['hijau botol', 'bottle green', 'emerald', 'hijau emerald', 'hijau tua', 'forest'] },
  { kunci: 'tosca', label: 'Tosca', hex: '#1f9e96', keluarga: 'CERAH', alias: ['tosca', 'toska', 'turquoise', 'teal', 'hijau tosca'] },
  { kunci: 'biru', label: 'Biru', hex: '#2956a8', keluarga: 'CERAH', alias: ['biru', 'blue', 'royal blue', 'benhur', 'biru benhur'] },
  { kunci: 'denim', label: 'Denim', hex: '#4b6a8b', keluarga: 'CERAH', alias: ['denim', 'biru denim', 'jeans'] },
  { kunci: 'petrol', label: 'Petrol', hex: '#1f4f5c', keluarga: 'CERAH', alias: ['petrol', 'biru petrol'] },
  { kunci: 'ungu', label: 'Ungu', hex: '#5d3a7e', keluarga: 'CERAH', alias: ['ungu', 'purple', 'violet', 'terong'] },
  { kunci: 'fuschia', label: 'Fuschia', hex: '#c42d79', keluarga: 'CERAH', alias: ['fuschia', 'fuchsia', 'fanta', 'magenta', 'pink fanta'] },
  { kunci: 'pink', label: 'Pink', hex: '#e882a8', keluarga: 'CERAH', alias: ['pink', 'merah muda'] },
];

/** Kata yang sering menempel di nama varian tetapi bukan warna. */
const KATA_SAMPAH = new Set(['warna', 'color', 'colour', 'kaos', 'tshirt', 'baju', 'polos', 'basic', 'premium', 'new']);

/** Huruf kecil, tanpa tanda baca, spasi tunggal, tanpa kata sampah — kunci pencocokan dan pemetaan manual. */
export function rapikanNama(nama: string): string {
  return nama
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((k) => k && !KATA_SAMPAH.has(k))
    .join(' ');
}

const ALIAS: { alias: string; entri: EntriWarna }[] = KAMUS_WARNA.flatMap((entri) => entri.alias.map((a) => ({ alias: rapikanNama(a), entri })))
  // Frasa terpanjang dicoba lebih dulu: "abu tua" harus menang atas "abu".
  .sort((a, b) => b.alias.length - a.alias.length);

export type WarnaDikenal = { kunci: string; label: string; hex: string; keluarga: KeluargaWarnaLokal | null };

/**
 * Mengenali nama warna varian. Pemetaan manual (kunci = `rapikanNama`) menang
 * atas kamus; di kamus, frasa terpanjang yang muncul utuh sebagai kata menang.
 */
export function kenaliWarna(nama: string | null | undefined, manual: Readonly<Record<string, string>> = {}): WarnaDikenal | null {
  if (!nama) return null;
  const rapi = rapikanNama(nama);
  if (!rapi) return null;
  const hexManual = manual[rapi] ? normalisasiHex(manual[rapi]) : null;
  if (hexManual) return { kunci: `manual:${rapi}`, label: nama, hex: hexManual, keluarga: null };
  const kata = ` ${rapi} `;
  for (const { alias, entri } of ALIAS) {
    if (kata.includes(` ${alias} `) || rapi === alias.replace(/ /g, '')) {
      return { kunci: entri.kunci, label: entri.label, hex: entri.hex, keluarga: entri.keluarga };
    }
  }
  return null;
}
