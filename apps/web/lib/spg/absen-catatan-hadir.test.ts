import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bolehMembukaCatatanHadir, menungguDiperiksa, perluDimasukkan, potretHariCatatan, rapikanHariCatatan } from "./absen-catatan-hadir";
import { bacaBerkasCatatanHadir, bacaTanggalSel, templateCatatanHadir } from "./absen-catatan-hadir-berkas";

/**
 * Catatan check-in toko SPG — bagian murni (P7d, P7e): kantor mengetik atau mengunggah catatan
 * toko untuk SPG yang tidak mengisi jadwalnya. Setiap hari harus di masa kerjanya, bukan hari
 * depan, dan muncul sekali; berkas dibaca dengan `raw: true` (ranjau piutang).
 */

const MASA = { hariAwal: "2026-11-01", hariAkhir: "2026-11-30" };
const HARI_INI = "2026-11-20";

const csv = (teks: string): ArrayBuffer => {
  const b = new TextEncoder().encode(teks);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const xlsx = (baris: unknown[][]): ArrayBuffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baris), "Catatan");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
/** Nomor seri tanggal Excel (sistem 1900) untuk hari UTC itu. */
const seri = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000 + 25_569;

describe("rapikanHariCatatan", () => {
  it("menerima hari di masa kerja, sampai hari ini; KERJA/LIBUR dan YA/TIDAK tanpa memandang huruf besar; urut hari", () => {
    const r = rapikanHariCatatan(
      [
        { day: "2026-11-05", kind: "libur", present: "Tidak", note: " " },
        { day: "2026-11-03", kind: "Kerja", present: "ya", note: "telat 10 menit" },
        { day: "2026-11-20", kind: "KERJA", present: true },
      ],
      MASA,
      HARI_INI,
    );
    expect(r).toEqual({
      ok: true,
      hari: [
        { day: "2026-11-03", kind: "KERJA", present: true, note: "telat 10 menit" },
        { day: "2026-11-05", kind: "LIBUR", present: false, note: null },
        { day: "2026-11-20", kind: "KERJA", present: true, note: null },
      ],
    });
  });

  it("mengumpulkan setiap galat per baris: tanggal rusak, hari depan, di luar masa, ganda, isian tak dikenal", () => {
    const r = rapikanHariCatatan(
      [
        { day: "2026-11-31", kind: "KERJA", present: "YA" },
        { day: "2026-11-21", kind: "KERJA", present: "YA" },
        { day: "2026-10-31", kind: "KERJA", present: "YA" },
        { day: "2026-11-02", kind: "KERJA", present: "YA" },
        { day: "2026-11-02", kind: "LIBUR", present: "TIDAK" },
        { day: "2026-11-04", kind: "CUTI", present: "YA" },
        { day: "2026-11-06", kind: "KERJA", present: "MUNGKIN" },
      ],
      MASA,
      HARI_INI,
    );
    expect(r).toEqual({
      ok: false,
      galat: [
        { baris: 1, kode: "HARI_TIDAK_SAH" },
        { baris: 2, kode: "HARI_DEPAN" },
        { baris: 3, kode: "DI_LUAR_MASA_KERJA" },
        { baris: 5, kode: "HARI_GANDA" },
        { baris: 6, kode: "JADWAL_TIDAK_SAH" },
        { baris: 7, kode: "HADIR_TIDAK_SAH" },
      ],
    });
  });

  it("tanpa masa kerja (tanggal mulai kosong) atau tanpa baris sama sekali → ditolak", () => {
    expect(rapikanHariCatatan([{ day: "2026-11-02", kind: "KERJA", present: "YA" }], null, HARI_INI)).toEqual({
      ok: false,
      galat: [{ baris: 1, kode: "DI_LUAR_MASA_KERJA" }],
    });
    expect(rapikanHariCatatan([], MASA, HARI_INI)).toEqual({ ok: false, galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }] });
  });

  it("potret hari untuk jejak", () => {
    expect(
      potretHariCatatan([
        { day: "2026-11-05", kind: "LIBUR", present: false },
        { day: "2026-11-03", kind: "KERJA", present: true },
      ]),
    ).toEqual({ "2026-11-03": "KERJA:YA", "2026-11-05": "LIBUR:TIDAK" });
  });
});

