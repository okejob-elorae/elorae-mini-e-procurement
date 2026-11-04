/**
 * Tabel ukuran — aturan murni, tanpa basis data, aman diimpor komponen klien.
 *
 * Satu tabel = kolom pengukuran (Lebar dada, Panjang badan, …) × baris per
 * ukuran (S, M, L, …), angka dalam satu satuan (cm atau inci). Tabel bisa
 * menjadi BAWAAN satu kategori (satu tabel aktif per kategori) atau dipasang
 * langsung di barang (`Item.sizeChartId`). Barang yang tidak memasang tabelnya
 * sendiri ikut bawaan kategorinya.
 *
 * Bentuk di basis data (kolom Json):
 *   columns: string[]                                   — judul kolom, berurutan
 *   rows:    { ukuran: string; nilai: (number|null)[] }[] — `nilai[i]` milik `columns[i]`
 * Sel kosong (`null`) boleh — tidak semua ukuran punya setiap ukuran badan —
 * tapi setiap baris wajib punya paling sedikit satu angka.
 */

export const SATUAN_UKURAN = ["cm", "inci"] as const;
export type SatuanUkuran = (typeof SATUAN_UKURAN)[number];

export const BATAS_TABEL_UKURAN = {
  nama: 100,
  kolom: 12,
  judulKolom: 40,
  baris: 30,
  ukuran: 20,
  catatan: 2000,
  /** Angka terbesar yang masuk akal untuk ukuran pakaian, dalam cm maupun inci. */
  angka: 1000,
} as const;

/** Nama tindakan jejak (`AuditLog.action`) untuk master tabel ukuran. */
export const JEJAK_TABEL_UKURAN = {
  DIBUAT: "SIZE_CHART_CREATED",
  DIUBAH: "SIZE_CHART_UPDATED",
  DIHAPUS: "SIZE_CHART_DELETED",
} as const;
export const ENTITAS_TABEL_UKURAN = "SizeChart";

export type BarisUkuran = { ukuran: string; nilai: (number | null)[] };

export type IsianTabelUkuran = {
  name: string;
  unit: string;
  categoryId: string | null;
  columns: string[];
  rows: BarisUkuran[];
  note: string | null;
  isActive: boolean;
};

export type TabelUkuranSah = {
  name: string;
  unit: SatuanUkuran;
  categoryId: string | null;
  columns: string[];
  rows: BarisUkuran[];
  note: string | null;
  isActive: boolean;
};

export type MasalahTabelUkuran =
  | "NAMA_WAJIB"
  | "NAMA_TERLALU_PANJANG"
  | "SATUAN_TIDAK_DIKENAL"
  | "KOLOM_WAJIB"
  | "KOLOM_TERLALU_BANYAK"
  | "KOLOM_KOSONG"
  | "KOLOM_TERLALU_PANJANG"
  | "KOLOM_GANDA"
  | "BARIS_WAJIB"
  | "BARIS_TERLALU_BANYAK"
  | "UKURAN_KOSONG"
  | "UKURAN_TERLALU_PANJANG"
  | "UKURAN_GANDA"
  | "BENTUK_TIDAK_SAH"
  | "ANGKA_TIDAK_SAH"
  | "BARIS_TANPA_ANGKA"
  | "CATATAN_TERLALU_PANJANG";

const rapikanTeks = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");
const kunciBanding = (s: string) => s.toLocaleLowerCase("id-ID");

function angkaSah(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n > 0 &&
    n <= BATAS_TABEL_UKURAN.angka &&
    // Paling banyak dua angka di belakang koma (inci sering setengah: 20,5).
    Math.abs(Math.round(n * 100) - n * 100) < 1e-6
  );
}

/**
 * Periksa isian formulir sebelum disimpan. Teks dirapikan (spasi ganda,
 * pinggir); masalah dikumpulkan tanpa duplikat, berurutan seperti formulirnya.
 */
