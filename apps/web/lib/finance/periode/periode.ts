/*
 * Periode akuntansi & tutup buku (rancangan akuntansi & pajak lengkap, bagian
 * A1) — bagian MURNI: kalender bulan WIB, aturan urutan tutup/buka, dan
 * daftar periksa sebelum tutup. Aman untuk komponen klien (tanpa Prisma).
 *
 * Aturan yang dipegang (keputusan sementara pemilik, usulan Claude 2026-10-08):
 * - Bulan tanpa baris `AccountingPeriod` = TERBUKA.
 * - Bulan hanya bisa ditutup sesudah hari terakhirnya lewat (WIB).
 * - Bulan ditutup BERURUTAN mulai dari bulan pertama buku (bulan tanggal mulai
 *   buku besar; tanpa itu, bulan jurnal paling awal): menutup Maret ditolak
 *   selama Februari masih terbuka. Bulan sebelum bulan pertama buku boleh
 *   ditutup kapan saja — dan begitu bulan tanggal mulai buku besar ditutup,
 *   bulan-bulan sebelumnya ikut TERKUNCI tanpa baris periodenya sendiri
 *   (`terkunciSebelumBuku`; kuncinya ditegakkan `lockPeriodForPosting`).
 * - Bulan dibuka kembali dari BELAKANG: membuka Maret ditolak selama April
 *   tertutup, dan bulan di tahun yang sudah ditutup tidak bisa dibuka sebelum
 *   tahunnya dibuka. Membuka kembali WAJIB beralasan (jejak).
 * - Tahun ditutup sesudah kedua belas bulannya ditutup, berurutan dari tahun
 *   sebelumnya yang punya jurnal; dibuka kembali dari belakang.
 */

export type TahunBulan = { tahun: number; bulan: number };

export const STATUS_PERIODE = { TERBUKA: "OPEN", TERTUTUP: "CLOSED" } as const;
export type StatusPeriode = (typeof STATUS_PERIODE)[keyof typeof STATUS_PERIODE];

/** sourceType jurnal penutup tahun (dan pembaliknya saat tahun dibuka kembali). */
export const SUMBER_TUTUP_TAHUN = "YEAR_END_CLOSE";

/** Awalan sourceType jurnal saldo awal (bagian A2: `OPENING`, `OPENING_*`). */
export const AWALAN_SUMBER_SALDO_AWAL = "OPENING";

const WIB_MS = 7 * 60 * 60 * 1000;

/** Bulan WIB sebuah instan. */
export function bulanWib(tanggal: Date): TahunBulan {
  const wib = new Date(tanggal.getTime() + WIB_MS);
  return { tahun: wib.getUTCFullYear(), bulan: wib.getUTCMonth() + 1 };
}

/** "2026-09". */
export function kunciBulan(tb: TahunBulan): string {
  return `${tb.tahun}-${String(tb.bulan).padStart(2, "0")}`;
}

/** "2026-09" → { tahun, bulan }, atau null bila bukan bulan yang sah. */
export function bacaKunciBulan(teks: string | null | undefined): TahunBulan | null {
  const m = /^(\d{4})-(\d{2})$/.exec((teks ?? "").trim());
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  if (!tahunSah(tahun) || bulan < 1 || bulan > 12) return null;
  return { tahun, bulan };
}

export function tahunSah(tahun: number): boolean {
  return Number.isInteger(tahun) && tahun >= 2000 && tahun <= 2100;
}

export function bulanSah(tb: TahunBulan): boolean {
  return tahunSah(tb.tahun) && Number.isInteger(tb.bulan) && tb.bulan >= 1 && tb.bulan <= 12;
}

/** Urutan bulan: negatif bila a lebih dulu. */
export function bandingBulan(a: TahunBulan, b: TahunBulan): number {
  return a.tahun !== b.tahun ? a.tahun - b.tahun : a.bulan - b.bulan;
}

export function bulanSesudah(tb: TahunBulan): TahunBulan {
  return tb.bulan === 12 ? { tahun: tb.tahun + 1, bulan: 1 } : { tahun: tb.tahun, bulan: tb.bulan + 1 };
}

