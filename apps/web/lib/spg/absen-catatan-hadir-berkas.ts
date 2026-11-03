import * as XLSX from "xlsx";
import { hariAntara } from "./gaji-pokok";
import { rapikanHariCatatan, type GalatBaris, type HariCatatan } from "./absen-catatan-hadir";

/**
 * Berkas catatan check-in toko (Excel atau CSV) — dibaca di server.
 *
 * Kolom: Tanggal, Jadwal (KERJA/LIBUR), Hadir (YA/TIDAK), Catatan. `XLSX.read` WAJIB `raw: true`
 * (ranjau piutang: tanpanya SheetJS membaca teks seperti "900.000" sebagai angka dengan aturan
 * lokal). Tanggal boleh tanggal Excel (nomor seri), "YYYY-MM-DD", "DD/MM/YYYY", atau "DD-MM-YYYY".
 * Baris yang seluruhnya kosong dilewati; galat dilaporkan dengan nomor baris berkasnya.
 */

const KOLOM = { tanggal: ["tanggal", "tgl", "date"], jadwal: ["jadwal", "jenis"], hadir: ["hadir"], catatan: ["catatan", "keterangan", "note"] };

const pad = (n: number) => String(n).padStart(2, "0");

/** Nomor seri tanggal Excel (sistem 1900) → "YYYY-MM-DD". */
function dariSeriExcel(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const ms = Math.round((Math.floor(n) - 25569) * 86_400_000);
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** Nilai sel tanggal → "YYYY-MM-DD", atau teks aslinya (rapikanHariCatatan yang menolaknya). */
export function bacaTanggalSel(x: unknown): string {
  if (typeof x === "number") return dariSeriExcel(x) ?? String(x);
  if (x instanceof Date && Number.isFinite(x.getTime())) return x.toISOString().slice(0, 10);
  const t = typeof x === "string" ? x.trim() : "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return t;
}

const kosong = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

export function bacaBerkasCatatanHadir(
  isi: ArrayBuffer,
  masa: { hariAwal: string; hariAkhir: string } | null,
  hariIni: string,
): { ok: true; hari: HariCatatan[] } | { ok: false; galat: GalatBaris[] } {
  let sel: unknown[][];
  try {
    const wb = XLSX.read(new Uint8Array(isi), { type: "array", raw: true });
    const lembar = wb.Sheets[wb.SheetNames[0]];
    if (!lembar) return { ok: false, galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }] };
    sel = XLSX.utils.sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: "" });
  } catch {
    return { ok: false, galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }] };
  }
  const iKepala = sel.findIndex((r) => r.some((c) => typeof c === "string" && KOLOM.tanggal.includes(c.trim().toLowerCase())));
  if (iKepala < 0) return { ok: false, galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }] };
  const kepala = sel[iKepala].map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));
  const kolom = (nama: readonly string[]) => kepala.findIndex((k) => nama.includes(k));
  const [cT, cJ, cH, cC] = [kolom(KOLOM.tanggal), kolom(KOLOM.jadwal), kolom(KOLOM.hadir), kolom(KOLOM.catatan)];
  const nomor: number[] = [];
  const isian: unknown[] = [];
  sel.slice(iKepala + 1).forEach((r, i) => {
    if (r.every(kosong)) return;
    nomor.push(iKepala + 2 + i);
    isian.push({
      day: bacaTanggalSel(r[cT]),
      kind: cJ >= 0 ? r[cJ] : "",
      present: cH >= 0 ? r[cH] : "",
      note: cC >= 0 && typeof r[cC] === "string" ? r[cC] : cC >= 0 && r[cC] !== "" ? String(r[cC]) : null,
    });
  });
  const hasil = rapikanHariCatatan(isian, masa, hariIni);
  if (hasil.ok) return hasil;
  // Nomor baris formulir → nomor baris berkas.
  return { ok: false, galat: hasil.galat.map((g) => ({ ...g, baris: g.baris > 0 ? (nomor[g.baris - 1] ?? g.baris) : 0 })) };
}

/** Templat berkas: satu baris per hari masa kerjanya, kolom Jadwal/Hadir/Catatan dikosongkan. */
export function templateCatatanHadir(masa: { hariAwal: string; hariAkhir: string } | null): ArrayBuffer {
  const baris = [["Tanggal", "Jadwal", "Hadir", "Catatan"], ...(masa ? hariAntara(masa.hariAwal, masa.hariAkhir) : []).map((d) => [d, "", "", ""])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baris), "Catatan check-in");
  const keluar = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return keluar;
}
