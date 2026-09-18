import { langkahHarmoni, type AturanHarmoni } from '../palet/harmoni';
import { rasioKontras } from '../palet/kontras';
import { deltaE2000, hexKeLab, pantoneKhusus, type WarnaPantone } from '../palet/pantone';
import { hexKeHsb, normalisasiHex } from '../palet/warna';
import { AKSEN_POPULER, KROMA_NETRAL } from './aksen';
import { ATURAN_SABLON, ronaKhasAturan, type AturanSablon } from './saran';

/**
 * Pengganti satu tinta: berbagai JENIS warna, semuanya masuk dengan kain.
 *
 * Jenis — solid, neon, pastel, redam, gelap, metalik — memberi variasi yang
 * benar-benar berbeda; aturan harmoni memastikan tiap pilihan tetap cocok
 * dengan kain: ronanya harus jatuh di salah satu rona aturan itu terhadap kain
 * (paling jauh `TOLERANSI_RONA` di roda). Selain itu tinta harus terbaca di
 * kain (paling tidak "lembut") dan tidak kembar dengan tinta lain di palet.
 *
 * Daftarnya bergiliran antarjenis, lalu antaraturan di dalam jenisnya: tombol
 * "Warna lain" berganti jenis di setiap klik. Daftar ini sengaja tidak
 * bergantung pada tinta yang sedang diganti — kalau bergantung, setiap
 * penggantian menggeser urutannya dan "berikutnya" tidak pernah berputar.
 *
 * Neon dan metalik di sini dipilih orang dengan sadar dan diberi label; saran
 * otomatis (aturan harmoni, galeri rekomendasi) tetap tidak memakainya.
 */

export const KELUARGA_WARNA = ['SOLID', 'NEON', 'PASTEL', 'REDAM', 'GELAP', 'METALIK'] as const;
export type KeluargaWarna = (typeof KELUARGA_WARNA)[number];

export type SaranPengganti = { hex: string; kode: string; aturan: AturanSablon; keluarga: KeluargaWarna };

type Calon = { warna: WarnaPantone; rona: number; L: number; C: number; rasio: number };
export type CalonKain = { ronaDasar: number; perKeluarga: Record<KeluargaWarna, readonly Calon[]> };

/** Rona harus sedekat ini (derajat, roda pelukis) ke rona aturan supaya dianggap mengikuti aturan itu. */
const TOLERANSI_RONA = 20;
/** Di bawah rasio ini tinta nyaris menyatu dengan kain ("samar"). */
const RASIO_MIN = 1.8;
/** Pengganti yang lebih dekat dari ini ke tinta lain praktis tinta yang sama. */
const BEDA_ANTARTINTA = 10;
/** Pilihan per aturan di dalam satu jenis — satu per rona aturan, paling banyak dua. */
const PER_ATURAN = 2;
/** Selisih pembulatan hex ↔ HSB tidak membuat warna dianggap berbeda. */
const DE_SAMA = 1;
/** Di bawah kepekatan ini warna dianggap netral — bukan variasi warna. */
const KROMA_WARNA = 12;

/**
 * Jenis sebuah Pantone. Neon dan metalik menurut nomornya; tinta biasa menurut
 * terang dan kepekatannya. Netral (abu, hitam, putih) tidak punya jenis — ia
 * bukan variasi warna.
 */
export function keluargaPantone(w: WarnaPantone): KeluargaWarna | null {
  const [L, a, b] = w.lab;
  const C = Math.hypot(a, b);
  const khusus = pantoneKhusus(w.kode);
  if (khusus) return C >= KROMA_WARNA ? khusus : null;
  if (C < KROMA_WARNA) return null;
  if (L >= 75 && C <= 45) return 'PASTEL';
  if (L < 35) return 'GELAP';
  return C >= 35 ? 'SOLID' : 'REDAM';
}

const ronaKatalog = new WeakMap<readonly WarnaPantone[], { warna: WarnaPantone; rona: number; keluarga: KeluargaWarna }[]>();

function siapkan(katalog: readonly WarnaPantone[]) {
  let hasil = ronaKatalog.get(katalog);
  if (!hasil) {
    hasil = katalog.flatMap((warna) => {
      const keluarga = keluargaPantone(warna);
      return keluarga ? [{ warna, rona: hexKeHsb(warna.hex).h, keluarga }] : [];
    });
    ronaKatalog.set(katalog, hasil);
  }
  return hasil;
}

/**
 * Calon yang terbaca di satu kain, per jenis. Rona dasar = rona kain; kain
 * netral tidak punya rona, jadi memakai rona aksen pertama galeri — sama dengan
 * saran aturan harmoni, supaya keduanya sepakat.
 */
