import { hexKeRgb } from './warna';

/**
 * Pencarian dan padanan Pantone untuk roda palet.
 *
 * Dua pustaka:
 * - **Coated C** (`pantone-c.json`, 3.219 warna) — diekstrak dari katalog PDF
 *   Coated C milik tim lewat Pantone Studio (`tools/build_data.py`). Hex-nya
 *   adalah padanan layar yang tercetak di katalog itu.
 * - **TCX** — tabel `PantoneColor` Elorae (2.800 warna), sumber yang sama
 *   dengan layar warna produksi.
 *
 * Jarak warna memakai CIEDE2000, sama dengan Pantone Studio, BUKAN CIE76 yang
 * dipakai layar warna produksi Elorae. Tim membandingkan hasil di sini dengan
 * Pantone Studio; dua rumus berbeda membuat ΔE untuk warna yang sama tampak
 * tidak cocok di antara dua alat.
 */

export type JenisPantone = 'C' | 'TCX';

export type Lab = [number, number, number];

export type WarnaPantone = {
  jenis: JenisPantone;
  kode: string;
  /** Nama TCX ("Greenery"). Warna C tidak punya nama di luar kodenya. */
  nama: string | null;
  hex: string;
  lab: Lab;
  /** Kode tanpa akhiran jenis, tanpa spasi dan tanda hubung: `186`, `warmred`, `150343`. */
  kunci: string;
  /** Teks yang dicocokkan untuk pencarian nama, huruf kecil. */
  teks: string;
};

/** Kanal sRGB 0–255 → cahaya linear 0–1. */
export function keLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Cahaya linear 0–1 → kanal sRGB 0–255 (belum dibulatkan). */
export function dariLinear(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
}

/** sRGB → CIE Lab (D65), rumus yang sama dengan Pantone Studio. */
export function hexKeLab(hex: string): Lab {
  const { r, g, b } = hexKeRgb(hex);
  return linearKeLab(keLinear(r), keLinear(g), keLinear(b));
}

/**
 * Cahaya linear → Lab, tanpa melewati hex. Dipakai pencari resep campur yang
 * menilai puluhan ribu campuran: membulatkan tiap campuran ke hex dulu
 * membuang presisi dan waktu.
 */
export function linearKeLab(R: number, G: number, B: number): Lab {
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000. Di bawah ~2 praktis tidak terlihat mata. */
export function deltaE2000(l1: Lab, l2: Lab): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const C7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 6103515625)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = (Math.atan2(b1, ap1) * deg + 360) % 360;
  const hp2 = (Math.atan2(b2, ap2) * deg + 360) % 360;

  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);

  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Cp7 = Cpbar ** 7;
  const Rt = -2 * Math.sqrt(Cp7 / (Cp7 + 6103515625)) * Math.sin(60 * Math.exp(-(((hbar - 275) / 25) ** 2)) * rad);

  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

function padatkan(s: string): string {
  return s.toLowerCase().replace(/[\s-]/g, '');
}

function buangAkhiran(kode: string, jenis: JenisPantone): string {
  return jenis === 'C' ? kode.replace(/\s*c$/i, '') : kode.replace(/\s*tcx$/i, '');
}

/** `[kode, hex]` untuk C, `[kode, hex, nama]` untuk TCX. */
export function siapkanKatalog(
  jenis: JenisPantone,
  entri: ReadonlyArray<readonly [string, string, (string | null)?]>,
): WarnaPantone[] {
  return entri.map(([kode, hex, nama]) => ({
    jenis,
    kode,
    nama: nama ?? null,
    hex: hex.toLowerCase(),
    lab: hexKeLab(hex),
    kunci: padatkan(buangAkhiran(kode, jenis)),
    teks: `${kode} ${nama ?? ''}`.toLowerCase(),
  }));
}

/**
 * Cari lewat kode atau nama, dengan cara orang biasa mengetiknya: `186`,
 * `186c`, `PANTONE 186 C`, `15-0343`, `150343`, `greenery`.
 *
 * Urutan: kode persis → kode berawalan sama → nama berawalan sama → nama
 * memuat. Kueri yang hanya berisi angka dianggap KODE dan tidak dicocokkan di
 * tengah teks — mengetik `186` tidak sedang mencari `2186 C`.
 */
export function cariPantone(katalog: readonly WarnaPantone[], kueri: string, batas = 8): WarnaPantone[] {
  const mentah = kueri.trim().toLowerCase().replace(/^pantone\s*/, '');
  if (!mentah) return [];
  const jenis = katalog[0]?.jenis ?? 'C';
  const tanpaAkhiran = buangAkhiran(mentah, jenis) || mentah;
  const kunci = padatkan(tanpaAkhiran);
  if (!kunci) return [];
  const bolehDiTengah = /[a-z]/.test(kunci);

  const peringkat: { warna: WarnaPantone; nilai: number; urutan: number }[] = [];
  katalog.forEach((warna, urutan) => {
    let nilai = -1;
    if (warna.kunci === kunci) nilai = 0;
    else if (warna.kunci.startsWith(kunci)) nilai = 1;
    else if (warna.nama?.toLowerCase().startsWith(tanpaAkhiran)) nilai = 2;
    else if (bolehDiTengah && (warna.teks.includes(tanpaAkhiran) || warna.kunci.includes(kunci))) nilai = 3;
    if (nilai >= 0) peringkat.push({ warna, nilai, urutan });
  });
  peringkat.sort((a, b) => a.nilai - b.nilai || a.urutan - b.urutan);
  return peringkat.slice(0, batas).map((p) => p.warna);
}

/**
 * Pantone terdekat menurut mata — CIEDE2000 ke SETIAP warna katalog.
 *
 * Sengaja tanpa penyaringan awal. Menyaring 16 kandidat lewat jarak Lab lurus
 * lalu memilih dengan CIEDE2000 pernah dicoba dan diukur pada data asli: dari
 * 6.000 pencarian acak, 264 (4,4%) memberi kode yang berbeda, dengan selisih
 * ΔE sampai 3,2 — terlihat mata. Hitungan penuhnya hanya ~0,55 ms per katalog,
 * jadi tidak ada yang perlu dihemat.
 */
export function pantoneTerdekat(
  katalog: readonly WarnaPantone[],
  hex: string,
): { warna: WarnaPantone; deltaE: number } | null {
  const lab = hexKeLab(hex);
  let hasil: { warna: WarnaPantone; deltaE: number } | null = null;
  for (const warna of katalog) {
    const deltaE = deltaE2000(lab, warna.lab);
    if (!hasil || deltaE < hasil.deltaE) hasil = { warna, deltaE };
  }
  return hasil;
}
