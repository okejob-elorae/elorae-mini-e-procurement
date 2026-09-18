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

export type PeranKomposisi = 'AKSEN' | 'AKSEN_2' | 'AKSEN_3' | 'NETRAL' | 'NADA' | 'TONAL';

export type TintaKomposisi = {
  hex: string;
  /** Kode Pantone C bila tintanya persis satu warna katalog. */
  kode: string | null;
  peran: PeranKomposisi;
  porsi: number;
  /** Warna yang dikunci pengguna — dipakai apa adanya, tidak dibulatkan. */
  dikunci?: boolean;
};

export type Komposisi = { id: string; pola: PolaKomposisi; tinta: TintaKomposisi[] };

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
  NETRAL: [BEDA_TERBACA, 100],
  // Tone-on-tone sengaja nyaris menyatu dengan kain, tetapi tetap harus ada.
  NADA: [5, 28],
  TONAL: [12, 100],
};

type Konteks = { katalog: readonly WarnaPantone[]; Lk: number; labKain: Lab };

/** Pantone C terdekat ke `target` yang memenuhi syarat perannya dan tidak kembar dengan tinta lain. */
function bulatkan(ktx: Konteks, target: Lab, peran: PeranKomposisi, arah: number, hindari: readonly Lab[]): WarnaPantone | null {
  const [min, maks] = SYARAT[peran];
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
type Rencana = { peran: PeranKomposisi; porsi: number; sasaran: Lab } | { peran: PeranKomposisi; porsi: number; kunci: string };

function wujudkan(ktx: Konteks, pola: PolaKomposisi, rencana: readonly Rencana[], arah: number): Komposisi | null {
  const urut = [...rencana].sort((a, b) => b.porsi - a.porsi);
  const dipakai: Lab[] = urut.flatMap((r) => ('kunci' in r ? [hexKeLab(r.kunci)] : []));
  const tinta: TintaKomposisi[] = [];
  for (const r of urut) {
    if ('kunci' in r) {
      tinta.push({ hex: r.kunci, kode: kodePersis(ktx.katalog, r.kunci), peran: r.peran, porsi: r.porsi, dikunci: true });
      continue;
    }
    const arahTinta = Math.sign(r.sasaran[0] - ktx.Lk) || arah;
    const w = bulatkan(ktx, r.sasaran, r.peran, arahTinta, dipakai);
    if (!w) return null;
    dipakai.push(w.lab);
    tinta.push({ hex: w.hex, kode: w.kode, peran: r.peran, porsi: r.porsi });
  }
  return { id: `${pola}:${tinta.map((t) => t.hex).join('-')}`, pola, tinta };
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

/** Netral: krem hangat untuk aksen hangat, putih/arang dingin untuk aksen dingin. */
function sasaranNetral(aksen: Lch | null, arah: number): Lab {
  const h = aksen ? aksen[2] : 60;
  const hangat = aksen === null || h < 120 || h >= 330;
  if (arah > 0) return hangat ? [91, 1, 9] : [95, -1, -2];
  return hangat ? [24, 2, 6] : [22, 0, -3];
}

/** Tone-on-tone: sedikit lebih terang/gelap dari kain. Kain netral mendapat slate dingin, seperti angka di desain streetwear. */
function sasaranNada(kain: Lch, arah: number): Lab {
  const [Lk, Ck, hk] = kain;
  return Ck < KROMA_NETRAL ? dariLch([batasTerang(Lk + arah * 16), 10, 250]) : dariLch([batasTerang(Lk + arah * 14), Math.max(6, Ck * 0.9), hk]);
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
}): Komposisi[] {
  const n = Math.min(6, Math.max(1, Math.round(input.jumlah ?? 3)));
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
  const daftarAksen: Lch[] =
    Ck < KROMA_NETRAL
      ? AKSEN_POPULER.flatMap((kode) => {
          const w = input.katalog.find((x) => x.kode === kode);
          return w ? [keLch(w.lab)] : [];
        })
      : [180, 150, 210, 120, 240, 30].map((d): Lch => [batasTerang(Lk + arah * 40), 55, (hk + d) % 360]);

  /*
   * Kain bernada sedang (cukup ruang ke terang maupun ke gelap): netral dibuat
   * berlawanan arah dengan aksen — krem terang bersama aksen gelap. Kalau
   * searah, seluruh galeri jadi gelap semua dan tidak ada pilihan nyata.
   */
  const kainSedang = ruang(Lk, 1) >= 25 && ruang(Lk, -1) >= 25;
  const netral = (a: Lch | null, balikSuhu = false): Bagian =>
    kunciNetral
      ? { peran: 'NETRAL', kunci: kunciNetral }
      : { peran: 'NETRAL', sasaran: sasaranNetral(a && balikSuhu ? geserRona(a, 180) : a, kainSedang ? -arah : arah) };
  const aksen = (a: Lch, peran: PeranKomposisi = 'AKSEN', geser = 0): Bagian =>
    peran === 'AKSEN' && kunciAksen ? { peran, kunci: kunciAksen } : { peran, sasaran: sasaranAksen(geserRona(a, geser), Lk, arah) };
  const nada = (): Bagian => ({ peran: 'NADA', sasaran: sasaranNada(kain, arah) });
  // Tonal: tingkat terang dari kain, dibagi rata sejauh ruang yang tersedia.
  const tonal = (d: number): Bagian => ({
    peran: 'TONAL',
    sasaran: Ck < KROMA_NETRAL ? [batasTerang(Lk + arah * d), 0, 0] : dariLch([batasTerang(Lk + arah * d), Math.max(8, Ck), hk]),
  });

  /** Tinta keluarga komposisi berurutan dari yang dominan; diambil sebanyak `n`. */
  const keluarga: Record<Exclude<PolaKomposisi, 'SATU' | 'TONAL' | 'DARI_GAMBAR'>, (a: Lch) => Bagian[] | null> = {
    KLASIK: (a) => [netral(a), aksen(a), nada(), aksen(a, 'AKSEN_2', 45), aksen(a, 'AKSEN_3', -45), tonal(38)],
    DUA_AKSEN: (a) =>
      n === 2 ? [aksen(a), aksen(a, 'AKSEN_2', 45)] : [netral(a), aksen(a), aksen(a, 'AKSEN_2', 45), nada(), aksen(a, 'AKSEN_3', -45), tonal(38)],
    KONTRAS: (a) => [aksen(a), aksen(a, 'AKSEN_2', 180), netral(a), nada(), aksen(a, 'AKSEN_3', 150), tonal(38)],
    AKSEN_NADA: (a) => (n === 2 ? [aksen(a), nada()] : null),
  };

  type Resep = { pola: PolaKomposisi; bagian: Bagian[] };
  const resep: Resep[] = [];
  const dari = (pola: keyof typeof keluarga, a: Lch | undefined) => {
    if (!a) return;
    const b = keluarga[pola](a);
    if (b && b.length >= n) resep.push({ pola, bagian: b.slice(0, n) });
  };

  if (n === 1) {
    if (kunci) resep.push({ pola: 'SATU', bagian: [{ peran: kunciAksen ? 'AKSEN' : 'NETRAL', kunci }] });
    else {
      for (const a of daftarAksen) resep.push({ pola: 'SATU', bagian: [aksen(a)] });
      resep.push({ pola: 'SATU', bagian: [netral(null)] });
    }
  } else if (kunciAksen && kunciLch) {
    const k = kunciLch;
    dari('KLASIK', k);
    dari('DUA_AKSEN', k);
    dari('KONTRAS', k);
    dari('AKSEN_NADA', k);
    // Netral bersuhu berlawanan, sebagai pilihan kedua.
    resep.push({ pola: 'KLASIK', bagian: [netral(k, true), ...keluarga.KLASIK(k)!.slice(1)].slice(0, n) });
  } else {
    const [a1, a2, a3, a4, a5, a6] = daftarAksen;
    for (const a of [a1, a2, a3, a4]) dari('KLASIK', a);
    dari('DUA_AKSEN', a1);
    dari('KONTRAS', a2);
    if (n === 2) dari('AKSEN_NADA', a6 ?? a3);
    else dari('KLASIK', a5);
    if (!kunciNetral) {
      const jauh = Math.max(24, Math.min(70, ruang(Lk, arah) - 2));
      const langkah = n === 1 ? 0 : (jauh - 14) / (n - 1);
      resep.push({ pola: 'TONAL', bagian: Array.from({ length: n }, (_, i) => tonal(jauh - i * langkah)) });
    }
  }

  const hasil: Komposisi[] = [];
  for (const r of resep) {
    // Kunci netral hanya berarti kalau komposisinya memang memuat netral.
    if (kunciNetral && !r.bagian.some((x) => 'kunci' in x)) continue;
    const k = wujudkan(ktx, r.pola, r.bagian.map((x, i) => ({ ...x, porsi: porsi[i] })), arah);
    if (k && k.tinta.length === n && !hasil.some((x) => x.id === k.id)) hasil.push(k);
    if (hasil.length === 9) break;
  }
  return hasil;
}

/**
 * Pola komposisi sebuah desain referensi, dipindah ke kain lain.
 *
 * `gambar` adalah warna dominan beserta luasnya. Warna terluas dianggap kain
 * referensi — latar desain. Tiap warna lain dibaca perannya (aksen, netral,
 * tone-on-tone) dan jaraknya ke kain referensi; lalu disusun ulang dengan
 * peran, arah terang, dan porsi yang sama terhadap kain baru.
 */
export function tiruKomposisi(input: {
  gambar: readonly { hex: string; bagian: number }[];
  kainHex: string;
  katalog: readonly WarnaPantone[];
  /** Paling banyak sekian tinta — warna terluas didahulukan. */
  jumlah?: number;
}): Komposisi | null {
  const bersih = input.gambar
    .flatMap((w) => {
      const hex = normalisasiHex(w.hex);
      return hex && w.bagian >= 0.02 ? [{ hex, bagian: w.bagian }] : [];
    })
    .sort((a, b) => b.bagian - a.bagian);
  if (bersih.length < 2) return null;

  const [latar, ...tintaRef] = bersih;
  const ref = keLch(hexKeLab(latar.hex));
  const labKain = hexKeLab(normalisasiHex(input.kainHex) ?? '#000000');
  const kain = keLch(labKain);
  const [Lk, Ck, hk] = kain;
  const ktx: Konteks = { katalog: input.katalog, Lk, labKain };
  const berputar = ref[1] >= KROMA_NETRAL && Ck >= KROMA_NETRAL;

  const dipakai = tintaRef.slice(0, Math.min(6, Math.max(1, Math.round(input.jumlah ?? 6))));
  const porsi = porsiDariBagian(dipakai.map((t) => t.bagian));
  const rencana: Rencana[] = dipakai.map((t, i) => {
    const [L, C, h] = keLch(hexKeLab(t.hex));
    const dL = L - ref[0];
    const arahRef = Math.sign(dL) || 1;
    const peran: PeranKomposisi = Math.abs(dL) < 28 && C < 25 ? 'NADA' : C < 15 ? 'NETRAL' : 'AKSEN';
    const bagianRuang = Math.abs(dL) / Math.max(1, ruang(ref[0], arahRef));
    // Arah dipertahankan selama kain baru masih memberi ruang untuk peran itu; kalau tidak, dibalik.
    const ruangPerlu = peran === 'NADA' ? 8 : peran === 'NETRAL' ? 25 : 35;
    const arah = ruang(Lk, arahRef) >= ruangPerlu ? arahRef : -arahRef;
    const beda =
      peran === 'NADA' ? Math.min(26, Math.max(6, Math.abs(dL))) : Math.max(peran === 'AKSEN' ? 25 : 22, bagianRuang * ruang(Lk, arah));
    // Tone-on-tone di kain berwarna mengikuti rona kain itu sendiri — itulah artinya "senada".
    const nadaBerona = peran === 'NADA' && Ck >= KROMA_NETRAL;
    const rona = nadaBerona ? hk : berputar ? (h + hk - ref[2] + 360) % 360 : h;
    const kroma = nadaBerona ? Math.max(6, Ck * 0.9) : peran === 'NADA' ? Math.min(C, 12) : C;
    return { peran, porsi: porsi[i], sasaran: dariLch([batasTerang(Lk + arah * beda), kroma, rona]) };
  });

  // Urutan referensi (terluas dulu) sudah urutan porsi; `wujudkan` mengurutkan ulang dengan stabil.
  const k = wujudkan(ktx, 'DARI_GAMBAR', rencana, arahUtama(Lk));
  return k ? { ...k, id: 'DARI_GAMBAR' } : null;
}