describe("berkas catatan (raw: true)", () => {
  it("CSV: tanggal DD/MM/YYYY dan YYYY-MM-DD; catatan '900.000' tetap teks, tidak dibaca sebagai angka", () => {
    const r = bacaBerkasCatatanHadir(csv("Tanggal,Jadwal,Hadir,Catatan\n03/11/2026,kerja,ya,900.000\n2026-11-04,LIBUR,TIDAK,\n\n"), MASA, HARI_INI);
    expect(r).toEqual({
      ok: true,
      hari: [
        { day: "2026-11-03", kind: "KERJA", present: true, note: "900.000" },
        { day: "2026-11-04", kind: "LIBUR", present: false, note: null },
      ],
    });
  });

  it("Excel: nomor seri tanggal dan teks DD-MM-YYYY; galat menyebut nomor baris BERKAS", () => {
    const r = bacaBerkasCatatanHadir(
      xlsx([
        ["Catatan toko"],
        ["Tanggal", "Jadwal", "Hadir", "Catatan"],
        [seri("2026-11-05"), "KERJA", "YA", ""],
        ["06-11-2026", "KERJA", "TIDAK", "sakit tanpa surat"],
      ]),
      MASA,
      HARI_INI,
    );
    expect(r).toEqual({
      ok: true,
      hari: [
        { day: "2026-11-05", kind: "KERJA", present: true, note: null },
        { day: "2026-11-06", kind: "KERJA", present: false, note: "sakit tanpa surat" },
      ],
    });
    const salah = bacaBerkasCatatanHadir(
      xlsx([
        ["Tanggal", "Jadwal", "Hadir"],
        ["2026-11-05", "KERJA", "YA"],
        ["2026-11-05", "KERJA", "YA"],
      ]),
      MASA,
      HARI_INI,
    );
    expect(salah).toEqual({ ok: false, galat: [{ baris: 3, kode: "HARI_GANDA" }] });
  });

  it("tanpa kolom Tanggal atau berkas rusak → ditolak", () => {
    expect(bacaBerkasCatatanHadir(csv("Hari,Jadwal\n2026-11-03,KERJA\n"), MASA, HARI_INI)).toEqual({ ok: false, galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }] });
  });

  it("bacaTanggalSel: bentuk yang tidak dikenal dikembalikan apa adanya (ditolak rapikanHariCatatan)", () => {
    expect(bacaTanggalSel("3 Nov 2026")).toBe("3 Nov 2026");
    expect(bacaTanggalSel(seri("2026-11-03"))).toBe("2026-11-03");
    expect(bacaTanggalSel("3-11-2026")).toBe("2026-11-03");
  });

  it("templat yang hanya sebagian diisi: hari tanpa Jadwal, Hadir, dan Catatan dilewati", () => {
    const r = bacaBerkasCatatanHadir(
      xlsx([
        ["Tanggal", "Jadwal", "Hadir", "Catatan"],
        ["2026-11-03", "KERJA", "YA", ""],
        ["2026-11-04", "", "", ""],
        ["2026-11-05", "LIBUR", "TIDAK", ""],
      ]),
      MASA,
      HARI_INI,
    );
    expect(r).toEqual({
      ok: true,
      hari: [
        { day: "2026-11-03", kind: "KERJA", present: true, note: null },
        { day: "2026-11-05", kind: "LIBUR", present: false, note: null },
      ],
    });
    // Hari yang membawa catatan tidak dilewati: tanpa Jadwal tetap ditolak, dengan nomor baris berkasnya.
    const bercatatan = bacaBerkasCatatanHadir(
      xlsx([
        ["Tanggal", "Jadwal", "Hadir", "Catatan"],
        ["2026-11-03", "KERJA", "YA", ""],
        ["2026-11-04", "", "", "lupa"],
        ["2026-11-05", "LIBUR", "TIDAK", ""],
      ]),
      MASA,
      HARI_INI,
    );
    expect(bercatatan).toEqual({ ok: false, galat: [{ baris: 3, kode: "JADWAL_TIDAK_SAH" }] });
    // Hanya Jadwal yang diisi: tetap ditolak (Hadir wajib).
    expect(bacaBerkasCatatanHadir(xlsx([["Tanggal", "Jadwal", "Hadir", "Catatan"], ["2026-11-04", "KERJA", "", ""]]), MASA, HARI_INI)).toEqual({
      ok: false,
      galat: [{ baris: 2, kode: "HADIR_TIDAK_SAH" }],
    });
    // Templat yang tidak disentuh sama sekali tidak berisi hari apa pun.
    expect(bacaBerkasCatatanHadir(templateCatatanHadir({ hariAwal: "2026-11-01", hariAkhir: "2026-11-03" }), MASA, HARI_INI)).toEqual({
      ok: false,
      galat: [{ baris: 0, kode: "HARI_TIDAK_SAH" }],
    });
  });

  it("templat sebulan dengan tiga hari diisi dan sisanya hanya bertanggal: tiga hari yang masuk", () => {
    const wb = XLSX.read(new Uint8Array(templateCatatanHadir(MASA)), { type: "array", raw: true });
    const baris = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const isi: Record<string, [string, string, string]> = {
      "2026-11-02": ["KERJA", "YA", ""],
      "2026-11-03": ["KERJA", "TIDAK", "sakit"],
      "2026-11-08": ["LIBUR", "TIDAK", ""],
    };
    const diisi = baris.map((b, i) => (i > 0 && isi[String(b[0])] ? [b[0], ...isi[String(b[0])]] : b));
    expect(diisi).toHaveLength(31);
    expect(bacaBerkasCatatanHadir(xlsx(diisi), MASA, HARI_INI)).toEqual({
      ok: true,
      hari: [
        { day: "2026-11-02", kind: "KERJA", present: true, note: null },
        { day: "2026-11-03", kind: "KERJA", present: false, note: "sakit" },
        { day: "2026-11-08", kind: "LIBUR", present: false, note: null },
      ],
    });
  });

  it("templat berisi tepat hari masa kerjanya", () => {
    const wb = XLSX.read(new Uint8Array(templateCatatanHadir({ hariAwal: "2026-11-28", hariAkhir: "2026-11-30" })), { type: "array", raw: true });
    const baris = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    expect(baris.map((b) => b[0])).toEqual(["Tanggal", "2026-11-28", "2026-11-29", "2026-11-30"]);
  });
});