export function bulanSebelum(tb: TahunBulan): TahunBulan {
  return tb.bulan === 1 ? { tahun: tb.tahun - 1, bulan: 12 } : { tahun: tb.tahun, bulan: tb.bulan - 1 };
}

/** 00:00:00.000 WIB tanggal 1 dan 23:59:59.999 WIB hari terakhir bulan itu. */
export function rentangBulan(tb: TahunBulan): { awal: Date; akhir: Date } {
  const awal = new Date(Date.UTC(tb.tahun, tb.bulan - 1, 1) - WIB_MS);
  const berikut = bulanSesudah(tb);
  const akhir = new Date(Date.UTC(berikut.tahun, berikut.bulan - 1, 1) - WIB_MS - 1);
  return { awal, akhir };
}

/** Tanggal jurnal penutup tahun: 31 Desember 23:59:59 WIB — baris terakhir di buku besar tahun itu. */
export function tanggalTutupTahun(tahun: number): Date {
  return new Date(Date.UTC(tahun, 11, 31, 23, 59, 59) - WIB_MS);
}

/** Bulan-bulan dari `dari` sampai `sampai` (inklusif), berurutan. */
export function deretBulan(dari: TahunBulan, sampai: TahunBulan): TahunBulan[] {
  const hasil: TahunBulan[] = [];
  let b = dari;
  while (bandingBulan(b, sampai) <= 0 && hasil.length < 1200) {
    hasil.push(b);
    b = bulanSesudah(b);
  }
  return hasil;
}

/** Bulan sudah berakhir menurut WIB bila hari terakhirnya sebelum hari ini. */
export function bulanSudahBerakhir(tb: TahunBulan, sekarang: Date): boolean {
  return rentangBulan(tb).akhir.getTime() < sekarang.getTime();
}

/** Nama bulan untuk dibaca orang ("September 2026"). */
export function labelBulan(tb: TahunBulan, locale: string = "id"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(tb.tahun, tb.bulan - 1, 1)));
}

// ─── Kode penolakan ──────────────────────────────────────────────────────────

/**
 * Semua kode penolakan penulis dan aksi periode. Setiap kode punya teks di
 * `tutupBuku.err.<KODE>` (kedua bahasa) — `jejak.test.ts` menuntutnya.
 */
export const KODE_GALAT_PERIODE = [
  "TANPA_AKSES",
  "ISIAN_TIDAK_SAH",
  "BULAN_BELUM_BERAKHIR",
  "SUDAH_DITUTUP",
  "SUDAH_TERBUKA",
  "BULAN_SEBELUMNYA_TERBUKA",
  "BULAN_SESUDAHNYA_DITUTUP",
  "TAHUN_DITUTUP",
  "DAFTAR_PERIKSA_GAGAL",
  "PERINGATAN_BELUM_DISETUJUI",
  "ALASAN_WAJIB",
  "TAHUN_BELUM_BERAKHIR",
  "ADA_BULAN_TERBUKA",
  "TAHUN_SEBELUMNYA_TERBUKA",
  "TAHUN_SESUDAHNYA_DITUTUP",
  "TAHUN_SUDAH_DITUTUP",
  "TAHUN_BELUM_DITUTUP",
  "PERAN_BELUM_DIPETAKAN",
  "AKUN_TIDAK_BISA_DIPOSTING",
  "TANGGAL_TIDAK_SAH",
  "TANGGAL_MASA_DEPAN",
  "SUDAH_ADA_PERIODE_DITUTUP",
  "TANGGAL_SAMA",
  "GAGAL",
] as const;

export type KodeGalatPeriode = (typeof KODE_GALAT_PERIODE)[number];

/** Panjang minimum alasan membuka kembali (bulan atau tahun) — kalimat, bukan satu kata. */
export const MIN_ALASAN = 10;

export function alasanCukup(alasan: string | null | undefined): boolean {
  return (alasan ?? "").trim().length >= MIN_ALASAN;
}

