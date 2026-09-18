import { INDEKS_DASAR, langkahHarmoni, type AturanHarmoni } from '../palet/harmoni';
import { rasioKontras } from '../palet/kontras';
import { deltaE2000, hexKeLab, pantoneKhusus, type Lab, type WarnaPantone } from '../palet/pantone';
import { hexKeHsb, hsbKeHex, putarSudut } from '../palet/warna';
import { AKSEN_POPULER, KROMA_NETRAL } from './aksen';

/**
 * Saran warna sablon untuk sebuah kain.
 *
 * Kain adalah warna dasar harmoni — ia tidak dicetak, tetapi setiap tinta
 * dipilih terhadapnya. Untuk tiap warna sablon dibuat dulu warna IDEAL: rona
 * dari aturan harmoni, terang yang cukup jauh dari kain supaya terbaca. Lalu
 * dipilih Pantone Coated C terdekat dengan warna ideal itu, karena tinta
 * sablon tim dipesan dan dicampur dengan kode C.
 */

export const ATURAN_SABLON = [
  'ANALOGOUS',
  'MONOCHROMATIC',
  'TRIAD',
  'COMPLEMENTARY',
  'SPLIT_COMPLEMENTARY',
  'SQUARE',
  'COMPOUND',
  'SHADES',
] as const satisfies readonly Exclude<AturanHarmoni, 'CUSTOM'>[];

export type AturanSablon = (typeof ATURAN_SABLON)[number];

export const JUMLAH_SABLON_MAKS = 6;

/** Nama tinta di layar, lembar cetak, dan ringkasan untuk tukang sablon. */
export const HURUF_SABLON = 'ABCDEF';

/**
 * Porsi awal di desain, dari yang dominan ke aksen. Tiga warna mengikuti
 * aturan 60–30–10 yang lazim di desain grafis; jumlah lain diturunkan dari
 * semangat yang sama — satu yang memimpin, sisanya mengecil. Ini titik mulai:
 * porsinya bisa diubah di layar.
 */
export const PORSI_AWAL: Record<number, number[]> = {
  1: [100],
  2: [70, 30],
  3: [60, 30, 10],
  4: [50, 25, 15, 10],
  5: [40, 25, 15, 12, 8],
  6: [35, 25, 15, 10, 8, 7],
};

export type PeranSablon = 'DOMINAN' | 'PENDUKUNG' | 'AKSEN';

export function peranUntuk(urutan: number, jumlah: number): PeranSablon {
  if (urutan === 0) return 'DOMINAN';
  if (jumlah >= 3 && urutan === jumlah - 1) return 'AKSEN';
  return 'PENDUKUNG';
}

export type SaranSablon = {
  warna: WarnaPantone;
  porsi: number;
  peran: PeranSablon;
};

/** Terang Lab minimum yang dianggap terbaca sebagai sablon di atas kain. */
const BEDA_TERANG_MIN = 20;
const TERANG_BAWAH = 12;
const TERANG_ATAS = 95;
/** Ruang minimum di satu sisi supaya arah itu layak dipakai. */
const RUANG_MIN = 25;

/** Jarak terang dari kain, bergiliran, saat semua warna harus searah. */
const JARAK_SEARAH = [45, 28, 60, 36, 52, 22];

/**
 * Warna ideal dengan rona dan kepekatan tertentu yang terangnya mendekati `L`.
 * Kalau terang itu tidak tercapai bahkan pada kecerahan penuh (kuning pekat
 * tidak pernah seterang putih), kepekatan diturunkan — terbaca lebih penting
 * daripada pekat.
 */
function capaiTerang(h: number, s: number, L: number): Lab {
  let pekat = s;
  while (pekat > 0.05 && hexKeLab(hsbKeHex({ h, s: pekat, b: 1 }))[0] < L) pekat -= 0.05;
  pekat = Math.max(0, pekat);
  let bawah = 0;
  let atas = 1;
  for (let i = 0; i < 24; i++) {
    const tengah = (bawah + atas) / 2;
    if (hexKeLab(hsbKeHex({ h, s: pekat, b: tengah }))[0] < L) bawah = tengah;
    else atas = tengah;
  }
  return hexKeLab(hsbKeHex({ h, s: pekat, b: (bawah + atas) / 2 }));
}

