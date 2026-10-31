import { porsiDariBagian } from '../palet/gambar';
import { deltaE2000, hexKeLab, pantoneKhusus, type Lab, type WarnaPantone } from '../palet/pantone';
import { normalisasiHex } from '../palet/warna';
import { KROMA_NETRAL } from './aksen';

/**
 * Komposisi warna desain yang diunggah: kain dan tintanya dibaca dari warna
 * dominan gambar (`bacaKomposisiDesain`), lalu desain itu disusun ulang di kain
 * lain atau dengan aksen lain (`variasiDesain`). Tiap tinta dibulatkan ke
 * Pantone C biasa terdekat yang masih memenuhi syarat terbaca perannya.
 *
 * Galeri rekomendasi komposisi yang dulu ada di sini dihapus atas permintaan
 * pemilik pada 2026-09-21.
 */

/** Peran tinta dalam desain: aksen berwarna, netral (hitam, putih, krem, abu), atau tone-on-tone. */
export type PeranKomposisi = 'AKSEN' | 'NETRAL' | 'NADA';

export type TintaKomposisi = {
  hex: string;
  /** Kode Pantone C tinta ini. */
  kode: string | null;
  peran: PeranKomposisi;
  porsi: number;
};

export type Komposisi = { id: string; tinta: TintaKomposisi[] };

const TERANG_BAWAH = 12;
const TERANG_ATAS = 95;
const BEDA_TERBACA = 20;
const JARAK_ANTARTINTA = 8;

type Lch = [number, number, number];

