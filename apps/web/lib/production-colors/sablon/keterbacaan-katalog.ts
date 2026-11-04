import { KELUARGA_WARNA, keluargaWarna, type KeluargaWarna } from '../palet/katalog';
import { rasioKontras } from '../palet/kontras';
import { cariPantone, pantoneKhusus, type WarnaPantone } from '../palet/pantone';
import { keterbacaanSablon, type KeterbacaanSablon } from './saran';

/**
 * Seluruh buku Pantone C dinilai terhadap satu kain: rasio kontras tiap warna
 * sebagai tulisan di atas kain itu, dengan skala keterbacaan sablon yang sama
 * dengan baris tinta. Ini jawaban langsung untuk "warna mana yang terbaca kuat"
 * — orang melihat angkanya sendiri, bukan menunggu saran ditebak.
 */

export type BarisKeterbacaan = {
  warna: WarnaPantone;
  rasio: number;
  baca: KeterbacaanSablon;
  keluarga: KeluargaWarna;
  /** Metalik atau neon — tinta khusus. */
  khusus: 'METALIK' | 'NEON' | null;
};

export const URUTAN_KETERBACAAN = ['KONTRAS', 'WARNA', 'KODE'] as const;
export type UrutanKeterbacaan = (typeof URUTAN_KETERBACAAN)[number];

export const TINGKAT_BACA: readonly KeterbacaanSablon[] = ['KUAT', 'CUKUP', 'LEMBUT', 'SAMAR'];

export function nilaiKatalogDiKain(katalog: readonly WarnaPantone[], kainHex: string): BarisKeterbacaan[] {
  return katalog.map((warna) => {
    const rasio = rasioKontras(warna.hex, kainHex);
    return { warna, rasio, baca: keterbacaanSablon(rasio), keluarga: keluargaWarna(warna.hex), khusus: pantoneKhusus(warna.kode) };
  });
}

export function hitungKeterbacaan(baris: readonly BarisKeterbacaan[]): Record<KeterbacaanSablon, number> {
  const hitung: Record<KeterbacaanSablon, number> = { KUAT: 0, CUKUP: 0, LEMBUT: 0, SAMAR: 0 };
  for (const b of baris) hitung[b.baca] += 1;
  return hitung;
}

/**
 * Baris yang tampil. Pencarian mempertahankan urutan relevansinya (kode yang
 * diketik muncul pertama); tanpa pencarian, urutannya pilihan orang: kontras
 * tertinggi dulu, per keluarga warna dari terang ke gelap, atau urutan buku.
 */
export function saringKeterbacaan(
  baris: readonly BarisKeterbacaan[],
  saring: {
    kueri: string;
    keluarga: KeluargaWarna | null;
    baca: KeterbacaanSablon | null;
    sembunyikanKhusus: boolean;
    urut: UrutanKeterbacaan;
  },
): BarisKeterbacaan[] {
  const lolos = (b: BarisKeterbacaan) =>
    (saring.keluarga === null || b.keluarga === saring.keluarga) &&
    (saring.baca === null || b.baca === saring.baca) &&
    (!saring.sembunyikanKhusus || b.khusus === null);

  if (saring.kueri.trim()) {
    const perKode = new Map(baris.map((b) => [b.warna.kode, b]));
    return cariPantone(
      baris.map((b) => b.warna),
      saring.kueri,
      Number.POSITIVE_INFINITY,
    ).flatMap((w) => {
      const b = perKode.get(w.kode);
      return b && lolos(b) ? [b] : [];
    });
  }

  const hasil = baris.filter(lolos);
  if (saring.urut === 'KONTRAS') return [...hasil].sort((a, b) => b.rasio - a.rasio);
  if (saring.urut === 'WARNA') {
    return hasil
      .map((b, i) => ({ b, i, k: KELUARGA_WARNA.indexOf(b.keluarga) }))
      .sort((x, y) => x.k - y.k || y.b.warna.lab[0] - x.b.warna.lab[0] || x.i - y.i)
      .map((x) => x.b);
  }
  return hasil;
}
