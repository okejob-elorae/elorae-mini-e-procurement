/**
 * Anomali akun KOL dari riwayat catatan pengikut — murni, aman untuk klien.
 *
 * Keputusan sementara P6 (ingatkan pemilik):
 *   - pengikut naik lebih dari `naikPengikutPersen`% dibanding catatan
 *     SEBELUMNYA yang berjarak paling lama `naikPengikutHari` hari (indikasi
 *     beli pengikut);
 *   - ER akun turun lebih dari `turunErPersen`% dibanding catatan sebelumnya
 *     yang PUNYA ER (catatan manual tanpa ER dilewati).
 * Yang dinilai selalu catatan TERBARU; anomali lama hilang begitu catatan
 * berikutnya masuk. Tidak ada yang disimpan.
 */

import type { PengaturanPantau } from "./pantau-aturan";

export type CatatanAnomali = { recordedAt: Date | string; followers: number; er: number | null };

export type PerubahanAnomali = { dari: number; ke: number; persen: number };

export type HasilAnomali = {
  pengikut: PerubahanAnomali | null;
  er: PerubahanAnomali | null;
  /** Waktu catatan terbaru yang dinilai. */
  terbaru: Date | null;
};

const HARI_MS = 86_400_000;
const bulat1 = (n: number) => Math.round(Number((n * 10).toFixed(4))) / 10;

export function cekAnomaliAkun(
  catatan: readonly CatatanAnomali[],
  ambang: Pick<PengaturanPantau, "naikPengikutPersen" | "naikPengikutHari" | "turunErPersen">,
): HasilAnomali {
  const urut = catatan
    .map((c) => ({ ...c, waktu: new Date(c.recordedAt) }))
    .filter((c) => !Number.isNaN(c.waktu.getTime()))
    .sort((a, b) => a.waktu.getTime() - b.waktu.getTime());
  const akhir = urut.at(-1);
  if (!akhir) return { pengikut: null, er: null, terbaru: null };
  const sebelum = urut.slice(0, -1);

  let pengikut: PerubahanAnomali | null = null;
  const lalu = sebelum.at(-1);
  if (lalu && lalu.followers > 0 && akhir.waktu.getTime() - lalu.waktu.getTime() <= ambang.naikPengikutHari * HARI_MS) {
    const persen = ((akhir.followers - lalu.followers) / lalu.followers) * 100;
    if (persen > ambang.naikPengikutPersen) pengikut = { dari: lalu.followers, ke: akhir.followers, persen: bulat1(persen) };
  }

  let er: PerubahanAnomali | null = null;
  const laluEr = [...sebelum].reverse().find((c) => c.er !== null && c.er > 0);
  if (akhir.er !== null && laluEr && laluEr.er !== null) {
    const persen = ((laluEr.er - akhir.er) / laluEr.er) * 100;
    if (persen > ambang.turunErPersen) er = { dari: laluEr.er, ke: akhir.er, persen: bulat1(persen) };
  }

  return { pengikut, er, terbaru: akhir.waktu };
}