// ─── Aturan urutan ───────────────────────────────────────────────────────────

/**
 * Bulan pertama buku — awal deret bulan yang harus ditutup berurutan: bulan
 * tanggal mulai buku besar; tanpa tanggal mulai, bulan jurnal berlaku paling
 * awal. null bila keduanya tidak ada (buku kosong).
 *
 * Tanggal mulai didahulukan walau ada jurnal lebih awal (jurnal saldo awal
 * bertanggal sehari sebelumnya, atau jurnal manual yang salah tanggal): satu
 * jurnal salah tanggal tahun 2016 tidak boleh memaksa keuangan menutup sepuluh
 * tahun bulan kosong sebelum bisa menutup bulan ini. Bulan sebelum bulan
 * pertama tetap boleh ditutup kapan saja.
 */
export function bulanPertamaBuku(tanggalMulai: TahunBulan | null, jurnalAwal: TahunBulan | null): TahunBulan | null {
  return tanggalMulai ?? jurnalAwal;
}

/**
 * Bulan TERBUKA paling awal yang menahan penutupan `target`: bulan antara
 * bulan pertama buku dan bulan sebelum `target` yang belum ditutup. null bila
 * tidak ada (boleh ditutup). `tertutup` = himpunan `kunciBulan` yang CLOSED.
 */
export function bulanPenahanTutup(
  target: TahunBulan,
  pertama: TahunBulan | null,
  tertutup: ReadonlySet<string>,
): TahunBulan | null {
  if (!pertama || bandingBulan(target, pertama) <= 0) return null;
  for (const b of deretBulan(pertama, bulanSebelum(target))) {
    if (!tertutup.has(kunciBulan(b))) return b;
  }
  return null;
}

/**
 * Bulan sebelum bulan tanggal mulai buku besar TERKUNCI begitu bulan tanggal
 * mulai ditutup: jurnal di sana mengubah neraca bulan-bulan yang sudah
 * ditutup. Cermin aturan `lockPeriodForPosting` (`@elorae/db` period-lock) —
 * ubah keduanya bersama. Tanpa tanggal mulai tidak ada kunci turunan.
 */
export function terkunciSebelumBuku(tb: TahunBulan, bulanMulai: TahunBulan | null, tertutup: ReadonlySet<string>): boolean {
  return bulanMulai !== null && bandingBulan(tb, bulanMulai) < 0 && tertutup.has(kunciBulan(bulanMulai));
}

// ─── Daftar periksa sebelum tutup ────────────────────────────────────────────

/**
 * Butir daftar periksa. `WAJIB` yang gagal menahan penutupan; `PERINGATAN`
 * yang gagal boleh dilewati dengan persetujuan tertulis (dicatat di jejak).
 * `BELUM_BERLAKU` = fiturnya belum dipakai/belum dibangun — DITAMPILKAN,
 * tidak disembunyikan, supaya keuangan tahu butir itu ada.
 */
export const KUNCI_PERIKSA = [
  "jurnalDraf",
  "dokumenTanpaJurnal",
  "jurnalGagalTanpaTanggal",
  "rekonsiliasiBank",
  "penyusutan",
  "rekapPpn",
  "settlement",
] as const;

export type KunciPeriksa = (typeof KUNCI_PERIKSA)[number];

export const TINGKAT_PERIKSA: Readonly<Record<KunciPeriksa, "WAJIB" | "PERINGATAN">> = {
  jurnalDraf: "WAJIB",
  dokumenTanpaJurnal: "WAJIB",
  jurnalGagalTanpaTanggal: "PERINGATAN",
  rekonsiliasiBank: "PERINGATAN",
  penyusutan: "PERINGATAN",
  rekapPpn: "PERINGATAN",
  settlement: "PERINGATAN",
};

export type KeadaanPeriksa = "LULUS" | "GAGAL" | "BELUM_BERLAKU";

export type RincianPeriksa = { label: string; jumlah: number };

