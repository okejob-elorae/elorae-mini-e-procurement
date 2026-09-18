import { JUMLAH_SABLON_MAKS, PORSI_AWAL, sarankanSablon, type AturanSablon } from '../sablon/saran';
import {
  INDEKS_DASAR,
  gantiHexWarna,
  geserPegangan,
  keadaanDariHex,
  susunHarmoni,
  ubahKecerahan,
  type AturanHarmoni,
  type KeadaanPalet,
} from './harmoni';
import { porsiDariBagian } from './gambar';
import { deltaE2000, hexKeLab, type WarnaPantone } from './pantone';
import { hexKeHsb, normalisasiHex, putarSudut, type Hsb } from './warna';

/**
 * Satu palet, dua kegunaan.
 *
 * Tanpa kain: lima warna dari roda, disusun aturan harmoni — palet feed,
 * poster, apa saja. Dengan kain: warna palet ADALAH warna sablon (1–6), tiap
 * warna membawa porsinya di desain, dan sarannya datang dari kain.
 *
 * Dulu keduanya dua halaman. Disatukan karena di pekerjaan tim keduanya satu
 * hal: menyusun warna untuk desain yang dicetak di kain. Semua perpindahan
 * keadaan ada di sini, murni, supaya aturan terpentingnya bisa diuji: saran
 * dari kain tidak pernah menimpa suntingan tangan DIAM-DIAM — mengganti kain
 * atau jumlah warna membiarkannya. Hanya permintaan eksplisit yang menimpa:
 * memilih aturan harmoni, atau "Sarankan ulang dari kain".
 */
export type Palet = KeadaanPalet & {
  /** Hex kain, atau `null` untuk palet bebas. */
  kain: string | null;
  /** Porsi tiap warna di desain, sejajar dengan `warna`. Hanya untuk palet berkain. */
  porsi: number[] | null;
  /**
   * `true` selama warna dan porsi masih persis saran dari kain. Selama itu,
   * mengganti kain atau jumlah memperbarui sarannya; begitu satu hal disunting,
   * keduanya berhenti menyentuh warna. Memilih aturan selalu menyusun saran baru.
   */
  saranUtuh: boolean;
};

export const JUMLAH_SABLON_AWAL = 3;

export function paletBebas(aturan: AturanHarmoni, warna: Hsb[]): Palet {
  return { aturan, warna, kain: null, porsi: null, saranUtuh: false };
}

/** Kain tidak bisa diberi saran "bebas": Custom dipetakan ke aturan yang punya bentuk. */
export function aturanSablonDari(aturan: AturanHarmoni): AturanSablon {
  return aturan === 'CUSTOM' ? 'COMPLEMENTARY' : aturan;
}

function sarankan(p: Palet, katalog: readonly WarnaPantone[], jumlah: number): Palet {
  if (!p.kain) return p;
  const aturan = aturanSablonDari(p.aturan);
  const saran = sarankanSablon({ kainHex: p.kain, jumlah, aturan, katalog });
  return {
    aturan,
    warna: saran.map((s) => hexKeHsb(s.warna.hex)),
    kain: p.kain,
    porsi: saran.map((s) => s.porsi),
    saranUtuh: true,
  };
}

/** Saran baru dari kain, atas permintaan — bersama memilih aturan, jalan untuk menimpa suntingan. */
export function sarankanDariKain(p: Palet, katalog: readonly WarnaPantone[]): Palet {
  return sarankan(p, katalog, p.warna.length);
}

export function pasangKain(p: Palet, kainHex: string, katalog: readonly WarnaPantone[]): Palet {
  const kain = normalisasiHex(kainHex);
  if (!kain) return p;
  if (p.kain === null) return sarankan({ ...p, kain }, katalog, JUMLAH_SABLON_AWAL);
  if (p.saranUtuh) return sarankan({ ...p, kain }, katalog, p.warna.length);
  return { ...p, kain };
}

/**
 * Kembali ke palet bebas. Tinta dominan (warna pertama) menjadi dasar harmoni,
 * jadi rona utamanya tidak hilang.
 */
export function lepasKain(p: Palet): Palet {
  if (p.kain === null) return p;
  const aturan: AturanHarmoni = p.aturan === 'CUSTOM' ? 'ANALOGOUS' : p.aturan;
  return paletBebas(aturan, susunHarmoni(aturan, p.warna[0] ?? hexKeHsb('#e8553d'), []));
}

