/**
 * "HAUS ELORAÉ" — pertunjukan 3D sesudah masuk (pilihan pemilik 2026-10-01,
 * dari tiga opsi bergaya Gentle Monster). Bagian murni: lini waktu, pelonggaran,
 * pencampuran warna tema, dan jarak kamera — diuji tanpa WebGL.
 *
 * Adegannya: ruang galeri redup (mulai dari warna latar dasbor, bukan hitam)
 * → lampu sorot menyala, patung krom "bernapas"
 * dengan tiga cincin kinetik → huruf E-L-O-R-A-É 3D mengorbit → terbang
 * menyusun nama di depan patung, cincin berhenti menjadi lingkaran → keterangan
 * pameran di sudut (tanpa salam) → kamera menembus lingkaran ke warna latar
 * aplikasi.
 *
 * Warna ruangannya MENGIKUTI TEMA pengguna (latar, teks, warna utama, terang
 * atau gelap), dibaca dari variabel CSS yang dipasang `ThemeColorProvider`.
 */

/** Panjang pertunjukan. */
export const DURASI_HAUS_MS = 11_000;

/** Babak, dalam milidetik. Lihat `HausElorae.tsx` untuk yang terjadi di tiap babak. */
export const WAKTU = {
  nyala: [0, 1800],
  hurufMuncul: 2000,
  hurufJeda: 170,
  susun: [5200, 7800],
  cincinSejajar: [5600, 8000],
  buka: 9800,
  putih: [10_200, 10_650],
  app: [10_650, 11_000],
} as const;

/** Lewati: lompat ke babak menembus lingkaran. */
export const LEWATI_KE_MS = WAKTU.buka;

/** Tombol "Lewati" muncul sesudah ini. */
export const LEWATI_TAMPIL_MS = 1200;

/**
 * Bingkai yang macet (dasbor sedang dirender di bawah, peramban sibuk) tidak boleh melompati
 * babak: waktu pertunjukan maju paling banyak sebesar ini per bingkai, jadi sesudah macet
 * gerakannya berlanjut, bukan meloncat setengah detik ke depan.
 */
export const MAKS_LANGKAH_MS = 50;
/** …tetapi tidak pernah tertinggal dari jam dinding lebih dari ini, supaya perangkat lambat tidak menahan pengguna. */
export const MAKS_TERTINGGAL_MS = 3000;

/**
 * Waktu pertunjukan untuk bingkai ini. `tm` = waktu pertunjukan bingkai lalu, `dt` = jarak
 * bingkai di jam dinding, `nyata` = lama sejak mulai di jam dinding. Sesudah Lewati
 * pertunjukan berjalan 1,25× lebih cepat (lompatan ke `LEWATI_KE_MS` dilakukan pemanggil).
 */
export function majuWaktu(k: { tm: number; dt: number; nyata: number; lewati: boolean }): number {
  const laju = k.lewati ? 1.25 : 1;
  const maju = k.tm + Math.min(Math.max(k.dt, 0), MAKS_LANGKAH_MS) * laju;
  return Math.min(DURASI_HAUS_MS, Math.max(maju, k.nyata - MAKS_TERTINGGAL_MS));
}

/** Bingkai yang ditunggu sebelum memutuskan mutu gambar. */
export const BINGKAI_UJI_MUTU = 24;
/** Jarak bingkai di atas ini (± di bawah 40 bingkai per detik) = gambar diturunkan. */
const BATAS_BINGKAI_LAMBAT_MS = 25;
/** Jeda lebih panjang dari ini bukan ukuran kecepatan gambar (tab tersembunyi, macet sekali). */
const ABAIKAN_JEDA_MS = 250;

/**
 * Perangkat ini terlalu lambat untuk gambar penuh? Median jarak bingkai dari `BINGKAI_UJI_MUTU`
 * bingkai pertama yang wajar; "BELUM" selama bingkainya belum cukup. Pemanggil menurunkan
 * kerapatan piksel sekali saja — di babak awal, saat lampu baru menyala dan perubahannya
 * tidak terlihat.
 */
export function keputusanMutu(selang: readonly number[]): "BELUM" | "PENUH" | "TURUNKAN" {
  const wajar = selang.filter((d) => d > 0 && d < ABAIKAN_JEDA_MS).slice(0, BINGKAI_UJI_MUTU);
  if (wajar.length < BINGKAI_UJI_MUTU) return "BELUM";
  const urut = [...wajar].sort((a, b) => a - b);
  const tengah = (urut[(urut.length - 1) >> 1] + urut[urut.length >> 1]) / 2;
  return tengah > BATAS_BINGKAI_LAMBAT_MS ? "TURUNKAN" : "PENUH";
}

