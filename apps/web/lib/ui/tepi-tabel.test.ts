import { describe, expect, it } from "vitest";
import { KELAS_TEPI_AKHIR, KELAS_TEPI_AWAL, kelasTepiSel } from "./tepi-tabel";

/**
 * Tabel yang menempel ke tepi kartu (kartu kantor membuang jarak samping isi
 * kartu bila isinya tabel) memberi kolom pertama dan terakhir jarak setara tepi
 * kartu, supaya "FABRIC" sejajar dengan judul kartu dan tidak menempel ke
 * tepinya (pemilik, 2026-10-08). Sel yang sudah memasang jaraknya sendiri —
 * baris anak yang menjorok di laporan keuangan, umur utang — tidak disentuh.
 */
describe("kelasTepiSel", () => {
  it("sel biasa mendapat jarak tepi awal dan akhir", () => {
    expect(kelasTepiSel(undefined)).toBe(`${KELAS_TEPI_AWAL} ${KELAS_TEPI_AKHIR}`);
    expect(kelasTepiSel("font-medium text-right")).toBe(`${KELAS_TEPI_AWAL} ${KELAS_TEPI_AKHIR}`);
  });

  it("jarak kiri milik pemanggil dipertahankan, tepi kanan tetap diberi", () => {
    for (const k of ["pl-6", "ps-4", "whitespace-normal pl-10 text-sm"]) {
      expect(kelasTepiSel(k)).toBe(KELAS_TEPI_AKHIR);
    }
  });

  it("jarak kanan milik pemanggil dipertahankan, tepi kiri tetap diberi", () => {
    for (const k of ["pr-6 text-right", "pe-4"]) {
      expect(kelasTepiSel(k)).toBe(KELAS_TEPI_AWAL);
    }
  });

  it("jarak kedua sisi (p-, px-) atau berawalan varian membuat keduanya dilepas", () => {
    for (const k of ["px-4 py-3", "p-0", "md:px-6"]) {
      expect(kelasTepiSel(k)).toBe("");
    }
  });

  it("jarak atas-bawah saja tidak dihitung sebagai jarak samping", () => {
    expect(kelasTepiSel("py-1.5 pt-2 pb-1")).toBe(`${KELAS_TEPI_AWAL} ${KELAS_TEPI_AKHIR}`);
  });

  it("kelas tepi memakai variabel dengan cadangan 0.5rem (sama dengan jarak sel bawaan)", () => {
    expect(KELAS_TEPI_AWAL).toBe("first:ps-[var(--tabel-tepi,0.5rem)]");
    expect(KELAS_TEPI_AKHIR).toBe("last:pe-[var(--tabel-tepi,0.5rem)]");
  });
});
