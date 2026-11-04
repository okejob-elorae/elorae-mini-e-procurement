import * as XLSX from "xlsx";
import { bacaMutasiDariKisi, type HasilBacaMutasi, type Kisi } from "./baca-mutasi";

/**
 * Berkas mutasi bank (CSV atau Excel) → baris mutasi. Aman untuk klien dan server.
 *
 * `raw: true` WAJIB (aturan modul piutang dan saldo awal): tanpanya SheetJS
 * menebak tipe sel CSV dan membaca "900.000" sebagai sembilan ratus. Pada .xlsx
 * pilihan ini tidak berpengaruh: selnya sudah membawa tipenya (tanggal Excel
 * datang sebagai nomor seri, dibaca `bacaTanggalMutasi`).
 *
 * Lembar pertama saja.
 */
export function bacaBerkasMutasi(data: ArrayBuffer | Uint8Array | string): HasilBacaMutasi | { ok: false; kode: "BERKAS_RUSAK" } {
  let kisi: Kisi;
  try {
    const wb =
      typeof data === "string"
        ? XLSX.read(data, { type: "string", raw: true })
        : XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: "array", raw: true });
    const nama = wb.SheetNames[0];
    const lembar = nama ? wb.Sheets[nama] : undefined;
    if (!lembar) return { ok: false, kode: "BERKAS_RUSAK" };
    kisi = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(lembar, { header: 1, raw: true, defval: null, blankrows: false });
  } catch {
    return { ok: false, kode: "BERKAS_RUSAK" };
  }
  return bacaMutasiDariKisi(kisi);
}
