import { bacaTanggal, geserHari } from "@/lib/tanggal-isian";

/*
 * Hari kerja produksi — untuk jadwal proses per tahap Plan Kerja (2026-10-07).
 *
 * Seperti program SSG milik pemilik: lama proses dihitung dalam HARI KERJA,
 * melewati hari libur mingguan dan tanggal merah. Murni dan aman untuk klien;
 * semua tanggal berupa teks "YYYY-MM-DD" (hari kalender WIB), jadi zona waktu
 * server/peramban tidak pernah menggeser harinya.
 *
 * Aturan menambah: hari awal TIDAK ikut dihitung (sama dengan SSG) — langkah 1
 * hari yang dimulai Senin selesai Selasa; langkah berikutnya mulai dari tanggal
 * selesai langkah sebelumnya.
 *
 * Pengaturan di SystemSetting (bawaan di kode bila belum ada):
 *   produksi.hariKerja    → {"hariKerja":[1,2,3,4,5]}  (0 = Minggu … 6 = Sabtu)
 *   produksi.tanggalMerah → [{"tanggal":"2026-08-17","nama":"Hari Kemerdekaan RI"}, …]
 */

export const KUNCI_HARI_KERJA_PRODUKSI = "produksi.hariKerja";
export const KUNCI_TANGGAL_MERAH = "produksi.tanggalMerah";

/** Senin–Jumat, seperti program SSG. Sabtu bisa ditambahkan di pengaturan. */
export const HARI_KERJA_PRODUKSI_BAWAAN: readonly number[] = [1, 2, 3, 4, 5];

export type TanggalMerah = { tanggal: string; nama: string };

export type KalenderKerja = {
  hariKerja: ReadonlySet<number>;
  libur: ReadonlySet<string>;
};

/** Penjaga putaran: jadwal yang lebih panjang dari ini pasti data rusak. */
const BATAS_LANGKAH_HARI = 3660;

function uraiJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Isi pengaturan → daftar hari kerja yang sah (0–6, unik, urut). Kosong/rusak → bawaan. */
export function bacaHariKerjaProduksi(raw: unknown): number[] {
  const nilai = uraiJson(raw);
  const daftar = Array.isArray(nilai)
    ? nilai
    : nilai && typeof nilai === "object" && Array.isArray((nilai as { hariKerja?: unknown }).hariKerja)
      ? (nilai as { hariKerja: unknown[] }).hariKerja
      : null;
  if (!daftar) return [...HARI_KERJA_PRODUKSI_BAWAAN];
  const sah = [...new Set(daftar.filter((h): h is number => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 6))].sort(
    (a, b) => a - b,
  );
  return sah.length > 0 ? sah : [...HARI_KERJA_PRODUKSI_BAWAAN];
}

function tanggalSah(teks: unknown): teks is string {
  if (typeof teks !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(teks)) return false;
  const b = bacaTanggal(teks);
  if (!b) return false;
  const d = new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari));
  return d.toISOString().slice(0, 10) === teks;
}

/** Isi pengaturan → tanggal merah yang sah, unik per tanggal (yang pertama menang), urut. */
export function bacaTanggalMerah(raw: unknown): TanggalMerah[] {
  const nilai = uraiJson(raw);
  if (!Array.isArray(nilai)) return [];
  const peta = new Map<string, TanggalMerah>();
  for (const baris of nilai) {
    if (!baris || typeof baris !== "object") continue;
    const { tanggal, nama } = baris as { tanggal?: unknown; nama?: unknown };
    if (!tanggalSah(tanggal) || peta.has(tanggal)) continue;
    peta.set(tanggal, { tanggal, nama: typeof nama === "string" ? nama.trim() : "" });
  }
  return [...peta.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

export function kalenderKerja(hariKerja: readonly number[], tanggalMerah: readonly TanggalMerah[]): KalenderKerja {
  const hari = hariKerja.filter((h) => Number.isInteger(h) && h >= 0 && h <= 6);
  return {
    hariKerja: new Set(hari.length > 0 ? hari : HARI_KERJA_PRODUKSI_BAWAAN),
    libur: new Set(tanggalMerah.map((t) => t.tanggal)),
  };
}

function hariDalamMinggu(teks: string): number {
  const b = bacaTanggal(teks);
  if (!b) return -1;
  return new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari)).getUTCDay();
}

export function hariKerjaKah(teks: string, kal: KalenderKerja): boolean {
  return kal.hariKerja.has(hariDalamMinggu(teks)) && !kal.libur.has(teks);
}

function langkahiHariKerja(teks: string, n: number, arah: 1 | -1, kal: KalenderKerja): string {
  if (!bacaTanggal(teks)) return teks;
  let sisa = Math.max(0, Math.floor(n));
  let kursor = teks;
  let putaran = 0;
  while (sisa > 0 && putaran < BATAS_LANGKAH_HARI * 7) {
    kursor = geserHari(kursor, arah);
    putaran += 1;
    if (hariKerjaKah(kursor, kal)) sisa -= 1;
  }
  return kursor;
}

/** Maju `n` hari kerja dari `teks` (hari awal tidak dihitung). n ≤ 0 → `teks`. */
export function tambahHariKerja(teks: string, n: number, kal: KalenderKerja): string {
  return langkahiHariKerja(teks, n, 1, kal);
}

/** Mundur `n` hari kerja dari `teks` — kebalikan `tambahHariKerja` bila `teks` hari kerja. */
export function kurangiHariKerja(teks: string, n: number, kal: KalenderKerja): string {
  return langkahiHariKerja(teks, n, -1, kal);
}

/** Banyaknya hari kerja dalam (dari, sampai]; negatif bila `sampai` sebelum `dari`. */
export function jumlahHariKerja(dari: string, sampai: string, kal: KalenderKerja): number {
  if (!bacaTanggal(dari) || !bacaTanggal(sampai) || dari === sampai) return 0;
  const maju = sampai > dari;
  let kursor = dari;
  let jumlah = 0;
  let putaran = 0;
  while (kursor !== sampai && putaran < BATAS_LANGKAH_HARI * 7) {
    kursor = geserHari(kursor, maju ? 1 : -1);
    putaran += 1;
    if (maju ? hariKerjaKah(kursor, kal) : hariKerjaKah(geserHari(kursor, 1), kal)) jumlah += 1;
  }
  return maju ? jumlah : -jumlah;
}

/**
 * Libur nasional bertanggal TETAP untuk satu tahun — tombol "isi libur tetap"
 * di pengaturan. Libur bertanggal bergerak (Idulfitri, Iduladha, Imlek, Nyepi,
 * Waisak, Kenaikan, cuti bersama, dll.) ditetapkan pemerintah tiap tahun dan
 * diketik tim sendiri; kode tidak menebaknya.
 */
const LIBUR_TETAP: readonly { bulanHari: string; nama: string }[] = [
  { bulanHari: "01-01", nama: "Tahun Baru Masehi" },
  { bulanHari: "05-01", nama: "Hari Buruh Internasional" },
  { bulanHari: "06-01", nama: "Hari Lahir Pancasila" },
  { bulanHari: "08-17", nama: "Hari Kemerdekaan RI" },
  { bulanHari: "12-25", nama: "Hari Raya Natal" },
];

export function liburTetapTahun(tahun: number): TanggalMerah[] {
  return LIBUR_TETAP.map((l) => ({ tanggal: `${tahun}-${l.bulanHari}`, nama: l.nama }));
}
