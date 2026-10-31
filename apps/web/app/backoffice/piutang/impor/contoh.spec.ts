import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bacaLembar } from "@/lib/receivables/impor/baris";
import { CONTOH_BERKAS_IMPOR, NAMA_BERKAS_CONTOH } from "./contoh";

/*
 * Contoh berkas impor yang bisa diunduh dari layar impor. Dulu syarat kolomnya
 * baru diketahui dari galat sesudah mengunggah. Contohnya harus dibaca
 * pengurai yang SAMA persis dengan cara layar membacanya — contoh yang ditolak
 * layarnya sendiri lebih buruk daripada tidak ada contoh.
 */
function bacaSepertiLayar(csv: string) {
  const wb = XLSX.read(csv, { type: "string", cellDates: true, raw: true });
  const lembar = wb.Sheets[wb.SheetNames[0]];
  return bacaLembar(XLSX.utils.sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: "" }));
}

describe("contoh berkas impor", () => {
  it("dikenali seluruh kolomnya oleh pengurai layar impor", () => {
    const h = bacaSepertiLayar(CONTOH_BERKAS_IMPOR);
    expect(h.barisJudul).toBe(0);
    for (const k of ["no_faktur", "kode_toko", "toko", "tgl_faktur", "jatuh_tempo", "nilai", "sisa", "sales"] as const) {
      expect(h.kolom[k]).toBeDefined();
    }
  });

  it("barisnya terbaca tanpa masalah, termasuk sisa nol = lunas", () => {
    const h = bacaSepertiLayar(CONTOH_BERKAS_IMPOR);
    expect(h.baris.length).toBeGreaterThanOrEqual(3);
    expect(h.baris.every((b) => b.masalah.length === 0)).toBe(true);
    expect(h.baris[0]).toMatchObject({ noFaktur: "CONTOH/0001", nilai: 9_400_000 });
    // Tidak boleh menyerupai faktur atau toko sungguhan.
    expect(h.baris.every((b) => b.noFaktur.startsWith("CONTOH/") && b.kodeToko?.startsWith("CONTOH-"))).toBe(true);
    expect(h.baris.some((b) => b.sisaTertulis === 0)).toBe(true);
  });

  it("bernama .csv", () => {
    expect(NAMA_BERKAS_CONTOH).toMatch(/\.csv$/);
  });
});