export function sarankanSablon(input: {
  kainHex: string;
  jumlah: number;
  aturan: AturanSablon;
  katalog: readonly WarnaPantone[];
}): SaranSablon[] {
  const jumlah = Math.min(JUMLAH_SABLON_MAKS, Math.max(1, Math.round(input.jumlah)));
  const kain = hexKeHsb(input.kainHex);
  const [terangKain, aKain, bKain] = hexKeLab(input.kainHex);
  // Kain netral tidak punya rona — HSB menyebutnya 0°, yaitu merah. Rona dasarnya
  // diambil dari aksen pertama galeri komposisi supaya kedua saran sepakat.
  const aksenNetral = input.katalog.find((w) => w.kode === AKSEN_POPULER[0]);
  const ronaKain = Math.hypot(aKain, bKain) < KROMA_NETRAL ? (aksenNetral ? hexKeHsb(aksenNetral.hex).h : 80) : kain.h;

  // Geseran rona dari resep aturan, tanpa warna dasar (itu kainnya sendiri).
  // Rona yang berbeda dari kain didahulukan: "complementary" yang warna
  // pertamanya sewarna kain bukan complementary.
  const geseran = [
    ...new Set(
      (langkahHarmoni(input.aturan) ?? []).filter((_, i) => i !== INDEKS_DASAR).map((l) => l.dh),
    ),
  ].sort((a, b) => Number(a === 0) - Number(b === 0));

  const senada = input.aturan === 'MONOCHROMATIC' || input.aturan === 'SHADES';
  const pekatTarget =
    input.aturan === 'SHADES' ? kain.s : senada ? Math.max(kain.s, 0.3) : Math.min(0.85, Math.max(kain.s, 0.6));

  const ruangGelap = terangKain - TERANG_BAWAH;
  const ruangTerang = TERANG_ATAS - terangKain;
  const duaArah = ruangGelap >= RUANG_MIN && ruangTerang >= RUANG_MIN;
  const arahUtama = ruangGelap >= ruangTerang ? -1 : 1;

  const dipilih: WarnaPantone[] = [];
  for (let k = 0; k < jumlah; k++) {
    const j = k % geseran.length;
    const putaran = Math.floor(k / geseran.length);
    // Dua arah: bergantian, dan putaran berikutnya membalik urutannya supaya
    // rona yang sama muncul sekali gelap dan sekali terang, bukan dua kali gelap.
    const arah = duaArah ? ((j + putaran) % 2 === 0 ? arahUtama : -arahUtama) : arahUtama;
    const jarak = duaArah ? (putaran >= 2 ? 55 : 40) : JARAK_SEARAH[k % JARAK_SEARAH.length];
    const terangTarget = Math.min(TERANG_ATAS, Math.max(TERANG_BAWAH, terangKain + arah * jarak));
    const ideal = capaiTerang(putarSudut(ronaKain + geseran[j]), pekatTarget, terangTarget);

    let terbaik: { warna: WarnaPantone; skor: number } | null = null;
    for (const warna of input.katalog) {
      if (pantoneKhusus(warna.kode)) continue;
      if (dipilih.some((p) => deltaE2000(p.lab, warna.lab) < 10)) continue;
      const beda = warna.lab[0] - terangKain;
      // Tinta harus berada di sisi yang dituju: di kain putih, tinta "sedikit
      // lebih terang" sama saja dengan tidak terlihat.
      if (Math.abs(beda) < BEDA_TERANG_MIN || Math.sign(beda) !== arah) continue;
      const skor = deltaE2000(ideal, warna.lab);
      if (!terbaik || skor < terbaik.skor) terbaik = { warna, skor };
    }
    if (terbaik) dipilih.push(terbaik.warna);
  }

  const urut = dipilih
    .map((warna) => ({ warna, kontras: rasioKontras(warna.hex, input.kainHex) }))
    .sort((a, b) => b.kontras - a.kontras);
  const porsi = PORSI_AWAL[urut.length] ?? [];
  return urut.map((x, i) => ({ warna: x.warna, porsi: porsi[i], peran: peranUntuk(i, urut.length) }));
}

export type KeterbacaanSablon = 'KUAT' | 'CUKUP' | 'LEMBUT' | 'SAMAR';

/**
 * Keterbacaan tinta di atas kain, dari rasio kontras.
 *
 * Sengaja BUKAN label WCAG. Ambang WCAG dibuat untuk teks di layar; di sana
 * 1,9 berarti "gagal". Sablon terang di kain bernada tengah dengan rasio 1,9
 * adalah desain tone-on-tone yang sah, dan menyebutnya "gagal" membuat orang
 * membuang pilihan yang baik.
 */
export function keterbacaanSablon(rasio: number): KeterbacaanSablon {
  if (rasio >= 4.5) return 'KUAT';
  if (rasio >= 3) return 'CUKUP';
  if (rasio >= 1.8) return 'LEMBUT';
  return 'SAMAR';
}