export function pilihAturanPalet(p: Palet, aturan: AturanHarmoni, katalog: readonly WarnaPantone[]): Palet {
  if (p.kain === null) {
    return { ...p, aturan, warna: susunHarmoni(aturan, p.warna[INDEKS_DASAR], p.warna) };
  }
  // Selalu, juga sesudah disunting: orang yang memilih "Triad" meminta warna
  // triad. Dulu suntingan membuat pilihan ini diam, dan terlihat rusak.
  return sarankan({ ...p, aturan: aturanSablonDari(aturan) }, katalog, p.warna.length);
}

/** Komposisi dari galeri rekomendasi dipasang apa adanya — pilihan orang, jadi tidak ditimpa saran berikutnya. */
export function terapkanKomposisi(p: Palet, komposisi: { tinta: readonly { hex: string; porsi: number }[] }): Palet {
  if (p.kain === null || komposisi.tinta.length === 0) return p;
  const tinta = komposisi.tinta.slice(0, JUMLAH_SABLON_MAKS);
  return { ...p, warna: tinta.map((t) => hexKeHsb(t.hex)), porsi: tinta.map((t) => t.porsi), saranUtuh: false };
}

export function ubahJumlahSablon(p: Palet, jumlah: number, katalog: readonly WarnaPantone[]): Palet {
  if (p.kain === null) return p;
  const n = Math.min(JUMLAH_SABLON_MAKS, Math.max(1, Math.round(jumlah)));
  if (n === p.warna.length) return p;
  if (p.saranUtuh) return sarankan(p, katalog, n);

  let warna = p.warna.slice(0, n);
  if (n > p.warna.length) {
    // Tambahan diambil dari saran untuk kain ini, dilewati yang sudah ada —
    // warna yang sudah disetel tangan tetap di tempatnya.
    const ada = new Set(p.warna.map((w) => hexKeHsbKunci(w)));
    const calon = sarankanSablon({ kainHex: p.kain, jumlah: JUMLAH_SABLON_MAKS, aturan: aturanSablonDari(p.aturan), katalog });
    warna = [...p.warna];
    for (const c of calon) {
      if (warna.length >= n) break;
      const hsb = hexKeHsb(c.warna.hex);
      if (!ada.has(hexKeHsbKunci(hsb))) warna.push(hsb);
    }
  }
  return { ...p, warna, porsi: PORSI_AWAL[warna.length], saranUtuh: false };
}

function hexKeHsbKunci(w: Hsb): string {
  return `${putarSudut(w.h).toFixed(3)}|${w.s.toFixed(4)}|${w.b.toFixed(4)}`;
}

export function hapusWarnaSablon(p: Palet, indeks: number): Palet {
  if (p.kain === null || p.warna.length <= 1 || indeks < 0 || indeks >= p.warna.length) return p;
  const warna = p.warna.filter((_, i) => i !== indeks);
  return { ...p, warna, porsi: PORSI_AWAL[warna.length], saranUtuh: false };
}

export function ubahPorsiPalet(p: Palet, indeks: number, nilai: number): Palet {
  if (!p.porsi) return p;
  const porsi = p.porsi.map((x, i) => (i === indeks ? Math.min(100, Math.max(0, Math.round(nilai))) : x));
  return { ...p, porsi, saranUtuh: false };
}

/*
 * Tiga jalan menyunting satu warna. Di palet bebas, aturan harmoni tetap
 * berlaku seperti sebelumnya (pegangan memutar seluruh harmoni). Di palet
 * berkain tidak ada harmoni yang dipegang — setiap tinta berdiri sendiri,
 * dan aturan hanya dipakai saat meminta saran.
 */

function sunting(p: Palet, indeks: number, warna: Hsb): Palet {
  return { ...p, warna: p.warna.map((w, i) => (i === indeks ? warna : w)), saranUtuh: false };
}

function lewatHarmoni(p: Palet, ubah: (k: KeadaanPalet) => KeadaanPalet): Palet {
  const hasil = ubah({ aturan: p.aturan, warna: p.warna });
  return hasil.aturan === p.aturan && hasil.warna === p.warna ? p : { ...p, ...hasil };
}

export function geserPeganganPalet(p: Palet, indeks: number, h: number, s: number): Palet {
  if (p.kain === null) return lewatHarmoni(p, (k) => geserPegangan(k, indeks, h, s));
  return sunting(p, indeks, { ...p.warna[indeks], h: putarSudut(h), s: Math.min(1, Math.max(0, s)) });
}

