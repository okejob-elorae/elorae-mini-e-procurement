/**
 * Aturan pengumuman kantor → lapangan — murni, tanpa basis data, aman dibundel
 * ke klien (formulir backoffice memakai `AUDIENS` dan batas panjangnya).
 *
 * Keadaan pengumuman TIDAK disimpan: ia diturunkan dari waktu terbit,
 * kedaluwarsa, dan arsip setiap kali dibaca. Satu sumber untuk HP, daftar
 * kantor, dan kiriman kabar — `whereKeadaan` adalah terjemahan yang setara
 * untuk penyaringan di basis data, dan tesnya menjaga keduanya sepakat.
 */

export const AUDIENS = ["SEMUA", "SALESMAN", "SPG"] as const;
export type Audiens = (typeof AUDIENS)[number];

export type PeranLapangan = "SALESMAN" | "SPG";

export const KEADAAN_PENGUMUMAN = ["AKTIF", "TERJADWAL", "KEDALUWARSA", "DIARSIPKAN"] as const;
export type KeadaanPengumuman = (typeof KEADAAN_PENGUMUMAN)[number];

export const BATAS_JUDUL = 120;
export const BATAS_ISI = 5000;

/** Kabar untuk jadwal yang terlewat (mis. cron baru dipasang) hanya dikirim bila terbitnya belum selama ini. */
export const UMUR_MAKS_KABAR_MS = 3 * 24 * 60 * 60 * 1000;

type Waktu = { publishedAt: Date; expiresAt: Date | null; archivedAt: Date | null };

export function keadaanPengumuman(a: Waktu, sekarang: Date): KeadaanPengumuman {
  if (a.archivedAt) return "DIARSIPKAN";
  if (a.publishedAt.getTime() > sekarang.getTime()) return "TERJADWAL";
  if (a.expiresAt && a.expiresAt.getTime() <= sekarang.getTime()) return "KEDALUWARSA";
  return "AKTIF";
}

/**
 * Filter Prisma yang setara dengan `keadaanPengumuman`. KEDALUWARSA tidak perlu
 * syarat terbit: kedaluwarsa selalu sesudah terbit (dijaga `validasiPengumuman`).
 */
export function whereKeadaan(keadaan: KeadaanPengumuman, sekarang: Date) {
  switch (keadaan) {
    case "AKTIF":
      return {
        archivedAt: null,
        publishedAt: { lte: sekarang },
        OR: [{ expiresAt: null }, { expiresAt: { gt: sekarang } }],
      };
    case "TERJADWAL":
      return { archivedAt: null, publishedAt: { gt: sekarang } };
    case "KEDALUWARSA":
      return { archivedAt: null, expiresAt: { lte: sekarang } };
    case "DIARSIPKAN":
      return { archivedAt: { not: null } };
  }
}

/**
 * Peran lapangan dari toko tetapnya — definisi yang sama dengan `daftarSpg`/
 * `daftarSalesman` dan dengan layout `/pwa` (SPG = punya `assignedStoreId`).
 */
export function peranDari(assignedStoreId: string | null): PeranLapangan {
  return assignedStoreId ? "SPG" : "SALESMAN";
}

export function bacaAudiens(v: unknown): Audiens | null {
  return typeof v === "string" && (AUDIENS as readonly string[]).includes(v) ? (v as Audiens) : null;
}

export function audiensMencakup(audience: string, peran: PeranLapangan): boolean {
  const a = bacaAudiens(audience);
  if (!a) return false;
  return a === "SEMUA" || a === peran;
}

/**
 * Tambahan syarat `User` untuk sebuah audiens (di atas syarat "orang lapangan":
 * peran tidak-sistem yang memegang `pwa:access`). `null` = audiens tak dikenal
 * — penerimanya KOSONG, bukan semua orang.
 */
export function syaratAudiens(audience: string): { assignedStoreId?: null | { not: null } } | null {
  switch (bacaAudiens(audience)) {
    case "SEMUA":
      return {};
    case "SALESMAN":
      return { assignedStoreId: null };
    case "SPG":
      return { assignedStoreId: { not: null } };
    default:
      return null;
  }
}

/** Terlihat di HP orang dengan peran ini sekarang: aktif dan audiensnya mencakup dia. */
export function terlihatDiHp(a: Waktu & { audience: string }, peran: PeranLapangan, sekarang: Date): boolean {
  return keadaanPengumuman(a, sekarang) === "AKTIF" && audiensMencakup(a.audience, peran);
}

// ── Waktu isian (datetime-local, WIB) ─────────────────────────────────────

