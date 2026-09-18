import { porsiDariBagian } from '../palet/gambar';
import { deltaE2000, hexKeLab, type Lab, type WarnaPantone } from '../palet/pantone';
import { normalisasiHex } from '../palet/warna';
import { AKSEN_POPULER, KROMA_NETRAL } from './aksen';
import { PORSI_AWAL } from './saran';

/**
 * Rekomendasi komposisi warna sablon — pola yang dipakai desain kaos
 * sungguhan, bukan sekadar sudut di roda.
 *
 * Aturan harmoni saja tidak cukup untuk kaos: ia hanya memilih RONA. Desain
 * kaos disusun dari PERAN — satu aksen yang mencolok, satu netral (krem, putih
 * tulang, arang) yang membawa teks, dan sering satu tinta tone-on-tone yang
 * sengaja nyaris menyatu dengan kain. Mesin ini menyusun peran-peran itu
 * terhadap kain, lalu membulatkan tiap tinta ke Pantone C terdekat yang masih
 * memenuhi syarat terbaca perannya.
 */

/**
 * Keluarga komposisi. Isinya bergantung pada jumlah tinta — KLASIK tiga tinta
 * adalah netral + aksen + tone-on-tone, empat tinta menambah aksen kedua — jadi
 * judul kartu disusun dari peran tintanya, bukan dari nama keluarga.
 */
export type PolaKomposisi = 'SATU' | 'KLASIK' | 'DUA_AKSEN' | 'KONTRAS' | 'AKSEN_NADA' | 'TONAL' | 'DARI_GAMBAR';

/** `AKSEN_TUA` adalah aksen yang sama, lebih gelap dan kalem — zaitun di samping lime. */
export type PeranKomposisi = 'AKSEN' | 'AKSEN_2' | 'AKSEN_3' | 'AKSEN_TUA' | 'NETRAL' | 'NADA' | 'TONAL';

/**
 * Cerah: aksen sepekat Pantone-nya, netral krem terang. Redam: semuanya
 * diturunkan kepekatannya — gaya vintage/streetwear, seperti lime kalem di
 * atas slate gelap dengan putih tulang keabuan.
 */
export type GayaKomposisi = 'CERAH' | 'REDAM';

export type TintaKomposisi = {
  hex: string;
  /** Kode Pantone C bila tintanya persis satu warna katalog. */
  kode: string | null;
  peran: PeranKomposisi;
  porsi: number;
  /** Warna yang dikunci pengguna — dipakai apa adanya, tidak dibulatkan. */
  dikunci?: boolean;
};

/** `gaya` kosong untuk komposisi dari gambar referensi — gayanya milik gambar itu. */
export type Komposisi = { id: string; pola: PolaKomposisi; gaya: GayaKomposisi | null; tinta: TintaKomposisi[] };

export { AKSEN_POPULER, KROMA_NETRAL };
const TERANG_BAWAH = 12;
const TERANG_ATAS = 95;
const BEDA_TERBACA = 20;
const JARAK_ANTARTINTA = 8;
const DE_PERSIS = 0.05;

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
  AKSEN_2: [BEDA_TERBACA, 100],
  AKSEN_3: [BEDA_TERBACA, 100],
  AKSEN_TUA: [BEDA_TERBACA, 100],
  NETRAL: [BEDA_TERBACA, 100],
  // Tone-on-tone sengaja nyaris menyatu dengan kain, tetapi tetap harus ada.
  NADA: [5, 28],
  TONAL: [12, 100],
};

type Konteks = { katalog: readonly WarnaPantone[]; Lk: number; labKain: Lab };