export type ButirPeriksa = {
  kunci: KunciPeriksa;
  tingkat: "WAJIB" | "PERINGATAN";
  keadaan: KeadaanPeriksa;
  /** Jumlah yang menahan (0 bila lulus). */
  jumlah: number;
  rincian: RincianPeriksa[];
  /** Alasan "belum berlaku" (kunci i18n `tutupBuku.periksa.belum.<sebab>`). */
  sebabBelumBerlaku?: string;
};

/**
 * Data mentah daftar periksa satu bulan. `null` pada sebuah butir = butir itu
 * belum berlaku (dengan `sebab`); angka = jumlah yang menahan.
 */
export type DataPeriksa = {
  jurnalDraf: number;
  dokumenTanpaJurnal: { jumlah: number; rincian: RincianPeriksa[] } | { belum: string };
  jurnalGagalTanpaTanggal: number;
  rekonsiliasiBank: { jumlah: number; rincian: RincianPeriksa[] } | { belum: string };
  penyusutan: { jumlah: number } | { belum: string };
  rekapPpn: { selesai: boolean } | { belum: string };
  settlement: { tanpaUnggahan: string[] } | { belum: string };
};

export type DaftarPeriksa = {
  butir: ButirPeriksa[];
  /** Tidak ada butir WAJIB yang gagal. */
  bolehTutup: boolean;
  /** Ada butir PERINGATAN yang gagal — menutup butuh persetujuan tertulis. */
  perluPersetujuan: boolean;
};

function butir(
  kunci: KunciPeriksa,
  jumlah: number,
  rincian: RincianPeriksa[] = [],
): ButirPeriksa {
  return { kunci, tingkat: TINGKAT_PERIKSA[kunci], keadaan: jumlah > 0 ? "GAGAL" : "LULUS", jumlah, rincian };
}

function belum(kunci: KunciPeriksa, sebab: string): ButirPeriksa {
  return { kunci, tingkat: TINGKAT_PERIKSA[kunci], keadaan: "BELUM_BERLAKU", jumlah: 0, rincian: [], sebabBelumBerlaku: sebab };
}

export function nilaiDaftarPeriksa(d: DataPeriksa): DaftarPeriksa {
  const daftar: ButirPeriksa[] = [
    butir("jurnalDraf", d.jurnalDraf),
    "belum" in d.dokumenTanpaJurnal
      ? belum("dokumenTanpaJurnal", d.dokumenTanpaJurnal.belum)
      : butir("dokumenTanpaJurnal", d.dokumenTanpaJurnal.jumlah, d.dokumenTanpaJurnal.rincian),
    butir("jurnalGagalTanpaTanggal", d.jurnalGagalTanpaTanggal),
    "belum" in d.rekonsiliasiBank
      ? belum("rekonsiliasiBank", d.rekonsiliasiBank.belum)
      : butir("rekonsiliasiBank", d.rekonsiliasiBank.jumlah, d.rekonsiliasiBank.rincian),
    "belum" in d.penyusutan ? belum("penyusutan", d.penyusutan.belum) : butir("penyusutan", d.penyusutan.jumlah),
    "belum" in d.rekapPpn ? belum("rekapPpn", d.rekapPpn.belum) : butir("rekapPpn", d.rekapPpn.selesai ? 0 : 1),
    "belum" in d.settlement
      ? belum("settlement", d.settlement.belum)
      : butir(
          "settlement",
          d.settlement.tanpaUnggahan.length,
          d.settlement.tanpaUnggahan.map((label) => ({ label, jumlah: 1 })),
        ),
  ];
  return {
    butir: daftar,
    bolehTutup: !daftar.some((b) => b.tingkat === "WAJIB" && b.keadaan === "GAGAL"),
    perluPersetujuan: daftar.some((b) => b.tingkat === "PERINGATAN" && b.keadaan === "GAGAL"),
  };
}

/** Ringkasan untuk jejak: butir yang gagal beserta jumlahnya. */
export function ringkasDaftarPeriksa(d: DaftarPeriksa): Record<string, number> {
  return Object.fromEntries(d.butir.filter((b) => b.keadaan === "GAGAL").map((b) => [b.kunci, b.jumlah]));
}