describe("membuka halaman catatan check-in", () => {
  it("yang memasukkan, yang memeriksa, atau pengawas SPG (hanya membaca); lainnya tidak", () => {
    expect(bolehMembukaCatatanHadir(["spg_attendance:record"])).toBe(true);
    expect(bolehMembukaCatatanHadir(["spg_attendance:verify"])).toBe(true);
    expect(bolehMembukaCatatanHadir(["spg_sales:view"])).toBe(true);
    expect(bolehMembukaCatatanHadir(["spg_commission:pay"])).toBe(false);
    expect(bolehMembukaCatatanHadir(undefined)).toBe(false);
  });
});

describe("antrean catatan check-in (angka Beranda = baris saringannya)", () => {
  const baris = (catatan: "DIAJUKAN" | "DIPERIKSA" | "DIKEMBALIKAN" | null, lain: { sudahDibayar?: boolean; hariPerlu?: string[] } = {}) => ({
    sudahDibayar: lain.sudahDibayar ?? false,
    hariPerlu: lain.hariPerlu ?? ["2026-10-03"],
    catatan: catatan ? { status: catatan } : null,
  });

  it("perlu dimasukkan: belum ada catatan, catatan DIKEMBALIKAN, atau diperiksa tetapi masih ada hari tanpa dasar", () => {
    expect(perluDimasukkan(baris(null))).toBe(true);
    expect(perluDimasukkan(baris("DIKEMBALIKAN"))).toBe(true);
    expect(perluDimasukkan(baris("DIPERIKSA"))).toBe(true);
    expect(perluDimasukkan(baris("DIPERIKSA", { hariPerlu: [] }))).toBe(false);
    expect(perluDimasukkan(baris("DIAJUKAN"))).toBe(false);
  });

  it("menunggu diperiksa: hanya catatan DIAJUKAN", () => {
    expect(menungguDiperiksa(baris("DIAJUKAN"))).toBe(true);
    expect(menungguDiperiksa(baris("DIKEMBALIKAN"))).toBe(false);
    expect(menungguDiperiksa(baris(null))).toBe(false);
  });

  it("bulan yang gajinya sudah dibayar tidak masuk antrean mana pun", () => {
    for (const c of [null, "DIAJUKAN", "DIPERIKSA", "DIKEMBALIKAN"] as const) {
      expect(perluDimasukkan(baris(c, { sudahDibayar: true }))).toBe(false);
      expect(menungguDiperiksa(baris(c, { sudahDibayar: true }))).toBe(false);
    }
  });
});
