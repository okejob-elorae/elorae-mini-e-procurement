import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';

/**
 * Warna tema yang benar-benar dipakai seseorang.
 *
 * Urutannya: warna PRIBADI, lalu warna PERUSAHAAN, lalu bawaan. Warna perusahaan
 * ada supaya aplikasi HP salesman dan SPG — yang tidak punya layar pengaturan
 * sampai sekarang — tampil dengan warna merek tanpa tiap orang harus memilih;
 * warna pribadi tetap menang, karena pemilik memutuskan siapa pun boleh
 * mengganti warnanya sendiri.
 *
 * "Punya warna pribadi" dibaca dari warnanya, BUKAN dari ada-tidaknya kode
 * Pantone: palet populer (Nord, Dracula, …) tidak punya kode, dan membacanya
 * sebagai "belum memilih" diam-diam membuang pilihan itu. Harga yang diterima:
 * orang yang sengaja memilih persis warna bawaan terbaca belum memilih.
 */

export const KUNCI_WARNA_PERUSAHAAN = 'theme.companyColor';

export type WarnaTersimpan = { hex: string; tcx?: string | null; name?: string | null };
export type SumberWarna = 'pribadi' | 'perusahaan' | 'bawaan';
export type WarnaEfektif = { sumber: SumberWarna; hex: string; tcx: string | null; name: string | null };

const HEX = /^#?[0-9a-fA-F]{6}$/;
const rapikan = (hex: string) => (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase();

export function punyaWarnaPribadi(hex: string): boolean {
  return rapikan(hex) !== DEFAULT_THEME_PRIMARY_COLOR.toLowerCase();
}

export function tentukanWarnaTema(pribadi: WarnaTersimpan, perusahaan: WarnaTersimpan | null): WarnaEfektif {
  if (punyaWarnaPribadi(pribadi.hex)) {
    return { sumber: 'pribadi', hex: rapikan(pribadi.hex), tcx: pribadi.tcx ?? null, name: pribadi.name ?? null };
  }
  if (perusahaan) {
    return {
      sumber: 'perusahaan',
      hex: rapikan(perusahaan.hex),
      tcx: perusahaan.tcx ?? null,
      name: perusahaan.name ?? null,
    };
  }
  return { sumber: 'bawaan', hex: DEFAULT_THEME_PRIMARY_COLOR, tcx: null, name: null };
}

/**
 * Nilai `SystemSetting` → warna perusahaan, atau null. Nilai yang rusak dibaca
 * sebagai "tidak ada", bukan dilempar: warna yang salah simpan tidak boleh
 * membuat setiap halaman gagal dimuat.
 */
export function bacaWarnaPerusahaan(nilai: string | null | undefined): WarnaTersimpan | null {
  if (!nilai) return null;
  try {
    const x = JSON.parse(nilai) as Partial<WarnaTersimpan>;
    if (typeof x?.hex !== 'string' || !HEX.test(x.hex.trim())) return null;
    return {
      hex: rapikan(x.hex.trim()),
      tcx: typeof x.tcx === 'string' && x.tcx ? x.tcx : null,
      name: typeof x.name === 'string' && x.name ? x.name : null,
    };
  } catch {
    return null;
  }
}
