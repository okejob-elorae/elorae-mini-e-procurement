/**
 * Kode penolakan aksi stock opname.
 *
 * Aksi opname dulu mengembalikan `err.message` mentah ("Opname not found",
 * "Forbidden: Insufficient permissions", galat Prisma) atau teks cadangan
 * Inggris ("Failed to create opname"), dan layar menampilkannya apa adanya.
 * Sekarang aksi mengembalikan KODE; layar menerjemahkannya
 * (`stockOpname.galat.<KODE>`). Murni — dites tanpa basis data.
 */
export const KODE_GALAT_OPNAME = [
  "TIDAK_ADA",
  "TANPA_BARIS",
  "TIDAK_BISA_DIUBAH",
  "HITUNGAN_DITUTUP",
  "BUKAN_KAIN",
  "STATUS_TIDAK_BISA_DIKIRIM",
  "ROLL_BELUM_DIISI",
  "BARIS_BELUM_DIISI",
  "BELUM_DIKIRIM",
  "TIDAK_BISA_DIBATALKAN",
  "SETUJUI_SENDIRI",
  "TANPA_IZIN",
  "GAGAL",
] as const;

export type KodeGalatOpname = (typeof KODE_GALAT_OPNAME)[number];

/** Pesan yang dilempar di dalam aksi → kode. Kunci = awal pesan (pesan bisa diberi akhiran). */
const POLA: ReadonlyArray<readonly [RegExp, KodeGalatOpname]> = [
  [/^Opname not found/i, "TIDAK_ADA"],
  [/^Tidak ada item\/roll/i, "TANPA_BARIS"],
  [/^Opname tidak dapat diubah/i, "TIDAK_BISA_DIUBAH"],
  [/^Opname sudah dikirim untuk persetujuan/i, "HITUNGAN_DITUTUP"],
  [/^Opname bukan scope kain/i, "BUKAN_KAIN"],
  [/^Status opname tidak valid untuk submit/i, "STATUS_TIDAK_BISA_DIKIRIM"],
  [/^Semua roll harus diisi/i, "ROLL_BELUM_DIISI"],
  [/^Semua baris harus diisi/i, "BARIS_BELUM_DIISI"],
  [/^Opname belum disubmit/i, "BELUM_DIKIRIM"],
  [/^Opname tidak dapat dibatalkan/i, "TIDAK_BISA_DIBATALKAN"],
  [/^Penghitung tidak dapat menyetujui/i, "SETUJUI_SENDIRI"],
  [/^(Forbidden|Unauthorized)/i, "TANPA_IZIN"],
];

export function kodeGalatOpname(err: unknown): KodeGalatOpname {
  const pesan = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [pola, kode] of POLA) if (pola.test(pesan)) return kode;
  return "GAGAL";
}

/** Kunci i18n untuk sebuah kode; kode tak dikenal (jawaban lama) → GAGAL. */
export function kunciGalatOpname(kode: string | undefined | null): `galat.${KodeGalatOpname}` {
  const k = (KODE_GALAT_OPNAME as readonly string[]).includes(kode ?? "") ? (kode as KodeGalatOpname) : "GAGAL";
  return `galat.${k}`;
}
