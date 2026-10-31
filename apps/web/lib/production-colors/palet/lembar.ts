import { bagiGram, resepCampur } from '../sablon/campur';
import { HURUF_SABLON, keterbacaanSablon, peranUntuk, type KeterbacaanSablon, type PeranSablon } from '../sablon/saran';
import type { TintaDasar } from '../sablon/tinta-dasar';
import { INDEKS_DASAR, type AturanHarmoni } from './harmoni';
import { rasioKontras } from './kontras';
import { pantoneTerdekat, type WarnaPantone } from './pantone';
import { hexKeRgb, normalisasiHex, rgbKeCmyk } from './warna';

/** Di bawah ini kode Pantone dianggap SAMA dengan warnanya, bukan sekadar terdekat. */
const DE_PERSIS = 0.05;

export type BarisLembar = {
  /** Huruf tinta (A–F) di palet berkain, nomor 1–5 di palet bebas. */
  label: string;
  /** Warna dasar harmoni — hanya di palet bebas. */
  dasar: boolean;
  hex: string;
  rgb: [number, number, number];
  cmyk: [number, number, number, number];
  pantoneC: { kode: string; deltaE: number } | null;
  pantoneTcx: { kode: string; nama: string | null; deltaE: number } | null;
  porsi: number | null;
  peran: PeranSablon | null;
  /** Rasio kontras terhadap kain. */
  kontras: number | null;
  keterbacaan: KeterbacaanSablon | null;
  resep: { bagian: { nama: string; persen: number; gram: number }[]; deltaE: number } | null;
};

export type LembarPalet = {
  nama: string;
  aturan: AturanHarmoni;
  /** `nama` terisi hanya kalau kainnya persis satu warna TCX. */
  kain: { hex: string; nama: string | null } | null;
  /** Berat adonan resep, `null` di palet bebas. */
  berat: number | null;
  maksTinta: number;
  baris: BarisLembar[];
};

/**
 * Semua yang dicetak dan diekspor tentang satu palet, dihitung sekali di satu
 * tempat. PDF dan gambar PNG membaca lembar yang sama, jadi keduanya tidak
 * bisa menyebut kode atau resep yang berbeda dari layar.
 */
export function susunLembarPalet(input: {
  nama: string;
  aturan: AturanHarmoni;
  warna: readonly string[];
  kain: string | null;
  porsi: readonly number[] | null;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
  tintaDasar: readonly TintaDasar[];
  maksTinta: number;
  berat: number;
}): LembarPalet {
  const kain = input.kain ? normalisasiHex(input.kain) : null;
  const tintaHex = input.tintaDasar.map((t) => t.hex);
  const berat = Math.max(0, Math.round(input.berat));

  let kainLembar: LembarPalet['kain'] = null;
  if (kain) {
    const tcx = pantoneTerdekat(input.katalogTcx, kain);
    kainLembar = {
      hex: kain.toUpperCase(),
      nama: tcx && tcx.deltaE < DE_PERSIS ? `PANTONE ${tcx.warna.kode} TCX ${tcx.warna.nama ?? ''}`.trim() : null,
    };
  }

  const baris = input.warna.map((mentah, i): BarisLembar => {
    const hex = normalisasiHex(mentah) ?? '#000000';
    const { r, g, b } = hexKeRgb(hex);
    const c = pantoneTerdekat(input.katalogC, hex);
    const tcx = pantoneTerdekat(input.katalogTcx, hex);
    const kontras = kain ? rasioKontras(hex, kain) : null;
    const resep = kain ? resepCampur(hex, tintaHex, input.maksTinta) : null;
    const gram = resep ? bagiGram(berat, resep.bagian.map((x) => x.persen)) : [];
    return {
      label: kain ? HURUF_SABLON[i] : String(i + 1),
      dasar: !kain && i === INDEKS_DASAR,
      hex: hex.toUpperCase(),
      rgb: [r, g, b],
      cmyk: rgbKeCmyk(r, g, b),
      pantoneC: c ? { kode: c.warna.kode, deltaE: c.deltaE } : null,
      pantoneTcx: tcx ? { kode: tcx.warna.kode, nama: tcx.warna.nama, deltaE: tcx.deltaE } : null,
      porsi: kain ? (input.porsi?.[i] ?? null) : null,
      peran: kain ? peranUntuk(i, input.warna.length) : null,
      kontras,
      keterbacaan: kontras === null ? null : keterbacaanSablon(kontras),
      resep: resep
        ? {
            bagian: resep.bagian.map((x, j) => ({ nama: input.tintaDasar[x.indeks]?.nama ?? '?', persen: x.persen, gram: gram[j] })),
            deltaE: resep.deltaE,
          }
        : null,
    };
  });

  return {
    nama: input.nama.trim(),
    aturan: input.aturan,
    kain: kainLembar,
    berat: kain ? berat : null,
    maksTinta: input.maksTinta,
    baris,
  };
}