/**
 * Tinta berkain yang terhubung: menggeser satu pegangan memutar SEMUA tinta
 * dengan sudut yang sama, dan jaraknya ke tengah menskalakan kepekatan semua
 * tinta sebanding — jarak antartinta di roda tetap, seperti harmoni di Adobe.
 * Kain tidak ikut berputar: ia kainnya, bukan tinta.
 */
export function geserSemuaTinta(p: Palet, indeks: number, h: number, s: number): Palet {
  if (p.kain === null) return geserPeganganPalet(p, indeks, h, s);
  const acuan = p.warna[indeks];
  if (!acuan) return p;
  const dh = h - acuan.h;
  const pekat = Math.min(1, Math.max(0, s));
  // Tinta abu-abu tidak punya kepekatan untuk dijadikan pembanding.
  const faktor = acuan.s > 0.02 ? pekat / acuan.s : null;
  return {
    ...p,
    warna: p.warna.map((w, i) =>
      i === indeks
        ? { ...w, h: putarSudut(h), s: pekat }
        : { ...w, h: putarSudut(w.h + dh), s: faktor === null ? w.s : Math.min(1, Math.max(0, w.s * faktor)) },
    ),
    saranUtuh: false,
  };
}

export function ubahKecerahanPalet(p: Palet, indeks: number, b: number): Palet {
  if (p.kain === null) return lewatHarmoni(p, (k) => ubahKecerahan(k, indeks, b));
  return sunting(p, indeks, { ...p.warna[indeks], b: Math.min(1, Math.max(0, b)) });
}

export function gantiHexPalet(p: Palet, indeks: number, hex: string): Palet {
  if (p.kain === null) return lewatHarmoni(p, (k) => gantiHexWarna(k, indeks, hex));
  const bersih = normalisasiHex(hex);
  if (!bersih) return p;
  const baru = hexKeHsb(bersih);
  if (baru.s === 0) baru.h = p.warna[indeks].h;
  return sunting(p, indeks, baru);
}

export function dariTersimpan(baris: {
  aturan: AturanHarmoni;
  warna: string[];
  kain: string | null;
  porsi: number[] | null;
}): Palet {
  const dasar = keadaanDariHex(baris.aturan, baris.warna);
  if (!baris.kain) return paletBebas(dasar.aturan, dasar.warna);
  return {
    ...dasar,
    kain: baris.kain,
    porsi: baris.porsi && baris.porsi.length === baris.warna.length ? baris.porsi : PORSI_AWAL[baris.warna.length] ?? null,
    saranUtuh: false,
  };
}

/** Warna gambar yang ΔE-nya lebih kecil dari ini terhadap kain dianggap kain itu sendiri. */
const DE_SAMA_DENGAN_KAIN = 6;

/**
 * Mengisi palet dengan warna yang diambil dari gambar.
 *
 * Palet bebas butuh tepat lima: lima warna pertama dipakai dan aturannya
 * dilepas ke Custom, karena warnanya datang dari gambar, bukan dari roda.
 * Palet berkain: warna yang nyaris sama dengan kain dilewati — di foto kaos,
 * warna terbanyak hampir selalu kainnya sendiri, dan mencetak kain di atas
 * kain tidak ada artinya. Sisanya (paling banyak enam) menjadi tinta, dengan
 * porsi dari luasnya di gambar bila diketahui.
 */
export function isiDariGambar(p: Palet, warna: readonly { hex: string; bagian?: number }[]): Palet {
  const sah = warna.flatMap((w) => {
    const hex = normalisasiHex(w.hex);
    return hex ? [{ hex, bagian: w.bagian }] : [];
  });

  if (p.kain === null) {
    if (sah.length < 5) return p;
    return paletBebas('CUSTOM', sah.slice(0, 5).map((w) => hexKeHsb(w.hex)));
  }

  const labKain = hexKeLab(p.kain);
  const tinta = sah.filter((w) => deltaE2000(hexKeLab(w.hex), labKain) >= DE_SAMA_DENGAN_KAIN).slice(0, JUMLAH_SABLON_MAKS);
  if (tinta.length === 0) return p;
  const adaLuas = tinta.every((w) => typeof w.bagian === 'number' && w.bagian > 0);
  return {
    ...p,
    warna: tinta.map((w) => hexKeHsb(w.hex)),
    porsi: adaLuas ? porsiDariBagian(tinta.map((w) => w.bagian as number)) : PORSI_AWAL[tinta.length],
    saranUtuh: false,
  };
}