export function periksaTabelUkuran(
  isian: IsianTabelUkuran,
): { ok: true; data: TabelUkuranSah } | { ok: false; masalah: MasalahTabelUkuran[] } {
  const masalah = new Set<MasalahTabelUkuran>();

  const name = rapikanTeks(isian.name);
  if (!name) masalah.add("NAMA_WAJIB");
  else if (name.length > BATAS_TABEL_UKURAN.nama) masalah.add("NAMA_TERLALU_PANJANG");

  const unit = (SATUAN_UKURAN as readonly string[]).includes(isian.unit) ? (isian.unit as SatuanUkuran) : null;
  if (!unit) masalah.add("SATUAN_TIDAK_DIKENAL");

  const columns = Array.isArray(isian.columns) ? isian.columns.map(rapikanTeks) : [];
  if (columns.length === 0) masalah.add("KOLOM_WAJIB");
  if (columns.length > BATAS_TABEL_UKURAN.kolom) masalah.add("KOLOM_TERLALU_BANYAK");
  const judulDilihat = new Set<string>();
  for (const c of columns) {
    if (!c) masalah.add("KOLOM_KOSONG");
    else if (c.length > BATAS_TABEL_UKURAN.judulKolom) masalah.add("KOLOM_TERLALU_PANJANG");
    else if (judulDilihat.has(kunciBanding(c))) masalah.add("KOLOM_GANDA");
    if (c) judulDilihat.add(kunciBanding(c));
  }

  const rowsMentah = Array.isArray(isian.rows) ? isian.rows : [];
  if (rowsMentah.length === 0) masalah.add("BARIS_WAJIB");
  if (rowsMentah.length > BATAS_TABEL_UKURAN.baris) masalah.add("BARIS_TERLALU_BANYAK");
  const ukuranDilihat = new Set<string>();
  const rows: BarisUkuran[] = [];
  for (const r of rowsMentah) {
    const ukuran = rapikanTeks(r?.ukuran);
    if (!ukuran) masalah.add("UKURAN_KOSONG");
    else if (ukuran.length > BATAS_TABEL_UKURAN.ukuran) masalah.add("UKURAN_TERLALU_PANJANG");
    else if (ukuranDilihat.has(kunciBanding(ukuran))) masalah.add("UKURAN_GANDA");
    if (ukuran) ukuranDilihat.add(kunciBanding(ukuran));

    const nilaiMentah = Array.isArray(r?.nilai) ? r.nilai : null;
    if (!nilaiMentah || nilaiMentah.length !== columns.length) {
      masalah.add("BENTUK_TIDAK_SAH");
      continue;
    }
    const nilai = nilaiMentah.map((n) => (n === null || n === undefined ? null : n));
    if (nilai.some((n) => n !== null && !angkaSah(n))) masalah.add("ANGKA_TIDAK_SAH");
    if (columns.length > 0 && nilai.every((n) => n === null)) masalah.add("BARIS_TANPA_ANGKA");
    rows.push({ ukuran, nilai: nilai.map((n) => (n === null ? null : Math.round(Number(n) * 100) / 100)) });
  }

  const noteTeks = typeof isian.note === "string" ? isian.note.trim() : "";
  if (noteTeks.length > BATAS_TABEL_UKURAN.catatan) masalah.add("CATATAN_TERLALU_PANJANG");

  if (masalah.size > 0 || !unit) return { ok: false, masalah: [...masalah] };
  const categoryId = typeof isian.categoryId === "string" && isian.categoryId.trim() ? isian.categoryId.trim() : null;
  return {
    ok: true,
    data: { name, unit, categoryId, columns, rows, note: noteTeks || null, isActive: isian.isActive !== false },
  };
}

/**
 * Teks isian sel → angka. Koma dan titik sama-sama tanda desimal ("52,5" =
 * "52.5"). Kosong → `null` (sel boleh kosong). Selain angka positif dengan
 * paling banyak dua desimal → `NaN`, supaya formulir bisa menandai selnya.
 */
export function bacaAngkaUkuran(teks: string): number | null {
  const s = teks.trim().replace(",", ".");
  if (!s) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return angkaSah(n) ? n : Number.NaN;
}

/** Angka sel untuk ditampilkan/diisi ulang: "52,5" (bahasa Indonesia) atau "52.5". */
export function teksAngkaUkuran(n: number | null, locale: string = "id"): string {
  if (n === null || !Number.isFinite(n)) return "";
  const s = String(Math.round(n * 100) / 100);
  return locale.startsWith("en") ? s : s.replace(".", ",");
}

/**
 * Isi kolom Json dari basis data → bentuk tabel. Data lama atau rusak tidak
 * boleh menjatuhkan halaman: bagian yang tidak bisa dibaca dibuang, sel yang
 * bukan angka menjadi kosong, dan panjang `nilai` disamakan dengan kolom.
 */
export function bacaTabelUkuran(columns: unknown, rows: unknown): { columns: string[]; rows: BarisUkuran[] } {
  const kol = Array.isArray(columns) ? columns.map((c) => (typeof c === "string" ? c.trim() : "")).filter(Boolean) : [];
  const bar: BarisUkuran[] = [];
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const x = r as Record<string, unknown>;
      const ukuran = typeof x.ukuran === "string" ? x.ukuran.trim() : "";
      if (!ukuran) continue;
      const mentah = Array.isArray(x.nilai) ? x.nilai : [];
      const nilai = kol.map((_, i) => {
        const v = mentah[i];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      });
      bar.push({ ukuran, nilai });
    }
  }
  return { columns: kol, rows: bar };
}

export type CalonTabel = { id: string; categoryId: string | null; isActive: boolean; updatedAt: Date | string };

/**
 * Tabel ukuran yang berlaku untuk satu barang: tabel milik barang itu kalau
 * masih aktif, kalau tidak (kosong, dihapus, atau dinonaktifkan) tabel aktif
 * bawaan kategorinya. Nonaktif berarti "jangan dipakai lagi", jadi tabel
 * barang yang dinonaktifkan pun jatuh ke bawaan kategori. Kalau kategori
 * ternyata punya lebih dari satu tabel aktif (data lama sebelum aturan satu
 * per kategori), yang paling baru diubah yang menang.
 */
export function pilihTabelUkuran<T extends CalonTabel>(
  barang: { sizeChartId: string | null; categoryId: string | null },
  tabel: readonly T[],
): { tabel: T; sumber: "BARANG" | "KATEGORI" } | null {
  if (barang.sizeChartId) {
    const sendiri = tabel.find((t) => t.id === barang.sizeChartId && t.isActive);
    if (sendiri) return { tabel: sendiri, sumber: "BARANG" };
  }
  if (!barang.categoryId) return null;
  const waktu = (t: CalonTabel) => new Date(t.updatedAt).getTime();
  const bawaan = tabel
    .filter((t) => t.isActive && t.categoryId === barang.categoryId)
    .sort((a, b) => waktu(b) - waktu(a) || a.id.localeCompare(b.id))[0];
  return bawaan ? { tabel: bawaan, sumber: "KATEGORI" } : null;
}

/** Daftar ukuran untuk ringkasan di daftar kantor: "S, M, L, XL". */
export function ringkasUkuran(rows: readonly BarisUkuran[], maks = 8): string {
  const u = rows.map((r) => r.ukuran);
  return u.length > maks ? `${u.slice(0, maks).join(", ")}, …` : u.join(", ");
}
