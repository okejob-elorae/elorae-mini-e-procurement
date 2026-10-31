import { kunciHariWib } from "@/lib/dashboard/tren";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Klaim biaya perjalanan salesman — aturan murni, satu tempat.
 *
 * Dipakai formulir HP (supaya penolakan terlihat sebelum Kirim), aksi server
 * (yang benar-benar menjaga), dan layar kantor. Tanpa Prisma, supaya bisa
 * dites dan aman dibundel ke klien.
 *
 * Alurnya: salesman MENGAJUKAN → atasan menyetujui atau menolak (dengan alasan)
 * → keuangan menandai DIBAYAR. Dua orang berbeda memutuskan dua hal berbeda:
 * yang menyetujui menilai "memang untuk kerja", yang membayar mengeluarkan uang.
 */

export const KATEGORI_BIAYA = ["BENSIN", "PARKIR", "TOL", "MAKAN", "LAINNYA"] as const;
export type KategoriBiaya = (typeof KATEGORI_BIAYA)[number];

export const STATUS_BIAYA = ["DIAJUKAN", "DISETUJUI", "DITOLAK", "DIBAYAR"] as const;
export type StatusBiaya = (typeof STATUS_BIAYA)[number];

/**
 * Batas kewajaran satu struk. Bukan kebijakan uang — penjaga salah ketik
 * (nol kebanyakan). Bensin sehari atau parkir tidak pernah mendekati ini;
 * pengeluaran yang benar-benar lebih besar tidak lewat klaim lapangan.
 */
export const BATAS_NILAI_BIAYA = 5_000_000;
export const BATAS_CATATAN = 500;

const HARI_MS = 86_400_000;

// ─── Siapa boleh apa ─────────────────────────────────────────────────────────
//
// Tanpa izin baru: memakai izin yang sudah ada di prod, supaya tidak ada yang
// perlu di-seed. Pemisahannya mengikuti pembagian kerja yang sudah berjalan.

/** Mengajukan: pekerjaan orang lapangan — sama dengan melapor pelunasan. */
export function bolehMengajukanBiaya(izin: string[] | undefined): boolean {
  return (izin ?? []).includes("pwa:access");
}

/**
 * Menyetujui/menolak: atasan salesman — orang yang sudah menyetujui pesanannya
 * dan menetapkan targetnya (`field_sales_orders:approve`, penjaga Pengaturan →
 * Salesman juga). Ia yang tahu kunjungan hari itu memang terjadi.
 */
export function bolehMenyetujuiBiaya(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
}

/**
 * Menandai dibayar: keuangan — pemegang `journals:manage`, orang yang sama
 * yang mencocokkan uang pelunasan dengan mutasi rekening. Uang keluar dicatat
 * oleh yang memegang kas, bukan oleh yang menyetujui.
 */
export function bolehMembayarBiaya(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.JOURNALS_MANAGE);
}

/**
 * Membuka layar kantor: atasan salesman (`field_sales_orders:view`) ATAU
 * keuangan yang harus membayar. Tanpa cabang kedua, keuangan yang tidak
 * memegang izin pesanan lapangan tidak bisa menandai apa pun dibayar.
 */
export function bolehMelihatBiaya(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW) || bolehMembayarBiaya(izin);
}

// ─── Pengaturan ──────────────────────────────────────────────────────────────

export const KUNCI_PENGATURAN_BIAYA = "salesman.biaya";
export const BATAS_HARI_MAKS = 365;

export type PengaturanBiaya = {
  /** Mati = salesman tidak bisa mengajukan; yang sudah ada tetap diproses kantor. */
  aktif: boolean;
  /** Struk yang lebih tua dari sekian hari tidak bisa diajukan lagi. */
  batasHari: number;
  fotoWajib: boolean;
};

export const PENGATURAN_BIAYA_BAWAAN: PengaturanBiaya = { aktif: true, batasHari: 30, fotoWajib: true };

const hariSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= BATAS_HARI_MAKS;

/** `SystemSetting` → pengaturan. Kolom rusak jatuh ke bawaan per kolom, tidak dilempar. */
export function bacaPengaturanBiaya(nilai: string | null | undefined): PengaturanBiaya {
  if (!nilai) return PENGATURAN_BIAYA_BAWAAN;
  let x: unknown;
  try {
    x = JSON.parse(nilai);
  } catch {
    return PENGATURAN_BIAYA_BAWAAN;
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return PENGATURAN_BIAYA_BAWAAN;
  const o = x as Record<string, unknown>;
  return {
    aktif: typeof o.aktif === "boolean" ? o.aktif : PENGATURAN_BIAYA_BAWAAN.aktif,
    batasHari: hariSah(o.batasHari) ? o.batasHari : PENGATURAN_BIAYA_BAWAAN.batasHari,
    fotoWajib: typeof o.fotoWajib === "boolean" ? o.fotoWajib : PENGATURAN_BIAYA_BAWAAN.fotoWajib,
  };
}

/**
 * Untuk MENYIMPAN: ketat, tidak menambal. Nilai yang ditambal diam-diam akan
 * tersimpan berbeda dari yang dilihat admin di layar.
 */
export function periksaPengaturanBiaya(x: unknown): PengaturanBiaya | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.aktif !== "boolean" || typeof o.fotoWajib !== "boolean" || !hariSah(o.batasHari)) return null;
  return { aktif: o.aktif, batasHari: o.batasHari, fotoWajib: o.fotoWajib };
}

