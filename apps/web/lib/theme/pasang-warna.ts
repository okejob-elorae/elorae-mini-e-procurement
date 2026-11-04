import { generatePaletteFromSeed } from '@/lib/theme/generate-palette-from-seed';
import { applyDefaultTheme, applyThemeFromPantoneSeed } from '@/lib/theme/theme-color';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';
import { saveThemeToLocalStorage } from '@/lib/theme/theme-storage';
import type { WarnaEfektif } from '@/lib/theme/warna-efektif';

/**
 * Pasang warna efektif di layar, lalu simpan ke perangkat supaya skrip awal
 * halaman (`theme-init-script`) langsung melukis warna yang benar pada muat
 * berikutnya, tanpa berkedip dulu ke abu-biru bawaan.
 *
 * SATU tempat, dipakai penerap tema global, layar Pengaturan, dan layar
 * Tampilan di aplikasi HP — tiga salinan sebelumnya sudah sempat berselisih
 * soal kapan sebuah warna dianggap "bawaan".
 */
export function pasangWarnaEfektif(efektif: WarnaEfektif, userId: string | null, simpan = true): void {
  if (efektif.sumber === 'bawaan') {
    applyDefaultTheme();
    if (simpan) {
      saveThemeToLocalStorage(
        { primary: DEFAULT_THEME_PRIMARY_COLOR, pantoneTcx: null, seedHex: DEFAULT_THEME_PRIMARY_COLOR },
        userId,
      );
    }
    return;
  }
  const palette = generatePaletteFromSeed(efektif.hex);
  applyThemeFromPantoneSeed(efektif.hex, palette);
  if (simpan) {
    saveThemeToLocalStorage({ primary: efektif.hex, pantoneTcx: efektif.tcx, seedHex: efektif.hex, palette }, userId);
  }
}
