import type { TanggalMerah } from "@/lib/production/hari-kerja";

/*
 * Lead Time → Hari kerja & libur: bagian murni tab-nya (aman untuk klien,
 * tanpa Prisma). Daftar tanggal merah diubah di layar dulu, baru disimpan
 * sekali — karena setiap simpan menyusun ulang jadwal semua tahap terbuka.
 */

/** Hari dalam minggu, Minggu (0) sampai Sabtu (6) — sama dengan `Date.getUTCDay()`. */
export const SEMUA_HARI = [0, 1, 2, 3, 4, 5, 6] as const;

/** Gabungkan libur tanpa menggandakan tanggal; yang sudah ada tetap memakai namanya. Hasil urut tanggal. */
export function gabungLibur(lama: readonly TanggalMerah[], baru: readonly TanggalMerah[]): TanggalMerah[] {
  const ada = new Set(lama.map((l) => l.tanggal));
  const tambahan: TanggalMerah[] = [];
  for (const l of baru) {
    if (ada.has(l.tanggal)) continue;
    ada.add(l.tanggal);
    tambahan.push(l);
  }
  return [...lama, ...tambahan].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

/** Pilihan hari kerja sama dengan yang tersimpan (urutan tidak berpengaruh). */
export function samaHari(tersimpan: readonly number[], pilihan: ReadonlySet<number>): boolean {
  return new Set(tersimpan).size === pilihan.size && tersimpan.every((h) => pilihan.has(h));
}

/** Dua daftar tanggal merah (keduanya urut tanggal) sama persis, termasuk namanya. */
export function samaLibur(a: readonly TanggalMerah[], b: readonly TanggalMerah[]): boolean {
  return a.length === b.length && a.every((l, i) => l.tanggal === b[i].tanggal && l.nama === b[i].nama);
}

/**
 * Keterangan di samping "Simpan hari kerja" — tombol yang nonaktif selalu
 * menyebut alasannya. `galat` = tampil merah. `bolehSimpan` false = tombol nonaktif.
 */
export function keteranganSimpanHari(
  jumlahPilihan: number,
  berubah: boolean,
): { kunci: "hariMinimal" | "belumBerubah" | "belumDisimpan"; galat: boolean; bolehSimpan: boolean } {
  if (jumlahPilihan === 0) return { kunci: "hariMinimal", galat: true, bolehSimpan: false };
  if (!berubah) return { kunci: "belumBerubah", galat: false, bolehSimpan: false };
  return { kunci: "belumDisimpan", galat: false, bolehSimpan: true };
}
