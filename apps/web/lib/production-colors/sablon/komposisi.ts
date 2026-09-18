import { porsiDariBagian } from '../palet/gambar';
import { deltaE2000, hexKeLab, type Lab, type WarnaPantone } from '../palet/pantone';
import { normalisasiHex } from '../palet/warna';

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

export type PolaKomposisi =
  | 'AKSEN_NETRAL_NADA'
  | 'AKSEN_NETRAL'
  | 'DUA_AKSEN_NETRAL'
  | 'KONTRAS_PENUH'
  | 'AKSEN_NADA'
  | 'TONAL'
  | 'DARI_GAMBAR';

export type PeranKomposisi = 'AKSEN' | 'AKSEN_2' | 'NETRAL' | 'NADA' | 'TONAL';

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

/**
 * Aksen untuk kain netral (hitam, putih, abu) — kain tanpa rona tidak bisa
 * memberi rona aksen, jadi dipilihkan dari warna sablon yang lazim dan kuat.
 * Urutan ini juga urutan kartu di galeri.
 */
export const AKSEN_POPULER = ['375 C', 'Orange 021 C', '2728 C', '485 C', '116 C', '3262 C', '213 C'] as const;

/** Di bawah kepekatan (kroma Lab) ini sebuah warna dianggap tidak berona. */
export const KROMA_NETRAL = 6;
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

/**
 * Galeri komposisi siap pakai untuk satu kain. Dengan `kunciHex`, warna itu
 * ada di setiap komposisi: sebagai aksen kalau berpigmen, sebagai netral kalau
 * tidak — dan sisanya disusun mengelilinginya.
 */