function keLch([L, a, b]: Lab): Lch {
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

function dariLch([L, C, h]: Lch): Lab {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

const batasTerang = (L: number) => Math.min(TERANG_ATAS, Math.max(TERANG_BAWAH, L));
const ruang = (Lk: number, arah: number) => (arah > 0 ? TERANG_ATAS - Lk : Lk - TERANG_BAWAH);

/** Syarat beda terang tiap peran terhadap kain: [minimum, maksimum]. */
const SYARAT: Record<PeranKomposisi, [number, number]> = {
  AKSEN: [BEDA_TERBACA, 100],
  NETRAL: [BEDA_TERBACA, 100],
  // Tone-on-tone sengaja nyaris menyatu dengan kain, tetapi tetap harus ada.
  NADA: [5, 28],
};

type Konteks = { katalog: readonly WarnaPantone[]; Lk: number; labKain: Lab };

/** Pantone C biasa (bukan metalik/neon) terdekat ke `target` yang memenuhi syarat perannya dan tidak kembar dengan tinta lain. */
function bulatkan(ktx: Konteks, target: Lab, peran: PeranKomposisi, arah: number, hindari: readonly Lab[], minKhusus?: number): WarnaPantone | null {
  const [minPeran, maks] = SYARAT[peran];
  const min = minKhusus ?? minPeran;
  let terbaik: WarnaPantone | null = null;
  let skorTerbaik = Infinity;
  for (const w of ktx.katalog) {
    if (pantoneKhusus(w.kode)) continue;
    const beda = w.lab[0] - ktx.Lk;
    if (Math.sign(beda) !== arah || Math.abs(beda) < min || Math.abs(beda) > maks) continue;
    if (hindari.some((h) => deltaE2000(h, w.lab) < JARAK_ANTARTINTA)) continue;
    const skor = deltaE2000(target, w.lab);
    if (skor < skorTerbaik) {
      skorTerbaik = skor;
      terbaik = w;
    }
  }
  return terbaik;
}

/** Rencana satu tinta: warna sasaran dan perannya. */
type Rencana = { peran: PeranKomposisi; porsi: number; sasaran: Lab; minBeda?: number };

function wujudkan(ktx: Konteks, rencana: readonly Rencana[], arah: number): Komposisi | null {
  const urut = [...rencana].sort((a, b) => b.porsi - a.porsi);
  const dipakai: Lab[] = [];
  const tinta: TintaKomposisi[] = [];
  for (const r of urut) {
    const arahTinta = Math.sign(r.sasaran[0] - ktx.Lk) || arah;
    const w = bulatkan(ktx, r.sasaran, r.peran, arahTinta, dipakai, r.minBeda);
    if (!w) return null;
    dipakai.push(w.lab);
    tinta.push({ hex: w.hex, kode: w.kode, peran: r.peran, porsi: r.porsi });
  }
  return { id: tinta.map((t) => t.hex).join('-'), tinta };
}

/** Arah tinta yang terbaca: kain gelap → tinta terang, kain terang → tinta gelap. */
function arahUtama(Lk: number): number {
  return ruang(Lk, 1) >= ruang(Lk, -1) ? 1 : -1;
}

export type TintaDesain = { hex: string; peran: PeranKomposisi; bagian: number; porsi: number };
export type AnalisisDesain = { kain: { hex: string; bagian: number }; tinta: TintaDesain[] };

/**
 * Peran satu warna desain terhadap kainnya. Hitam dan putih selalu netral,
 * sedekat apa pun dengan kain — garis putih di kaos krem tetap "putih", dan
 * harus kembali putih (bukan tone-on-tone gelap) saat desainnya dipindah.
 */
function peranTerhadap(ref: Lch, [L, C]: Lch): PeranKomposisi {
  if (C < 8 && (L > 85 || L < 22)) return 'NETRAL';
  if (Math.abs(L - ref[0]) < 28 && C < 25) return 'NADA';
  return C < 15 ? 'NETRAL' : 'AKSEN';
}

const TEPIAN_MAKS = 0.03;
const REMAH = 0.01;

/**
 * `x` terletak pada garis lurus kain→`y` di Lab, tidak di dekat kain. Batas 0.2
 * memisahkan tepian dari tone-on-tone: pada desain krem nyata, tepian menuju
 * hitam jatuh di 0.24–0.73, tinta tone-on-tone-nya di 0.13–0.16.
 */
function diAntara(kain: Lab, x: Lab, y: Lab): boolean {
  const v = [y[0] - kain[0], y[1] - kain[1], y[2] - kain[2]];
  const w = [x[0] - kain[0], x[1] - kain[1], x[2] - kain[2]];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (vv === 0) return false;
  const t = (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / vv;
  return t >= 0.2 && t <= 1 && Math.hypot(w[0] - t * v[0], w[1] - t * v[1], w[2] - t * v[2]) <= 6;
}

/**
 * Piksel di pinggir huruf dan garis adalah campuran kain dan tintanya. Pada
 * desain kecil jumlahnya bisa melebihi tinta itu sendiri: teks hitam yang tipis
 * terbaca sebagai beberapa abu-abu kecil dan hitamnya sendiri jatuh di bawah
 * batas remah. Warna kecil yang terletak di antara kain dan tinta yang lebih
 * jauh digabung ke tinta itu. Tone-on-tone tidak ikut tergabung: ia dekat kain,
 * bukan di tengah jalan menuju hitam.
 */
function gabungTepian(kain: string, warna: readonly { hex: string; bagian: number }[]) {
  const labKain = hexKeLab(kain);
  const urut = warna
    .map((w) => ({ ...w, lab: hexKeLab(w.hex) }))
    .map((w) => ({ ...w, jarak: Math.hypot(w.lab[0] - labKain[0], w.lab[1] - labKain[1], w.lab[2] - labKain[2]) }))
    .sort((a, b) => b.jarak - a.jarak);
  const tinta: { hex: string; bagian: number; lab: Lab }[] = [];
  for (const w of urut) {
    const ujung = w.bagian <= TEPIAN_MAKS ? tinta.find((t) => diAntara(labKain, w.lab, t.lab)) : undefined;
    if (ujung) ujung.bagian += w.bagian;
    else tinta.push({ hex: w.hex, bagian: w.bagian, lab: w.lab });
  }
  return tinta.map(({ hex, bagian }) => ({ hex, bagian }));
}

/**
 * Komposisi sebuah desain dari warna dominannya: warna terluas dianggap kain,
 * sisanya tinta beserta peran dan porsinya. Warna tepian digabung ke tintanya
 * dulu, baru remah di bawah 1% diabaikan.
 */
export function bacaKomposisiDesain(gambar: readonly { hex: string; bagian: number }[], jumlah = 6): AnalisisDesain | null {
  const semua = gambar
    .flatMap((w) => {
      const hex = normalisasiHex(w.hex);
      return hex && w.bagian > 0 ? [{ hex, bagian: w.bagian }] : [];
    })
    .sort((a, b) => b.bagian - a.bagian);
  if (semua.length < 2) return null;
  const [latar, ...lainnya] = semua;
  const sisa = gabungTepian(latar.hex, lainnya)
    .filter((w) => w.bagian >= REMAH)
    .sort((a, b) => b.bagian - a.bagian);
  if (sisa.length === 0) return null;
  const ref = keLch(hexKeLab(latar.hex));
  const dipakai = sisa.slice(0, Math.min(6, Math.max(1, Math.round(jumlah))));
  const porsi = porsiDariBagian(dipakai.map((t) => t.bagian));
  return {
    kain: latar,
    tinta: dipakai.map((t, i) => ({ hex: t.hex, peran: peranTerhadap(ref, keLch(hexKeLab(t.hex))), bagian: t.bagian, porsi: porsi[i] })),
  };
}

/**
 * Desain yang sama di kain lain — dan, dengan `aksenBaru`, dengan aksen lain.
 *
 * Tiap tinta mempertahankan peran, porsi, dan hubungan terangnya dengan kain:
 * tinta yang lebih terang dari kain tetap lebih terang selama kain baru memberi
 * ruang, dan berbalik kalau tidak — teks hitam di kaos krem menjadi teks terang
 * di kaos hitam. Hitam dan putih tetap hitam dan putih kalau masih terbaca.
 * Aksen baru mengganti rona dan kepekatan semua aksen dengan geseran yang sama,
 * jadi hubungan antaraksen tetap; tinta lain tidak tersentuh.
 */
export function variasiDesain(input: {
  analisis: AnalisisDesain;
  kainHex: string;
  katalog: readonly WarnaPantone[];
  aksenBaru?: string | null;
}): Komposisi | null {
  const { analisis } = input;
  const ref = keLch(hexKeLab(analisis.kain.hex));
  const kainHex = normalisasiHex(input.kainHex) ?? '#000000';
  const labKain = hexKeLab(kainHex);
  const kain = keLch(labKain);
  const [Lk, Ck, hk] = kain;
  const ktx: Konteks = { katalog: input.katalog, Lk, labKain };
  // Rona aksen ikut berputar bersama kain hanya kalau KEDUA kain jelas berwarna;
  // krem atau abu-abu hampir tanpa rona, dan memutar terhadapnya mengacak aksen.
  const berputar = ref[1] >= 15 && Ck >= 15;

  const aksenPertama = analisis.tinta.find((t) => t.peran === 'AKSEN');
  const baru = input.aksenBaru ? normalisasiHex(input.aksenBaru) : null;
  const geserAksen =
    baru && aksenPertama
      ? (() => {
          const a = keLch(hexKeLab(aksenPertama.hex));
          const b = keLch(hexKeLab(baru));
          return { dh: b[2] - a[2], faktorC: a[1] > 1 ? b[1] / a[1] : 1 };
        })()
      : null;

  const rencana: Rencana[] = analisis.tinta.map((t) => {
    const [L, C, h] = keLch(hexKeLab(t.hex));
    const peran = t.peran;
    // Hitam dan putih: tetap di tempatnya kalau masih terbaca di kain baru, berbalik kalau tidak.
    if (peran === 'NETRAL' && C < 8 && (L > 85 || L < 22)) {
      const terang = L > 85;
      const tetap = terang ? TERANG_ATAS - Lk >= 12 : Lk - 15 >= 12;
      const Lbaru = terang === tetap ? Math.max(L, 90) : Math.min(L, 18);
      return { peran, porsi: t.porsi, sasaran: dariLch([Lbaru, C, h]), minBeda: 10 };
    }
    const dL = L - ref[0];
    const arahRef = Math.sign(dL) || 1;
    const bagianRuang = Math.abs(dL) / Math.max(1, ruang(ref[0], arahRef));
    // Arah dipertahankan selama kain baru masih memberi ruang untuk peran itu; kalau tidak, dibalik.
    const ruangPerlu = peran === 'NADA' ? 8 : peran === 'NETRAL' ? 25 : 35;
    const arah = ruang(Lk, arahRef) >= ruangPerlu ? arahRef : -arahRef;
    const beda =
      peran === 'NADA' ? Math.min(26, Math.max(6, Math.abs(dL))) : Math.max(peran === 'AKSEN' ? 25 : 22, bagianRuang * ruang(Lk, arah));
    // Tone-on-tone di kain berwarna mengikuti rona kain itu sendiri — itulah artinya "senada".
    const nadaBerona = peran === 'NADA' && Ck >= KROMA_NETRAL;
    let rona = nadaBerona ? hk : berputar ? (h + hk - ref[2] + 360) % 360 : h;
    let kroma = nadaBerona ? Math.max(6, Ck * 0.9) : peran === 'NADA' ? Math.min(C, 12) : C;
    if (peran === 'AKSEN' && geserAksen) {
      rona = (h + geserAksen.dh + 360) % 360;
      kroma = C * geserAksen.faktorC;
    }
    return { peran, porsi: t.porsi, sasaran: dariLch([batasTerang(Lk + arah * beda), kroma, rona]) };
  });

  const k = wujudkan(ktx, rencana, arahUtama(Lk));
  return k ? { ...k, id: `${kainHex}:${baru ?? '-'}:${k.id}` } : null;
}
