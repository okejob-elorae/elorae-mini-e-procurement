import * as XLSX from "xlsx";

/*
 * Buku kerja Excel laporan keuangan — satu tempat untuk format angka:
 * rupiah utuh dengan pemisah ribuan, NEGATIF DALAM KURUNG (sama dengan layar
 * dan cetak, `format-laporan.ts`), persen satu desimal, rasio dua desimal.
 * Hanya untuk server (aksi `app/actions/finance-*`).
 */

export const FORMAT_RUPIAH = "#,##0;(#,##0);0";
const FORMAT_PERSEN = "0.0%;(0.0%);0.0%";
const FORMAT_RASIO = "0.00";
const FORMAT_HARI = "#,##0";

/** Sel bertipe: angka biasa = rupiah. */
export type SelExcel =
  | string
  | number
  | null
  | { persen: number | null }
  | { rasio: number | null }
  | { hari: number | null };

function keSel(v: SelExcel): XLSX.CellObject | null {
  if (v === null) return null;
  if (typeof v === "string") return { t: "s", v };
  if (typeof v === "number") return Number.isFinite(v) ? { t: "n", v, z: FORMAT_RUPIAH } : null;
  if ("persen" in v) return v.persen == null || !Number.isFinite(v.persen) ? { t: "s", v: "—" } : { t: "n", v: v.persen / 100, z: FORMAT_PERSEN };
  if ("rasio" in v) return v.rasio == null || !Number.isFinite(v.rasio) ? { t: "s", v: "—" } : { t: "n", v: v.rasio, z: FORMAT_RASIO };
  return v.hari == null || !Number.isFinite(v.hari) ? { t: "s", v: "—" } : { t: "n", v: Math.round(v.hari), z: FORMAT_HARI };
}

/** Terapkan format rupiah pada setiap sel angka lembar yang dibuat `aoa_to_sheet`. */
export function formatAngkaLembar(ws: XLSX.WorkSheet): void {
  for (const [alamat, sel] of Object.entries(ws)) {
    if (alamat.startsWith("!")) continue;
    const c = sel as XLSX.CellObject;
    if (c.t === "n" && !c.z) c.z = FORMAT_RUPIAH;
  }
}

export function lembarLaporan(baris: SelExcel[][], lebar?: number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maksKolom = 0;
  baris.forEach((r, i) => {
    maksKolom = Math.max(maksKolom, r.length);
    r.forEach((v, j) => {
      const sel = keSel(v);
      if (sel) ws[XLSX.utils.encode_cell({ r: i, c: j })] = sel;
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, baris.length - 1), c: Math.max(0, maksKolom - 1) } });
  if (lebar) ws["!cols"] = lebar.map((wch) => ({ wch }));
  return ws;
}

export function bukuKerjaLaporan(
  lembar: { nama: string; baris: SelExcel[][]; lebar?: number[] }[],
  namaBerkas: string,
): { base64: string; filename: string } {
  const wb = XLSX.utils.book_new();
  for (const l of lembar) XLSX.utils.book_append_sheet(wb, lembarLaporan(l.baris, l.lebar), l.nama.slice(0, 31));
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename: namaBerkas };
}

/** Kepala lembar: nama usaha, judul, periode, penyusun, waktu cetak, baris kosong. */
export function kepalaLaporan(judul: string, periode: string, disiapkanOleh: string, dicetak: string): SelExcel[][] {
  return [["Elorae"], [judul], [periode], [`Disiapkan oleh: ${disiapkanOleh}`], [`Dicetak: ${dicetak}`], []];
}