/** Pantone C terdekat ke `target` yang memenuhi syarat perannya dan tidak kembar dengan tinta lain. */
function bulatkan(ktx: Konteks, target: Lab, peran: PeranKomposisi, arah: number, hindari: readonly Lab[], minKhusus?: number): WarnaPantone | null {
  const [minPeran, maks] = SYARAT[peran];
  const min = minKhusus ?? minPeran;
  let terbaik: WarnaPantone | null = null;
  let skorTerbaik = Infinity;
  for (const w of ktx.katalog) {
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

function kodePersis(katalog: readonly WarnaPantone[], hex: string): string | null {
  const lab = hexKeLab(hex);
  for (const w of katalog) if (deltaE2000(lab, w.lab) < DE_PERSIS) return w.kode;
  return null;
}

/** Rencana satu tinta: warna sasaran dan perannya, atau warna terkunci yang dipakai apa adanya. */
type Rencana =
  | { peran: PeranKomposisi; porsi: number; sasaran: Lab; minBeda?: number }
  | { peran: PeranKomposisi; porsi: number; kunci: string };

function wujudkan(ktx: Konteks, pola: PolaKomposisi, gaya: GayaKomposisi | null, rencana: readonly Rencana[], arah: number): Komposisi | null {
  const urut = [...rencana].sort((a, b) => b.porsi - a.porsi);
  const dipakai: Lab[] = urut.flatMap((r) => ('kunci' in r ? [hexKeLab(r.kunci)] : []));
  const tinta: TintaKomposisi[] = [];
  for (const r of urut) {
    if ('kunci' in r) {
      tinta.push({ hex: r.kunci, kode: kodePersis(ktx.katalog, r.kunci), peran: r.peran, porsi: r.porsi, dikunci: true });
      continue;
    }
    const arahTinta = Math.sign(r.sasaran[0] - ktx.Lk) || arah;
    const w = bulatkan(ktx, r.sasaran, r.peran, arahTinta, dipakai, r.minBeda);
    if (!w) return null;
    dipakai.push(w.lab);
    tinta.push({ hex: w.hex, kode: w.kode, peran: r.peran, porsi: r.porsi });
  }
  return { id: `${pola}:${gaya ?? '-'}:${tinta.map((t) => t.hex).join('-')}`, pola, gaya, tinta };
}

/** Arah tinta yang terbaca: kain gelap → tinta terang, kain terang → tinta gelap. */
function arahUtama(Lk: number): number {
  return ruang(Lk, 1) >= ruang(Lk, -1) ? 1 : -1;
}

/** Aksen dengan terang yang cukup jauh dari kain, kepekatan dan ronanya dipertahankan. */
function sasaranAksen(aksen: Lch, Lk: number, arah: number): Lab {
  const [L, C, h] = aksen;
  const cukup = Math.sign(L - Lk) === arah && Math.abs(L - Lk) >= BEDA_TERBACA + 5;
  return dariLch([cukup ? L : batasTerang(Lk + arah * 40), C, h]);
}

/**
 * Netral: krem hangat untuk aksen hangat, putih/arang dingin untuk aksen
 * dingin. Versi redam lebih keabuan dan tidak seterang itu — putih tulang,
 * bukan putih kertas.
 */
function sasaranNetral(aksen: Lch | null, arah: number, gaya: GayaKomposisi): Lab {
  const h = aksen ? aksen[2] : 60;
  const hangat = aksen === null || h < 120 || h >= 330;
  if (gaya === 'REDAM') {
    if (arah > 0) return hangat ? [85, 0, 6] : [86, -1, -3];
    return hangat ? [30, 1, 5] : [28, 0, -3];
  }
  if (arah > 0) return hangat ? [91, 1, 9] : [95, -1, -2];
  return hangat ? [24, 2, 6] : [22, 0, -3];
}

/** Tone-on-tone: sedikit lebih terang/gelap dari kain. Kain netral mendapat slate dingin, seperti angka di desain streetwear. */
function sasaranNada(kain: Lch, arah: number, gaya: GayaKomposisi): Lab {
  const [Lk, Ck, hk] = kain;
  if (gaya === 'REDAM') {
    return Ck < KROMA_NETRAL ? dariLch([batasTerang(Lk + arah * 20), 6, 250]) : dariLch([batasTerang(Lk + arah * 16), Math.max(5, Ck * 0.6), hk]);
  }
  return Ck < KROMA_NETRAL ? dariLch([batasTerang(Lk + arah * 16), 10, 250]) : dariLch([batasTerang(Lk + arah * 14), Math.max(6, Ck * 0.9), hk]);
}

/** Aksen redam: kepekatan dipangkas dan sedikit lebih gelap — lime menyala menjadi lime kalem. */
function redamkan([L, C, h]: Lch): Lch {
  return [L * 0.86, C * 0.7, h];
}

/** PRNG kecil berbenih (LCG) — acak lagi harus bisa diulang untuk benih yang sama. */
function acakBerbenih(benih: number) {
  let s = (benih * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function geserRona(aksen: Lch, derajat: number): Lch {
  return [aksen[0], aksen[1], (aksen[2] + derajat + 360) % 360];
}

/** Satu tinta dalam resep keluarga komposisi, sebelum porsinya diberikan. */
type Bagian = { peran: PeranKomposisi; sasaran: Lab } | { peran: PeranKomposisi; kunci: string };

/**
 * Galeri komposisi siap pakai untuk satu kain, masing-masing tepat `jumlah`
 * tinta dengan porsi awal yang sama seperti kartu Warna sablon. Dengan
 * `kunciHex`, warna itu ada di setiap komposisi: sebagai aksen kalau
 * berpigmen, sebagai netral kalau tidak — dan sisanya disusun mengelilinginya.
 */
export function galeriKomposisi(input: {
  kainHex: string;
  katalog: readonly WarnaPantone[];
  kunciHex?: string | null;
  jumlah?: number;
  /** Tanpa gaya (atau `SEMUA`), galeri memuat keduanya berselang-seling. */
  gaya?: GayaKomposisi | 'SEMUA';
  /**
   * Sumber warna aksen (hex), misalnya warna yang laris di toko atau preset tren
   * lokal. Tanpa ini: aksen populer untuk kain netral, rona turunan untuk kain berwarna.
   */
  aksen?: readonly string[];
  /** Benih "acak lagi": 0 atau kosong = susunan tetap; angka lain = urutan dan nuansa aksen lain. */
  acak?: number;
}): Komposisi[] {
  const n = Math.min(6, Math.max(1, Math.round(input.jumlah ?? 3)));
  const gayaDiminta = input.gaya ?? 'SEMUA';
  const porsi = PORSI_AWAL[n];
  const kainHex = normalisasiHex(input.kainHex) ?? '#000000';
  const labKain = hexKeLab(kainHex);
  const kain = keLch(labKain);
  const [Lk, Ck, hk] = kain;
  const ktx: Konteks = { katalog: input.katalog, Lk, labKain };
  const arah = arahUtama(Lk);

  const kunci = input.kunciHex ? normalisasiHex(input.kunciHex) : null;
  const kunciLch = kunci ? keLch(hexKeLab(kunci)) : null;
  const kunciAksen = kunci && kunciLch && kunciLch[1] >= 15 ? kunci : null;
  const kunciNetral = kunci && !kunciAksen ? kunci : null;

  // Daftar aksen: dari katalog populer untuk kain netral, dari rona kain untuk kain berwarna.
  const bawaan: Lch[] =
    Ck < KROMA_NETRAL
      ? AKSEN_POPULER.flatMap((kode) => {
          const w = input.katalog.find((x) => x.kode === kode);
          return w ? [keLch(w.lab)] : [];
        })
      : [180, 150, 210, 120, 240, 30].map((d): Lch => [batasTerang(Lk + arah * 40), 55, (hk + d) % 360]);
  /*
   * Sumber luar (warna laris, tren lokal) didahulukan. Yang terlalu kelabu untuk
   * jadi aksen, atau sewarna dengan kainnya sendiri — kaos army dengan tinta
   * army — dilewati; kalau sisanya kurang dari tiga, bawaan menambal.
   */
  const dariSumber: Lch[] = (input.aksen ?? []).flatMap((hex) => {
    const bersih = normalisasiHex(hex);
    if (!bersih) return [];
    const lab = hexKeLab(bersih);
    const lch = keLch(lab);
    return lch[1] >= 8 && deltaE2000(lab, labKain) >= 15 ? [lch] : [];
  });
  let daftarAksen: Lch[] = dariSumber.length >= 3 ? dariSumber : [...dariSumber, ...bawaan];
  if (input.acak) {
    // Acak berbenih: urutan diaduk, rona digeser sampai ±12° dan kepekatan 85–115%.
    const acak = acakBerbenih(input.acak);
    daftarAksen = daftarAksen
      .map((a) => ({ a, k: acak() }))
      .sort((x, y) => x.k - y.k)
      .map(({ a }): Lch => [a[0], a[1] * (0.85 + acak() * 0.3), (a[2] + (acak() - 0.5) * 24 + 360) % 360]);
  }

  /*
   * Kain bernada sedang (cukup ruang ke terang maupun ke gelap): netral dibuat
   * berlawanan arah dengan aksen — krem terang bersama aksen gelap. Kalau
   * searah, seluruh galeri jadi gelap semua dan tidak ada pilihan nyata.
   */
  const kainSedang = ruang(Lk, 1) >= 25 && ruang(Lk, -1) >= 25;
  const tonal = (d: number): Bagian => ({
    peran: 'TONAL',
    sasaran: Ck < KROMA_NETRAL ? [batasTerang(Lk + arah * d), 0, 0] : dariLch([batasTerang(Lk + arah * d), Math.max(8, Ck), hk]),
  });

  type Resep = { pola: PolaKomposisi; gaya: GayaKomposisi; bagian: Bagian[] };

  /** Semua resep satu gaya, berurutan dari yang paling mewakili. */
  function resepGaya(gaya: GayaKomposisi): Resep[] {
    const netral = (a: Lch | null, balikSuhu = false): Bagian =>
      kunciNetral
        ? { peran: 'NETRAL', kunci: kunciNetral }
        : { peran: 'NETRAL', sasaran: sasaranNetral(a && balikSuhu ? geserRona(a, 180) : a, kainSedang ? -arah : arah, gaya) };
    const warnaAksen = (a: Lch, geser = 0): Lch => {
      const x = geserRona(a, geser);
      return gaya === 'REDAM' ? redamkan(x) : x;
    };
    const aksen = (a: Lch, peran: PeranKomposisi = 'AKSEN', geser = 0): Bagian =>
      peran === 'AKSEN' && kunciAksen ? { peran, kunci: kunciAksen } : { peran, sasaran: sasaranAksen(warnaAksen(a, geser), Lk, arah) };
    // Aksen tua: aksen yang sama, didekatkan ke kain dan dipudarkan — zaitun di samping lime.
    const aksenTua = (a: Lch): Bagian => {
      const [L, C, h] = keLch(sasaranAksen(warnaAksen(a), Lk, arah));
      return { peran: 'AKSEN_TUA', sasaran: dariLch([batasTerang(L - arah * 24), C * 0.3, h]) };
    };
    const nada = (): Bagian => ({ peran: 'NADA', sasaran: sasaranNada(kain, arah, gaya) });

    /** Tinta keluarga komposisi berurutan dari yang dominan; diambil sebanyak `n`. */
    const keluarga: Partial<Record<PolaKomposisi, (a: Lch) => Bagian[] | null>> =
      gaya === 'REDAM'
        ? {
            // Seperti desain referensi: slate mendominasi, putih tulang, zaitun, lalu sedikit aksen.
            KLASIK: (a) =>
              n <= 2
                ? [netral(a), aksen(a)]
                : [nada(), netral(a), ...(n >= 4 ? [aksenTua(a)] : []), aksen(a), aksen(a, 'AKSEN_2', 45), tonal(38)],
          }
        : {
            KLASIK: (a) => [netral(a), aksen(a), nada(), aksen(a, 'AKSEN_2', 45), aksen(a, 'AKSEN_3', -45), tonal(38)],
            DUA_AKSEN: (a) =>
              n === 2 ? [aksen(a), aksen(a, 'AKSEN_2', 45)] : [netral(a), aksen(a), aksen(a, 'AKSEN_2', 45), nada(), aksen(a, 'AKSEN_3', -45), tonal(38)],
            KONTRAS: (a) => [aksen(a), aksen(a, 'AKSEN_2', 180), netral(a), nada(), aksen(a, 'AKSEN_3', 150), tonal(38)],
            AKSEN_NADA: (a) => (n === 2 ? [aksen(a), nada()] : null),
          };

    const resep: Resep[] = [];
    const dari = (pola: PolaKomposisi, a: Lch | undefined) => {
      const f = keluarga[pola];
      if (!a || !f) return;
      const b = f(a);
      if (b && b.length >= n) resep.push({ pola, gaya, bagian: b.slice(0, n) });
    };

    if (n === 1) {
      if (kunci) resep.push({ pola: 'SATU', gaya, bagian: [{ peran: kunciAksen ? 'AKSEN' : 'NETRAL', kunci }] });
      else {
        for (const a of daftarAksen) resep.push({ pola: 'SATU', gaya, bagian: [aksen(a)] });
        resep.push({ pola: 'SATU', gaya, bagian: [netral(null)] });
      }
    } else if (kunciAksen && kunciLch) {
      const k = kunciLch;
      dari('KLASIK', k);
      dari('DUA_AKSEN', k);
      dari('KONTRAS', k);
      dari('AKSEN_NADA', k);
      // Netral bersuhu berlawanan, sebagai pilihan kedua.
      const klasik = keluarga.KLASIK?.(k);
      if (klasik) {
        const i = klasik.findIndex((b) => b.peran === 'NETRAL');
        const lain = klasik.map((b, j) => (j === i ? netral(k, true) : b));
        resep.push({ pola: 'KLASIK', gaya, bagian: lain.slice(0, n) });
      }
    } else {
      const [a1, a2, a3, a4, a5, a6] = daftarAksen;
      if (gaya === 'REDAM') {
        for (const a of [a1, a2, a3, a4, a5, a6]) dari('KLASIK', a);
      } else {
        for (const a of [a1, a2, a3, a4]) dari('KLASIK', a);
        dari('DUA_AKSEN', a1);
        dari('KONTRAS', a2);
        if (n === 2) dari('AKSEN_NADA', a6 ?? a3);
        else dari('KLASIK', a5);
      }
      // Tonal sudah kalem dengan sendirinya: tempatnya di gaya redam.
      if (gaya === 'REDAM' && !kunciNetral) {
        const jauh = Math.max(24, Math.min(70, ruang(Lk, arah) - 2));
        const langkah = n === 1 ? 0 : (jauh - 14) / (n - 1);
        resep.push({ pola: 'TONAL', gaya, bagian: Array.from({ length: n }, (_, i) => tonal(jauh - i * langkah)) });
      }
    }
    return resep;
  }

  let resep: Resep[];
  if (gayaDiminta === 'SEMUA') {
    // Berselang-seling, supaya kedua gaya terlihat tanpa menggulir.
    const cerah = resepGaya('CERAH');
    const redam = resepGaya('REDAM');
    resep = [];
    for (let i = 0; i < Math.max(cerah.length, redam.length); i++) {
      if (cerah[i]) resep.push(cerah[i]);
      if (redam[i]) resep.push(redam[i]);
    }
  } else resep = resepGaya(gayaDiminta);
  const batas = gayaDiminta === 'SEMUA' ? 12 : 9;

  const hasil: Komposisi[] = [];
  for (const r of resep) {
    // Kunci netral hanya berarti kalau komposisinya memang memuat netral.
    if (kunciNetral && !r.bagian.some((x) => 'kunci' in x)) continue;
    const k = wujudkan(ktx, r.pola, r.gaya, r.bagian.map((x, i) => ({ ...x, porsi: porsi[i] })), arah);
    if (k && k.tinta.length === n && !hasil.some((x) => x.id === k.id)) hasil.push(k);
    if (hasil.length === batas) break;
  }
  return hasil;
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

  const k = wujudkan(ktx, 'DARI_GAMBAR', null, rencana, arahUtama(Lk));
  return k ? { ...k, id: `DARI_GAMBAR:${kainHex}:${baru ?? '-'}:${k.tinta.map((x) => x.hex).join('-')}` } : null;
}

/** Pola komposisi sebuah desain referensi, dipindah ke kain lain. */
export function tiruKomposisi(input: {
  gambar: readonly { hex: string; bagian: number }[];
  kainHex: string;
  katalog: readonly WarnaPantone[];
  /** Paling banyak sekian tinta — warna terluas didahulukan. */
  jumlah?: number;
}): Komposisi | null {
  const analisis = bacaKomposisiDesain(input.gambar, input.jumlah ?? 6);
  if (!analisis) return null;
  const k = variasiDesain({ analisis, kainHex: input.kainHex, katalog: input.katalog });
  return k ? { ...k, id: 'DARI_GAMBAR' } : null;
}