// ─── Mengajukan ──────────────────────────────────────────────────────────────

export type IsiBiaya = {
  /** Hari kalender WIB, "YYYY-MM-DD". */
  tanggal: string;
  kategori: string;
  nilai: number;
  catatan?: string | null;
  fotoUrl?: string | null;
};

export type BiayaSah = {
  tanggal: string;
  /** Tengah malam WIB hari itu — kolom `spentAt`. */
  spentAt: Date;
  kategori: KategoriBiaya;
  nilai: number;
  catatan: string | null;
  fotoUrl: string | null;
};

export type KodeTolakBiaya =
  | "NONAKTIF"
  | "KATEGORI_TIDAK_DIKENAL"
  | "CATATAN_WAJIB"
  | "CATATAN_TERLALU_PANJANG"
  | "NILAI_TIDAK_SAH"
  | "NILAI_TERLALU_BESAR"
  | "TANGGAL_TIDAK_SAH"
  | "TANGGAL_MASA_DEPAN"
  | "TANGGAL_TERLALU_LAMA"
  | "FOTO_WAJIB"
  | "FOTO_TIDAK_SAH";

/**
 * Foto harus hasil unggahan aplikasi ini (`/api/foto/<id>`). Alamat bebas
 * akan ditampilkan apa adanya di layar kantor — dan layar kantor tidak boleh
 * memuat gambar dari mana saja atas kehendak pengisi formulir.
 */
export function urlFotoSah(url: string): boolean {
  return /^\/api\/foto\/[A-Za-z0-9_-]+$/.test(url);
}

