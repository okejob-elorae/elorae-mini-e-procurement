import type { AturanHarmoni } from '../palet/harmoni';
import { deltaE2000, hexKeLab, type WarnaPantone } from '../palet/pantone';
import { normalisasiHex } from '../palet/warna';
import { ATURAN_SABLON, JUMLAH_SABLON_MAKS, ronaKhasAturan, sarankanSablon, type AturanSablon } from './saran';

/**
 * Pengganti satu tinta menurut aturan harmoni.
 *
 * Calon tiap aturan adalah saran aturan itu terhadap kain — mesin yang sama
 * dengan saran di roda, jadi "Complementary" di sini berarti hal yang sama
 * dengan "Complementary" di sana. Dari calon itu dibuang yang kembar dengan
 * tinta lain di palet, lalu diurutkan: rona khas aturannya dulu (rona kain
 * sendiri ada di hampir setiap aturan), lalu dari yang paling menonjol. Daftarnya
 * bergiliran antaraturan: tombol "Warna lain" berpindah aturan di setiap klik,
 * bukan menghabiskan satu aturan dulu.
 *
 * Daftar ini sengaja tidak bergantung pada tinta yang sedang diganti. Kalau
 * bergantung, setiap penggantian menggeser urutannya dan "berikutnya" tidak
 * pernah bisa berputar.
 */

export type CalonAturan = Record<AturanSablon, readonly { warna: WarnaPantone; geser: number }[]>;
export type SaranPengganti = { hex: string; kode: string; aturan: AturanSablon };

const PER_ATURAN = 3;
/** Pengganti yang lebih dekat dari ini ke tinta lain praktis tinta yang sama. */
const BEDA_ANTARTINTA = 10;
/** Selisih pembulatan hex ↔ HSB tidak membuat warna dianggap berbeda. */
const DE_SAMA = 1;

/** Calon tiap aturan untuk satu kain — mahal, jadi dihitung sekali per kain. */
export function calonPerAturan(kainHex: string, katalog: readonly WarnaPantone[]): CalonAturan {
  const calon = {} as Record<AturanSablon, { warna: WarnaPantone; geser: number }[]>;
  for (const aturan of ATURAN_SABLON) {
    calon[aturan] = sarankanSablon({ kainHex, jumlah: JUMLAH_SABLON_MAKS, aturan, katalog }).map((s) => ({ warna: s.warna, geser: s.geser }));
  }
  return calon;
}

export function saranPengganti(input: {
  calon: CalonAturan;
  kainHex: string;
  /** Semua tinta palet; yang di `indeks` adalah yang diganti. */
  hex: readonly string[];
  indeks: number;
  /** Aturan palet saat ini didahulukan. */
  aturanUtama: AturanHarmoni;
}): SaranPengganti[] {
  const labKain = hexKeLab(input.kainHex);
  const lain = input.hex.flatMap((h, i) => {
    const bersih = i === input.indeks ? null : normalisasiHex(h);
    return bersih ? [hexKeLab(bersih)] : [];
  });
  const urutan = ATURAN_SABLON.includes(input.aturanUtama as AturanSablon)
    ? [input.aturanUtama as AturanSablon, ...ATURAN_SABLON.filter((a) => a !== input.aturanUtama)]
    : [...ATURAN_SABLON];

  const perAturan = urutan.map((aturan) =>
    input.calon[aturan]
      .filter(({ warna: w }) => lain.every((l) => deltaE2000(l, w.lab) >= BEDA_ANTARTINTA))
      .map(({ warna: w, geser }) => ({
        w,
        khas: ronaKhasAturan(aturan, geser),
        skor: Math.min(deltaE2000(w.lab, labKain), ...lain.map((l) => deltaE2000(l, w.lab))),
      }))
      .sort((a, b) => Number(b.khas) - Number(a.khas) || b.skor - a.skor)
      .slice(0, PER_ATURAN)
      .map(({ w }): SaranPengganti => ({ hex: w.hex, kode: w.kode, aturan })),
  );

  const hasil: SaranPengganti[] = [];
  const ada = new Set<string>();
  for (let r = 0; r < PER_ATURAN; r++) {
    for (const daftar of perAturan) {
      const x = daftar[r];
      if (x && !ada.has(x.kode)) {
        ada.add(x.kode);
        hasil.push(x);
      }
    }
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
