/**
 * Jarak tepi kolom pertama dan terakhir tabel.
 *
 * Kartu kantor membuang jarak samping isinya bila isinya tabel (globals.css),
 * supaya garis baris menyentuh tepi kartu. Tanpa pengganti, isi kolom pertama
 * hanya berjarak 8px dari tepi sementara judul kartu menjorok sejauh jarak
 * kartu — "FABRIC" tampak menempel (pemilik, 2026-10-08). Sel pertama dan
 * terakhir memakai `--tabel-tepi`, yang globals.css isi dengan jarak kartu
 * hanya untuk tabel yang menempel ke kartu; di tempat lain cadangannya 0.5rem,
 * sama dengan jarak sel bawaan, jadi tidak ada yang berubah.
 *
 * Sel yang memasang jarak sampingnya sendiri (baris anak yang menjorok,
 * `pl-6`, `px-4`…) tidak diberi kelas ini: kelas berawalan `first:` lebih kuat
 * daripada `pl-6` biasa dan akan menghapus jarak yang disengaja itu.
 */

export const KELAS_TEPI_AWAL = "first:ps-[var(--tabel-tepi,0.5rem)]";
export const KELAS_TEPI_AKHIR = "last:pe-[var(--tabel-tepi,0.5rem)]";

const AWALAN_KIRI = ["p", "px", "pl", "ps"];
const AWALAN_KANAN = ["p", "px", "pr", "pe"];

/** Kelas tepi untuk satu sel, mengalah pada jarak samping yang dipasang pemanggil. */
export function kelasTepiSel(className: string | undefined): string {
  const kelas = (className ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((k) => k.slice(k.lastIndexOf(":") + 1).replace(/^!/, ""));
  const punya = (awalan: string[]) => kelas.some((k) => awalan.some((a) => k.startsWith(`${a}-`)));
  return [punya(AWALAN_KIRI) ? "" : KELAS_TEPI_AWAL, punya(AWALAN_KANAN) ? "" : KELAS_TEPI_AKHIR]
    .filter(Boolean)
    .join(" ");
}