/** "YYYY-MM-DD" yang benar-benar ada di kalender (bukan 30 Februari). */
function tanggalSah(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function periksaBiaya(
  isi: IsiBiaya,
  pengaturan: PengaturanBiaya,
  sekarang: Date,
): { ok: true; nilai: BiayaSah } | { ok: false; kode: KodeTolakBiaya } {
  if (!pengaturan.aktif) return { ok: false, kode: "NONAKTIF" };
  if (!KATEGORI_BIAYA.includes(isi.kategori as KategoriBiaya)) return { ok: false, kode: "KATEGORI_TIDAK_DIKENAL" };
  const kategori = isi.kategori as KategoriBiaya;

  const catatan = typeof isi.catatan === "string" ? isi.catatan.trim() : "";
  if (catatan.length > BATAS_CATATAN) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  // "Lainnya" tanpa keterangan tidak bisa dinilai siapa pun.
  if (kategori === "LAINNYA" && !catatan) return { ok: false, kode: "CATATAN_WAJIB" };

  if (typeof isi.nilai !== "number" || !Number.isInteger(isi.nilai) || isi.nilai <= 0) {
    return { ok: false, kode: "NILAI_TIDAK_SAH" };
  }
  if (isi.nilai > BATAS_NILAI_BIAYA) return { ok: false, kode: "NILAI_TERLALU_BESAR" };

  if (typeof isi.tanggal !== "string" || !tanggalSah(isi.tanggal)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  // Dibandingkan per hari kalender WIB: struk jam 00.30 WIB adalah struk
  // "hari ini", walau di UTC masih kemarin.
  const hariIni = kunciHariWib(sekarang);
  if (isi.tanggal > hariIni) return { ok: false, kode: "TANGGAL_MASA_DEPAN" };
  const selisihHari = Math.round((Date.parse(`${hariIni}T00:00:00Z`) - Date.parse(`${isi.tanggal}T00:00:00Z`)) / HARI_MS);
  if (selisihHari > pengaturan.batasHari) return { ok: false, kode: "TANGGAL_TERLALU_LAMA" };

  const fotoUrl = typeof isi.fotoUrl === "string" && isi.fotoUrl.trim() ? isi.fotoUrl.trim() : null;
  if (fotoUrl === null && pengaturan.fotoWajib) return { ok: false, kode: "FOTO_WAJIB" };
  if (fotoUrl !== null && !urlFotoSah(fotoUrl)) return { ok: false, kode: "FOTO_TIDAK_SAH" };

  return {
    ok: true,
    nilai: {
      tanggal: isi.tanggal,
      spentAt: new Date(`${isi.tanggal}T00:00:00+07:00`),
      kategori,
      nilai: isi.nilai,
      catatan: catatan || null,
      fotoUrl,
    },
  };
}

// ─── Keputusan kantor ────────────────────────────────────────────────────────

/**
 * Perpindahan yang sah. Ditolak dan dibayar adalah akhir: klaim yang ditolak
 * diajukan ulang sebagai klaim baru, supaya keputusan pertama tetap terbaca.
 */
export const TRANSISI_BIAYA: Record<StatusBiaya, readonly StatusBiaya[]> = {
  DIAJUKAN: ["DISETUJUI", "DITOLAK"],
  DISETUJUI: ["DIBAYAR"],
  DITOLAK: [],
  DIBAYAR: [],
};

export type KodeTolakPindah = "TRANSISI_TIDAK_SAH" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG";

export function periksaPindahBiaya(
  dari: string,
  ke: StatusBiaya,
  alasan?: string | null,
): { ok: true; alasan: string | null } | { ok: false; kode: KodeTolakPindah } {
  const boleh = (TRANSISI_BIAYA as Record<string, readonly StatusBiaya[] | undefined>)[dari] ?? [];
  if (!boleh.includes(ke)) return { ok: false, kode: "TRANSISI_TIDAK_SAH" };
  if (ke !== "DITOLAK") return { ok: true, alasan: null };
  // Salesman yang ditolak tanpa alasan tidak tahu harus membetulkan apa.
  const a = typeof alasan === "string" ? alasan.trim() : "";
  if (!a) return { ok: false, kode: "ALASAN_WAJIB" };
  if (a.length > BATAS_CATATAN) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, alasan: a };
}

/**
 * Nama tindakan di `AuditLog`. Terkumpul di satu tempat supaya jejaknya bisa
 * dicari — nama yang salah ketik tidak pernah muncul saat dicari.
 */
export const JEJAK_BIAYA = {
  DIAJUKAN: "EXPENSE_CLAIM_SUBMITTED",
  DISETUJUI: "EXPENSE_CLAIM_APPROVED",
  DITOLAK: "EXPENSE_CLAIM_REJECTED",
  DIBAYAR: "EXPENSE_CLAIM_PAID",
} as const satisfies Record<StatusBiaya, string>;

export const ENTITAS_BIAYA = "ExpenseClaim";

/**
 * Kategori catatan kantor (`AdminNotification`). Penerimanya di
 * `lib/notifications/admin-fanout.ts`: ajuan → penyetuju biaya, disetujui →
 * keuangan yang membayar — orang yang sama dengan `bolehMenyetujuiBiaya` /
 * `bolehMembayarBiaya`.
 */
export const KATEGORI_NOTIF_BIAYA = {
  DIAJUKAN: "EXPENSE_CLAIM_SUBMITTED",
  PERLU_DIBAYAR: "EXPENSE_CLAIM_TO_PAY",
} as const;

// ─── Bulan (WIB) ─────────────────────────────────────────────────────────────

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?bulan=` → "YYYY-MM" sah, atau bulan kalender WIB saat ini. */
export function bacaBulan(raw: string | string[] | undefined, sekarang: Date): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && POLA_BULAN.test(v) ? v : kunciHariWib(sekarang).slice(0, 7);
}

/** Awal bulan WIB sampai awal bulan berikutnya (eksklusif). */
export function rentangBulanWib(bulan: string): { mulai: Date; akhir: Date } {
  const [y, m] = bulan.split("-").map(Number);
  const berikut = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { mulai: new Date(`${bulan}-01T00:00:00+07:00`), akhir: new Date(`${berikut}-01T00:00:00+07:00`) };
}

/** "2026-09" → "September 2026". Dipanggil di SERVER (lihat catatan tanggal di brief PWA). */
export function labelBulan(bulan: string): string {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${bulan}-15T00:00:00Z`),
  );
}

/** `n` bulan terakhir, bulan ini lebih dulu. */
export function daftarBulanTerakhir(n: number, sekarang: Date): string[] {
  const [y0, m0] = kunciHariWib(sekarang).slice(0, 7).split("-").map(Number);
  const hasil: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = y0 * 12 + (m0 - 1) - i;
    hasil.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return hasil;
}

// ─── Ringkasan ───────────────────────────────────────────────────────────────

export type Jumlahan = { jumlah: number; nilai: number };

export function ringkasPerStatus(rows: { status: string; nilai: number }[]): {
  perStatus: Record<StatusBiaya, Jumlahan>;
  total: Jumlahan;
} {
  const perStatus = Object.fromEntries(STATUS_BIAYA.map((s) => [s, { jumlah: 0, nilai: 0 }])) as Record<StatusBiaya, Jumlahan>;
  const total: Jumlahan = { jumlah: 0, nilai: 0 };
  for (const r of rows) {
    const s = perStatus[r.status as StatusBiaya];
    if (!s) continue;
    s.jumlah += 1;
    s.nilai += r.nilai;
    total.jumlah += 1;
    total.nilai += r.nilai;
  }
  return { perStatus, total };
}