export const jepit = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const fase = (t: number, a: number, b: number) => jepit((t - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const pelan = {
  masukKeluar: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  keluar: (t: number) => 1 - Math.pow(1 - t, 3),
  keluarEkspo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  masuk: (t: number) => t * t * t,
};

/** "#rrggbb" → [r, g, b] 0–255. Selain heks enam digit → null. */
export function uraiHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const keHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(jepit(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

/** Campur dua warna heks; t = 0 → a, t = 1 → b. Warna yang tidak terbaca dianggap a. */
export function campurHex(a: string, b: string, t: number): string {
  const x = uraiHex(a) ?? [0, 0, 0];
  const y = uraiHex(b) ?? x;
  return keHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
}

/** Kecerahan relatif (WCAG) 0–1. */
export function kecerahan(hex: string): number {
  const c = uraiHex(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rasio kontras WCAG antara dua warna (1–21). */
export function rasioKontras(a: string, b: string): number {
  const x = kecerahan(a);
  const y = kecerahan(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Kontras minimum wordmark terhadap dinding galeri. */
export const KONTRAS_HURUF = 3;

/** Wordmark di ruang TERANG: hitam (krom hitam), atas permintaan pemilik. */
export const HURUF_TERANG = "#141416";

/**
 * Warna wordmark (permintaan pemilik, 2026-10-01): HITAM kalau tema terang,
 * warna utama tema kalau tema gelap. Di ruang gelap, warna tema yang terlalu
 * gelap untuk dindingnya diterangkan seperlunya sampai kontrasnya cukup, jadi
 * coraknya tetap warna tema. Tidak pernah lebih dari 75%.
 */
export function warnaHurufTema(utama: string, dinding: string, gelap: boolean): string {
  if (!gelap) return HURUF_TERANG;
  if (rasioKontras(utama, dinding) >= KONTRAS_HURUF) return utama;
  const tujuan = "#ffffff";
  for (let k = 0.05; k <= 0.75; k += 0.05) {
    const c = campurHex(utama, tujuan, k);
    if (rasioKontras(c, dinding) >= KONTRAS_HURUF) return c;
  }
  return campurHex(utama, tujuan, 0.75);
}

/** "rgb(12, 34, 56)" / "rgba(…)" → "#0c2238"; selain itu null. */
export function rgbKeHex(css: string): string | null {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css.trim());
  return m ? keHex(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export type TemaHaus = {
  /** Latar dasbor — juga warna akhir layar sebelum aplikasi tampil. */
  latar: string;
  /** Warna teks utama dasbor. */
  teks: string;
  /** Warna redup (keterangan, tanggal). */
  redup: string;
  /** Warna utama tema pengguna. */
  utama: string;
};

export type WarnaRuang = {
  gelap: boolean;
  dinding: string;
  lantai: string;
  alas: string;
  huruf: string;
  cincinAksen: string;
  sorot: string;
  /** Warna bingkai pertama = latar dasbor, sama dengan penutup polos sebelumnya. */
  awal: string;
};

/**
 * Warna ruangan galeri dari tema. Ruang gelap kalau latar dasbor gelap. Dinding
 * = latar diwarnai sedikit warna utama; wordmark = hitam di ruang terang,
 * warna utama tema di ruang gelap (lihat `warnaHurufTema`); satu cincin dicat
 * warna utama.
 */
export function warnaRuang(tema: TemaHaus): WarnaRuang {
  const gelap = kecerahan(tema.latar) < 0.35;
  const dinding = campurHex(campurHex(tema.latar, gelap ? "#000000" : "#d8d6cf", gelap ? 0.35 : 0.35), tema.utama, 0.06);
  return {
    gelap,
    dinding,
    lantai: campurHex(dinding, gelap ? "#000000" : "#b9b5ab", 0.18),
    alas: campurHex(tema.latar, gelap ? "#2a2a2e" : "#ffffff", 0.5),
    huruf: warnaHurufTema(tema.utama, dinding, gelap),
    cincinAksen: tema.utama,
    sorot: campurHex("#ffffff", tema.utama, 0.08),
    awal: tema.latar,
  };
}

/**
 * Jarak kamera supaya nama (lebar `lebarNama` satuan 3D) selalu muat di layar —
 * di HP (potret) kamera mundur lebih jauh. Tidak pernah lebih dekat dari `min`.
 */
export function jarakKamera(lebarNama: number, fovDerajat: number, aspek: number, min = 6.2): number {
  const setengah = lebarNama / 2 + 0.45;
  const tan = Math.tan((fovDerajat * Math.PI) / 360);
  return Math.max(min, 2.6 + setengah / (tan * Math.max(0.1, aspek)));
}
