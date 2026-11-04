/**
 * Rencana konten (grid feed lama, `ContentPlan`) — aturan murni, aman untuk
 * klien. Perbaikan 2026-10-07:
 *
 *   - Bug F: status mengikuti aturan perpindahan yang sama dengan tahap
 *     kolaborasi — MAJU boleh melompat tanpa alasan, MUNDUR wajib beralasan
 *     (alasannya masuk jejak). BATAL dari status apa pun kecuali TAYANG (yang
 *     sudah tayang tidak bisa dibatalkan; mundurkan dulu dengan alasan), dan
 *     konten BATAL boleh dihidupkan lagi ke status mana pun.
 *   - Bug G: "lewat jadwal" menurut HARI WIB — baru terlambat sesudah hari
 *     jadwalnya berganti, bukan sejak jam jadwalnya lewat.
 *   - Bug H: kode galat unggah diterjemahkan, bukan ditampilkan mentah.
 *   - Bug I: "pilih semua" hanya memilih ubin terlihat yang bergambar — hanya
 *     ubin itu yang punya kotak centang.
 */

import { formatDateOnlyJakarta } from "@/lib/date-only";

export type StatusRencanaKonten = "IDE" | "DRAFT" | "REVIEW" | "DIJADWALKAN" | "TAYANG" | "BATAL";

/** Urutan jalan; BATAL di luar urutan. */
export const URUTAN_STATUS_KONTEN = ["IDE", "DRAFT", "REVIEW", "DIJADWALKAN", "TAYANG"] as const satisfies readonly StatusRencanaKonten[];
export const SEMUA_STATUS_KONTEN: readonly StatusRencanaKonten[] = [...URUTAN_STATUS_KONTEN, "BATAL"];

export function statusKontenSah(v: unknown): v is StatusRencanaKonten {
  return typeof v === "string" && (SEMUA_STATUS_KONTEN as readonly string[]).includes(v);
}

export type JenisPindahKonten = "MAJU" | "MUNDUR" | "BATAL" | "HIDUP_LAGI";

const indeks = (s: StatusRencanaKonten) => (URUTAN_STATUS_KONTEN as readonly StatusRencanaKonten[]).indexOf(s);

/** Jenis perpindahan, atau `null` bila tidak ada (termasuk ke dirinya sendiri) atau tidak boleh. */
export function jenisPindahKonten(dari: StatusRencanaKonten, ke: StatusRencanaKonten): JenisPindahKonten | null {
  if (dari === ke) return null;
  if (dari === "BATAL") return "HIDUP_LAGI";
  if (ke === "BATAL") return dari === "TAYANG" ? null : "BATAL";
  return indeks(ke) > indeks(dari) ? "MAJU" : "MUNDUR";
}

export type HasilPindahKonten =
  | { boleh: true; jenis: JenisPindahKonten }
  | { boleh: false; sebab: "SAMA" | "TIDAK_BISA" | "ALASAN_WAJIB" };

export function bolehPindahStatusKonten(
  dari: StatusRencanaKonten,
  ke: StatusRencanaKonten,
  alasan?: string | null,
): HasilPindahKonten {
  if (dari === ke) return { boleh: false, sebab: "SAMA" };
  const jenis = jenisPindahKonten(dari, ke);
  if (!jenis) return { boleh: false, sebab: "TIDAK_BISA" };
  if (jenis === "MUNDUR" && !alasan?.trim()) return { boleh: false, sebab: "ALASAN_WAJIB" };
  return { boleh: true, jenis };
}

export function butuhAlasanKonten(dari: StatusRencanaKonten, ke: StatusRencanaKonten): boolean {
  return jenisPindahKonten(dari, ke) === "MUNDUR";
}

/**
 * Status yang ditawarkan dialog ubah: status sekarang + semua tujuan yang sah,
 * dalam urutan tampil. Dialog konten baru menawarkan semuanya.
 */
export function pilihanStatusKonten(dari: StatusRencanaKonten | null): StatusRencanaKonten[] {
  if (!dari) return [...SEMUA_STATUS_KONTEN];
  return SEMUA_STATUS_KONTEN.filter((ke) => ke === dari || jenisPindahKonten(dari, ke) !== null);
}

/**
 * Lewat jadwal menurut HARI WIB. Yang sudah tayang atau batal tidak pernah
 * terlambat — pekerjaannya selesai.
 */
export function kontenTelat(status: StatusRencanaKonten, jadwal: Date | string | null | undefined, hariIni: string): boolean {
  if (status === "TAYANG" || status === "BATAL" || !jadwal) return false;
  const d = jadwal instanceof Date ? jadwal : new Date(jadwal);
  if (Number.isNaN(d.getTime())) return false;
  return formatDateOnlyJakarta(d) < hariIni;
}

/** Id yang dipilih "Pilih semua": ubin terlihat yang bergambar (hanya itu yang bisa dicentang). */
export function idPilihSemua(konten: readonly { id: string; imageUrl: string | null }[]): string[] {
  return konten.filter((k) => Boolean(k.imageUrl?.trim())).map((k) => k.id);
}

/** Kode galat unggah foto yang punya terjemahan di namespace `foto` (`foto.err<KODE>`). */
export const KODE_GALAT_UNGGAH = ["FILE_WAJIB", "JENIS_TIDAK_DIIZINKAN", "TERLALU_BESAR", "TANPA_AKSES", "GAGAL"] as const;
export type KodeGalatUnggah = (typeof KODE_GALAT_UNGGAH)[number];

/**
 * Galat apa pun dari `unggahFoto` → kode yang punya terjemahan. Galat jaringan
 * ("Failed to fetch") dan kode lain jatuh ke GAGAL, bukan tampil sebagai kunci
 * terjemahan mentah.
 */
export function kodeGalatUnggah(err: unknown): KodeGalatUnggah {
  const pesan = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return (KODE_GALAT_UNGGAH as readonly string[]).includes(pesan) ? (pesan as KodeGalatUnggah) : "GAGAL";
}

/** Batas yang sama dengan `/api/foto` (sesudah diperkecil). */
export const MAKS_BYTE_FOTO = 6 * 1024 * 1024;

/** Pemeriksaan sebelum unggah: berkas bukan gambar langsung ditolak, tanpa perjalanan ke server. */
export function periksaBerkasFoto(file: { type: string } | null | undefined): KodeGalatUnggah | null {
  if (!file) return "FILE_WAJIB";
  return file.type.startsWith("image/") ? null : "JENIS_TIDAK_DIIZINKAN";
}