export function galeriKomposisi(input: { kainHex: string; katalog: readonly WarnaPantone[]; kunciHex?: string | null }): Komposisi[] {
  const kainHex = normalisasiHex(input.kainHex) ?? '#000000';
  const labKain = hexKeLab(kainHex);
  const kain = keLch(labKain);
  const [Lk, Ck, hk] = kain;
  const ktx: Konteks = { katalog: input.katalog, Lk, labKain };
  const arah = arahUtama(Lk);

  const kunci = input.kunciHex ? normalisasiHex(input.kunciHex) : null;
  const kunciLch = kunci ? keLch(hexKeLab(kunci)) : null;
  const kunciNetral = kunciLch !== null && kunciLch[1] < 15;

  // Daftar aksen: dari katalog populer untuk kain netral, dari rona kain untuk kain berwarna.
  let daftarAksen: Lch[];
  if (Ck < KROMA_NETRAL) {
    daftarAksen = AKSEN_POPULER.flatMap((kode) => {
      const w = input.katalog.find((x) => x.kode === kode);
      return w ? [keLch(w.lab)] : [];
    });
  } else {
    daftarAksen = [180, 150, 210, 120, 240, 30].map((d): Lch => [batasTerang(Lk + arah * 40), 55, (hk + d) % 360]);
  }

  const aksen = (a: Lch) => sasaranAksen(a, Lk, arah);
  const nada = () => sasaranNada(kain, arah);
  /*
   * Kain bernada sedang (cukup ruang ke terang maupun ke gelap): netral dibuat
   * berlawanan arah dengan aksen — krem terang bersama aksen gelap. Kalau
   * searah, seluruh galeri jadi gelap semua dan tidak ada pilihan nyata.
   */
  const kainSedang = ruang(Lk, 1) >= 25 && ruang(Lk, -1) >= 25;
  const netral = (a: Lch | null) => sasaranNetral(a, kainSedang ? -arah : arah);

  type Resep = { pola: PolaKomposisi; rencana: Rencana[] };
  const resep: Resep[] = [];

  if (kunci && kunciLch && !kunciNetral) {
    const k = kunciLch;
    resep.push(
      { pola: 'AKSEN_NETRAL_NADA', rencana: [{ peran: 'NETRAL', porsi: 45, sasaran: netral(k) }, { peran: 'AKSEN', porsi: 35, kunci }, { peran: 'NADA', porsi: 20, sasaran: nada() }] },
      { pola: 'AKSEN_NETRAL', rencana: [{ peran: 'NETRAL', porsi: 60, sasaran: netral(k) }, { peran: 'AKSEN', porsi: 40, kunci }] },
      { pola: 'AKSEN_NADA', rencana: [{ peran: 'AKSEN', porsi: 60, kunci }, { peran: 'NADA', porsi: 40, sasaran: nada() }] },
      { pola: 'DUA_AKSEN_NETRAL', rencana: [{ peran: 'NETRAL', porsi: 50, sasaran: netral(k) }, { peran: 'AKSEN', porsi: 30, kunci }, { peran: 'AKSEN_2', porsi: 20, sasaran: aksen(geserRona(k, 45)) }] },
      { pola: 'KONTRAS_PENUH', rencana: [{ peran: 'AKSEN', porsi: 45, kunci }, { peran: 'AKSEN_2', porsi: 35, sasaran: aksen(geserRona(k, 180)) }, { peran: 'NETRAL', porsi: 20, sasaran: netral(k) }] },
      // Netral berseberangan suhu, untuk pilihan kedua.
      { pola: 'AKSEN_NETRAL', rencana: [{ peran: 'NETRAL', porsi: 60, sasaran: netral(geserRona(k, 180)) }, { peran: 'AKSEN', porsi: 40, kunci }] },
    );
  } else {
    const netralTetap = kunci && kunciNetral ? kunci : null;
    const n = (a: Lch): Rencana => (netralTetap ? { peran: 'NETRAL', porsi: 0, kunci: netralTetap } : { peran: 'NETRAL', porsi: 0, sasaran: netral(a) });
    const denganPorsi = (r: Rencana, porsi: number): Rencana => ({ ...r, porsi });
    const [a1, a2, a3, a4, a5, a6] = daftarAksen;
    const pakai = (a: Lch | undefined, f: (a: Lch) => Resep) => a && resep.push(f(a));

    for (const a of [a1, a2, a3])
      pakai(a, (x) => ({ pola: 'AKSEN_NETRAL_NADA', rencana: [denganPorsi(n(x), 45), { peran: 'AKSEN', porsi: 35, sasaran: aksen(x) }, { peran: 'NADA', porsi: 20, sasaran: nada() }] }));
    for (const a of [a4, a5]) pakai(a, (x) => ({ pola: 'AKSEN_NETRAL', rencana: [denganPorsi(n(x), 60), { peran: 'AKSEN', porsi: 40, sasaran: aksen(x) }] }));
    pakai(a1, (x) => ({
      pola: 'DUA_AKSEN_NETRAL',
      rencana: [denganPorsi(n(x), 50), { peran: 'AKSEN', porsi: 30, sasaran: aksen(x) }, { peran: 'AKSEN_2', porsi: 20, sasaran: aksen(geserRona(x, 45)) }],
    }));
    pakai(a2, (x) => ({
      pola: 'KONTRAS_PENUH',
      rencana: [{ peran: 'AKSEN', porsi: 45, sasaran: aksen(x) }, { peran: 'AKSEN_2', porsi: 35, sasaran: aksen(geserRona(x, 180)) }, denganPorsi(n(x), 20)],
    }));
    if (!netralTetap) {
      pakai(a6 ?? a3, (x) => ({ pola: 'AKSEN_NADA', rencana: [{ peran: 'AKSEN', porsi: 60, sasaran: aksen(x) }, { peran: 'NADA', porsi: 40, sasaran: nada() }] }));
      const tonal = (d: number): Lab => (Ck < KROMA_NETRAL ? [batasTerang(Lk + arah * d), 0, 0] : dariLch([batasTerang(Lk + arah * d), Math.max(8, Ck), hk]));
      resep.push({
        pola: 'TONAL',
        rencana: [
          { peran: 'TONAL', porsi: 50, sasaran: tonal(58) },
          { peran: 'TONAL', porsi: 30, sasaran: tonal(38) },
          { peran: 'TONAL', porsi: 20, sasaran: tonal(20) },
        ],
      });
    }
  }

  const hasil: Komposisi[] = [];
  for (const r of resep) {
    const k = wujudkan(ktx, r.pola, r.rencana, arah);
    if (k && !hasil.some((x) => x.id === k.id)) hasil.push(k);
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
export function tiruKomposisi(input: { gambar: readonly { hex: string; bagian: number }[]; kainHex: string; katalog: readonly WarnaPantone[] }): Komposisi | null {
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

  const porsi = porsiDariBagian(tintaRef.slice(0, 6).map((t) => t.bagian));
  const rencana: Rencana[] = tintaRef.slice(0, 6).map((t, i) => {
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
