import * as XLSX from "xlsx";
import { bacaLembarHpp, type HasilBacaBerkas } from "./persediaan";

/**
 * Baca berkas HPP (Excel atau CSV) — aman untuk klien.
 *
 * `raw: true` WAJIB: tanpanya SheetJS menebak tipe sel CSV dan membaca
 * "90.000" (sembilan puluh ribu) sebagai 90 — titiknya dianggap pemisah
 * desimal. Dikunci `baca-berkas.test.ts`. Pada .xlsx pilihan ini tidak
 * berpengaruh: selnya sudah membawa tipenya.
 */
export function bacaBerkasHpp(data: ArrayBuffer | string): HasilBacaBerkas & { tanpaLembar: boolean } {
  const wb = typeof data === "string" ? XLSX.read(data, { type: "string", raw: true }) : XLSX.read(data, { type: "array", raw: true });
  const lembar = wb.SheetNames.length > 0 ? wb.Sheets[wb.SheetNames[0]] : undefined;
  if (!lembar) return { baris: [], galat: [], tanpaJudul: true, tanpaLembar: true };
  const sel = XLSX.utils.sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: "" });
  return { ...bacaLembarHpp(sel), tanpaLembar: false };
}