export function calonUntukKain(kainHex: string, katalog: readonly WarnaPantone[]): CalonKain {
  const [, a, b] = hexKeLab(kainHex);
  const aksenNetral = katalog.find((w) => w.kode === AKSEN_POPULER[0]);
  const ronaDasar = Math.hypot(a, b) < KROMA_NETRAL ? (aksenNetral ? hexKeHsb(aksenNetral.hex).h : 80) : hexKeHsb(kainHex).h;
  const perKeluarga = Object.fromEntries(KELUARGA_WARNA.map((k) => [k, [] as Calon[]])) as Record<KeluargaWarna, Calon[]>;
  for (const { warna, rona, keluarga } of siapkan(katalog)) {
    const rasio = rasioKontras(warna.hex, kainHex);
    if (rasio < RASIO_MIN) continue;
    const [L, la, lb] = warna.lab;
    perKeluarga[keluarga].push({ warna, rona, L, C: Math.hypot(la, lb), rasio });
  }
  return { ronaDasar, perKeluarga };
}

function jarakRona(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Seberapa khas sebuah calon untuk jenisnya — makin kecil makin khas. */
function watakJenis(keluarga: KeluargaWarna, c: Calon): number {
  switch (keluarga) {
    case 'SOLID':
      return -Math.min(c.C, 80) / 6;
    case 'PASTEL':
      return Math.abs(c.L - 85) / 3;
    case 'REDAM':
      return Math.abs(c.C - 22) / 3;
    case 'GELAP':
      return Math.abs(c.L - 25) / 3;
    default:
      return 0;
  }
}

/** Rona khas sebuah aturan: geseran dari rona dasar, tanpa 0° kecuali Monochromatic dan Shades. */
function geseranAturan(aturan: AturanSablon): number[] {
  return [...new Set((langkahHarmoni(aturan) ?? []).map((l) => l.dh))].filter((dh) => ronaKhasAturan(aturan, dh));
}

function bergiliran<T>(daftar: readonly (readonly T[])[]): T[] {
  const hasil: T[] = [];
  const panjang = Math.max(0, ...daftar.map((d) => d.length));
  for (let r = 0; r < panjang; r++) for (const d of daftar) if (d[r]) hasil.push(d[r]);
  return hasil;
}

export function saranPengganti(input: {
  calon: CalonKain;
  /** Semua tinta palet; yang di `indeks` adalah yang diganti. */
  hex: readonly string[];
  indeks: number;
  /** Aturan palet saat ini didahulukan di setiap jenis. */
  aturanUtama: AturanHarmoni;
}): SaranPengganti[] {
  const lain = input.hex.flatMap((h, i) => {
    const bersih = i === input.indeks ? null : normalisasiHex(h);
    return bersih ? [hexKeLab(bersih)] : [];
  });
  const urutanAturan = ATURAN_SABLON.includes(input.aturanUtama as AturanSablon)
    ? [input.aturanUtama as AturanSablon, ...ATURAN_SABLON.filter((a) => a !== input.aturanUtama)]
    : [...ATURAN_SABLON];

  const perJenis = KELUARGA_WARNA.map((keluarga) => {
    const calon = input.calon.perKeluarga[keluarga].filter((c) => lain.every((l) => deltaE2000(l, c.warna.lab) >= BEDA_ANTARTINTA));
    const perAturan = urutanAturan.map((aturan) => {
      const terpilih: { c: Calon; skor: number }[] = [];
      for (const dh of geseranAturan(aturan)) {
        const sasaran = input.calon.ronaDasar + dh;
        let terbaik: { c: Calon; skor: number } | null = null;
        for (const c of calon) {
          const jarak = jarakRona(c.rona, sasaran);
          if (jarak > TOLERANSI_RONA) continue;
          const skor = jarak / 4 + watakJenis(keluarga, c) - Math.min(c.rasio, 4.5);
          if (!terbaik || skor < terbaik.skor) terbaik = { c, skor };
        }
        if (terbaik && !terpilih.some((t) => t.c === terbaik.c)) terpilih.push(terbaik);
      }
      return terpilih
        .sort((a, b) => a.skor - b.skor)
        .slice(0, PER_ATURAN)
        .map(({ c }): SaranPengganti => ({ hex: c.warna.hex, kode: c.warna.kode, aturan, keluarga }));
    });
    return bergiliran(perAturan);
  });

  const hasil: SaranPengganti[] = [];
  const ada = new Set<string>();
  for (const x of bergiliran(perJenis)) {
    if (ada.has(x.kode)) continue;
    ada.add(x.kode);
    hasil.push(x);
  }
  return hasil;
}

/** Saran yang warnanya sama dengan `hex`, bila ada. */
export function saranYangDipakai<T extends { hex: string }>(daftar: readonly T[], hex: string): T | null {
  const bersih = normalisasiHex(hex);
  if (!bersih) return null;
  const lab = hexKeLab(bersih);
  return daftar.find((x) => deltaE2000(hexKeLab(x.hex), lab) < DE_SAMA) ?? null;
}

/** Saran sesudah warna `hex` — berputar ke awal, dan mulai dari awal kalau `hex` bukan saran. */
export function saranBerikutnya<T extends { hex: string }>(daftar: readonly T[], hex: string): T | null {
  if (daftar.length === 0) return null;
  const kini = saranYangDipakai(daftar, hex);
  return kini ? daftar[(daftar.indexOf(kini) + 1) % daftar.length] : daftar[0];
}