const POLA_WAKTU = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" (isian `datetime-local`) dibaca sebagai jam WIB. */
export function parseWaktuWib(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = POLA_WAKTU.exec(v.trim());
  if (!m) return null;
  const [, th, bl, tg, jm, mn] = m;
  const d = new Date(`${th}-${bl}-${tg}T${jm}:${mn}:00+07:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Tanggal mustahil (30 Februari) digulirkan Date ke bulan berikut — tolak.
  if (keInputWib(d) !== `${th}-${bl}-${tg}T${jm}:${mn}`) return null;
  return d;
}

/** Kebalikan `parseWaktuWib`: isi awal formulir, selalu jam WIB apa pun zona server. */
export function keInputWib(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const ambil = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${ambil("year")}-${ambil("month")}-${ambil("day")}T${ambil("hour")}:${ambil("minute")}`;
}

// ── Validasi isian ────────────────────────────────────────────────────────

export type IsianPengumuman = {
  title: unknown;
  body: unknown;
  audience: unknown;
  pinned?: unknown;
  requireAck?: unknown;
  /** "" / null = terbitkan sekarang. */
  publishedAt?: unknown;
  /** "" / null = tanpa batas. */
  expiresAt?: unknown;
};

export type PengumumanSah = {
  title: string;
  body: string;
  audience: Audiens;
  pinned: boolean;
  requireAck: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
};

export type KolomPengumuman = "title" | "body" | "audience" | "publishedAt" | "expiresAt";
export type KodeGalatPengumuman =
  | "JUDUL_KOSONG"
  | "JUDUL_PANJANG"
  | "ISI_KOSONG"
  | "ISI_PANJANG"
  | "AUDIENS_TIDAK_SAH"
  | "TERBIT_TIDAK_SAH"
  | "KEDALUWARSA_TIDAK_SAH"
  | "KEDALUWARSA_SEBELUM_TERBIT"
  | "KEDALUWARSA_LEWAT";
export type GalatPengumuman = { kolom: KolomPengumuman; kode: KodeGalatPengumuman };

function kosong(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Validasi isian formulir (juga dipanggil ulang oleh penulis — formulir hanya
 * membantu, bukan penjaga).
 *
 * - Terbit tidak bisa dimundurkan: waktu lampau (termasuk isian bawaan
 *   "sekarang" yang dibuat beberapa menit lalu) dibaca sebagai sekarang.
 * - Yang SUDAH terbit dikunci waktu terbitnya: menjadwalkan ulang akan
 *   menyembunyikan pengumuman yang sudah dibaca orang.
 * - Kedaluwarsa harus sesudah terbit; dan bila baru diisi atau diubah, harus di
 *   depan — untuk mengakhiri pengumuman sekarang, arsipkan. Kedaluwarsa lampau
 *   yang tidak disentuh tetap boleh (memperbaiki judul pengumuman lama).
 */
export function validasiPengumuman(
  isian: IsianPengumuman,
  ctx: { sekarang: Date; lama?: { publishedAt: Date; expiresAt: Date | null } },
): { ok: true; data: PengumumanSah } | { ok: false; galat: GalatPengumuman[] } {
  const galat: GalatPengumuman[] = [];
  const { sekarang, lama } = ctx;

  const title = typeof isian.title === "string" ? isian.title.trim().replace(/\s+/g, " ") : "";
  if (!title) galat.push({ kolom: "title", kode: "JUDUL_KOSONG" });
  else if (title.length > BATAS_JUDUL) galat.push({ kolom: "title", kode: "JUDUL_PANJANG" });

  const body = typeof isian.body === "string" ? isian.body.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) galat.push({ kolom: "body", kode: "ISI_KOSONG" });
  else if (body.length > BATAS_ISI) galat.push({ kolom: "body", kode: "ISI_PANJANG" });

  const audience = bacaAudiens(isian.audience);
  if (!audience) galat.push({ kolom: "audience", kode: "AUDIENS_TIDAK_SAH" });

  let publishedAt: Date = sekarang;
  if (lama && lama.publishedAt.getTime() <= sekarang.getTime()) {
    publishedAt = lama.publishedAt;
  } else if (!kosong(isian.publishedAt)) {
    const p = parseWaktuWib(isian.publishedAt);
    if (!p) galat.push({ kolom: "publishedAt", kode: "TERBIT_TIDAK_SAH" });
    else publishedAt = p.getTime() > sekarang.getTime() ? p : sekarang;
  }

  let expiresAt: Date | null = null;
  if (!kosong(isian.expiresAt)) {
    const e = parseWaktuWib(isian.expiresAt);
    if (!e) {
      galat.push({ kolom: "expiresAt", kode: "KEDALUWARSA_TIDAK_SAH" });
    } else {
      expiresAt = e;
      // Isian datetime-local hanya sampai menit: bandingkan dengan nilai lama yang dibulatkan sama.
      const tidakDiubah = lama?.expiresAt != null && keInputWib(lama.expiresAt) === keInputWib(e);
      if (tidakDiubah && lama?.expiresAt) expiresAt = lama.expiresAt;
      if (expiresAt.getTime() <= publishedAt.getTime()) {
        galat.push({ kolom: "expiresAt", kode: "KEDALUWARSA_SEBELUM_TERBIT" });
      } else if (!tidakDiubah && expiresAt.getTime() <= sekarang.getTime()) {
        galat.push({ kolom: "expiresAt", kode: "KEDALUWARSA_LEWAT" });
      }
    }
  }

  if (galat.length > 0 || !audience) return { ok: false, galat };
  return {
    ok: true,
    data: {
      title,
      body,
      audience,
      pinned: isian.pinned === true,
      requireAck: isian.requireAck === true,
      publishedAt,
      expiresAt,
    },
  };
}

// ── Kabar ─────────────────────────────────────────────────────────────────

/**
 * Perlu dikabarkan ke penerimanya sekarang: AKTIF dan belum pernah dikabarkan.
 * `umurMaksMs` dipakai penyapu jadwal supaya pengumuman lama yang terlewat
 * (mis. sebelum penyapunya dipasang) tidak tiba-tiba berbunyi di semua HP.
 */
export function perluKabar(
  a: Waktu,
  sekarang: Date,
  sudahDikabarkan: boolean,
  opsi: { umurMaksMs?: number } = {},
): boolean {
  if (sudahDikabarkan) return false;
  if (keadaanPengumuman(a, sekarang) !== "AKTIF") return false;
  if (opsi.umurMaksMs !== undefined && sekarang.getTime() - a.publishedAt.getTime() > opsi.umurMaksMs) return false;
  return true;
}

/** Potongan isi satu baris: spasi dan baris dirapatkan, dipotong di batas kata. */
export function cuplikan(teks: string, maks = 140): string {
  const rata = teks.replace(/\s+/g, " ").trim();
  if (rata.length <= maks) return rata;
  const potong = rata.slice(0, maks - 1);
  const spasi = potong.lastIndexOf(" ");
  const dasar = spasi > maks / 2 ? potong.slice(0, spasi) : potong;
  return `${dasar.trimEnd()}…`;
}

// ── Urutan di HP ──────────────────────────────────────────────────────────

export type BarisUrut = {
  id: string;
  pinned: boolean;
  publishedAt: Date;
  dibaca: boolean;
  /** Wajib konfirmasi dan orang ini belum menekan "Saya mengerti". */
  perluKonfirmasi: boolean;
};

const terbaru = <T extends BarisUrut>(a: T, b: T) => b.publishedAt.getTime() - a.publishedAt.getTime() || a.id.localeCompare(b.id);

/** Daftar HP: tersemat dulu, lalu terbaru. */
export function urutkanUntukHp<T extends BarisUrut>(baris: readonly T[]): T[] {
  return [...baris].sort((a, b) => Number(b.pinned) - Number(a.pinned) || terbaru(a, b));
}

/**
 * Kartu beranda: hanya yang perlu dilihat — tersemat, menunggu konfirmasi, atau
 * belum dibaca — paling banyak `maks`. Urutan: tersemat, menunggu konfirmasi,
 * belum dibaca; di dalamnya terbaru dulu. `lainnya` = calon yang tidak muat.
 */
export function pilihKartuBeranda<T extends BarisUrut>(
  baris: readonly T[],
  maks = 3,
): { baris: T[]; belumDibaca: number; perluKonfirmasi: number; lainnya: number } {
  const peringkat = (x: T) => (x.pinned ? 0 : x.perluKonfirmasi ? 1 : 2);
  const calon = baris
    .filter((x) => x.pinned || x.perluKonfirmasi || !x.dibaca)
    .sort((a, b) => peringkat(a) - peringkat(b) || terbaru(a, b));
  return {
    baris: calon.slice(0, maks),
    belumDibaca: baris.filter((x) => !x.dibaca).length,
    perluKonfirmasi: baris.filter((x) => x.perluKonfirmasi).length,
    lainnya: Math.max(0, calon.length - maks),
  };
}

/**
 * Isian awal formulir saat saklar dinyalakan: jadwal = besok 08.00 WIB,
 * berakhir = 7 hari lagi 23.59 WIB (dihitung dari hari WIB `sekarang`).
 */
export function saranWaktuForm(sekarang: Date): { terbit: string; berakhir: string } {
  const hari = keInputWib(sekarang).slice(0, 10);
  const geser = (n: number) => keInputWib(new Date(Date.parse(`${hari}T12:00:00+07:00`) + n * 24 * 60 * 60 * 1000)).slice(0, 10);
  return { terbit: `${geser(1)}T08:00`, berakhir: `${geser(7)}T23:59` };
}
