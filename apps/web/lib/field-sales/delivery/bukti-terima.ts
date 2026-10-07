import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Aturan bukti terima digital (proof of delivery) untuk satu pengiriman putus.
 *
 * Murni — tanpa basis data, tanpa server — supaya dipakai bersama oleh penulis,
 * formulir HP, dan dialog kantor, dan bisa dites tanpa apa pun.
 *
 * Bukti terima tidak menggerakkan stok maupun uang. Gunanya satu: kalau toko
 * kelak berkata "barangnya tidak pernah sampai", ada nama penerima, jamnya, dan
 * gambar nota bertanda tangan (atau tanda tangan di layar) yang menjawabnya.
 */

export const BATAS_NAMA = { min: 2, max: 100 } as const;

/** Jam HP boleh lebih cepat dari server sebanyak ini sebelum waktunya dianggap "di masa depan". */
export const TOLERANSI_JAM_MS = 5 * 60_000;

const MAKS_ALASAN = 500;
const MAKS_KUNCI = 64;

export const JENIS_BUKTI = ["FOTO", "TANDA_TANGAN"] as const;
export type JenisBukti = (typeof JENIS_BUKTI)[number];

export type KeadaanBuktiTerima = "BELUM_DITERIMA" | "DITERIMA";

/** Keadaan bukti satu pengiriman. Satu sumber: ada jam terima = sudah diterima. */
export function keadaanBuktiTerima(d: { receivedAt: Date | string | null }): KeadaanBuktiTerima {
  return d.receivedAt ? "DITERIMA" : "BELUM_DITERIMA";
}

/**
 * Semua penolakan yang bisa dikembalikan pencatatan atau koreksi bukti terima.
 * `GAGAL` = galat server tak terduga (dipakai aksi, bukan penulis) — satu-satunya
 * yang layak diulang oleh antrean HP selain `WAKTU_DI_MASA_DEPAN`.
 */
export type KodeBuktiTerima =
  | "TANPA_AKSES"
  | "TIDAK_DITEMUKAN"
  | "NAMA_TIDAK_SAH"
  | "WAKTU_TIDAK_SAH"
  | "WAKTU_DI_MASA_DEPAN"
  | "WAKTU_SEBELUM_KIRIM"
  | "FOTO_WAJIB"
  | "FOTO_TIDAK_SAH"
  | "FOTO_TIDAK_DITEMUKAN"
  /** Foto sama persis dengan foto orang lain yang sudah dipakai dokumen lain (foto dicuci). */
  | "FOTO_SUDAH_DIPAKAI"
  | "JENIS_BUKTI_TIDAK_SAH"
  | "ALASAN_WAJIB"
  | "KUNCI_TIDAK_SAH"
  | "SUDAH_DITERIMA"
  | "BELUM_DITERIMA"
  | "KONFLIK"
  | "TIDAK_BERUBAH"
  | "GAGAL";

/**
 * Nama penerima dirapikan: spasi di ujung dibuang, spasi beruntun jadi satu.
 * `null` kalau bukan teks atau panjangnya di luar batas — termasuk objek yang
 * pura-pura bisa jadi teks, karena aksi server adalah titik jaringan.
 */
export function rapikanNamaPenerima(teks: unknown): string | null {
  if (typeof teks !== "string") return null;
  const rapi = teks.replace(/\s+/g, " ").trim();
  if (rapi.length < BATAS_NAMA.min || rapi.length > BATAS_NAMA.max) return null;
  return rapi;
}

const POLA_FOTO = /^\/api\/foto\/([A-Za-z0-9_-]{1,64})$/;

/**
 * Id foto dari jalur internal `/api/foto/<id>`, atau `null`.
 *
 * Hanya jalur foto milik aplikasi ini yang diterima. URL luar berarti bukti
 * yang isinya bisa diganti orang lain kapan saja tanpa jejak — dan foto di sini
 * memang tidak pernah keluar dari basis data (`Foto`).
 */
export function idFotoDariUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = POLA_FOTO.exec(url);
  return m ? m[1] : null;
}

/**
 * Waktu paling awal barang masuk akal diterima: yang paling dini dari tanggal
 * nota, saat barang dicatat keluar, dan saat dokumennya dibuat.
 *
 * Yang paling dini, bukan salah satunya: tanggal nota diketik orang dan bisa
 * mundur (barang berangkat kemarin, dicatat hari ini) maupun maju; pengiriman
 * hasil isi-ulang data lama dibuat jauh sesudah barangnya sampai.
 */
export function batasAwalTerima(k: { invoiceDate: Date; deliveredAt: Date; createdAt?: Date | null }): Date {
  const kandidat = [k.invoiceDate, k.deliveredAt, k.createdAt].filter((d): d is Date => d instanceof Date);
  return new Date(Math.min(...kandidat.map((d) => d.getTime())));
}

/** `null` = waktu terima masuk akal untuk pengiriman ini pada `sekarang`. */
export function periksaWaktuTerima(
  waktu: Date,
  kiriman: { invoiceDate: Date; deliveredAt: Date; createdAt?: Date | null },
  sekarang: Date,
): "WAKTU_DI_MASA_DEPAN" | "WAKTU_SEBELUM_KIRIM" | null {
  if (waktu.getTime() > sekarang.getTime() + TOLERANSI_JAM_MS) return "WAKTU_DI_MASA_DEPAN";
  if (waktu.getTime() < batasAwalTerima(kiriman).getTime()) return "WAKTU_SEBELUM_KIRIM";
  return null;
}

const WIB_MS = 7 * 60 * 60_000;
const POLA_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Instan → nilai `datetime-local` menurut jam WIB ("YYYY-MM-DDTHH:mm").
 *
 * Isian waktu dipatok WIB, bukan zona HP, supaya jam yang diketik sama dengan
 * jam yang kemudian tampil di setiap layar (semuanya WIB). WIB tidak punya jam
 * musim panas, jadi geser tetap +7 cukup.
 */
export function waktuWibUntukInput(d: Date): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 16);
}

/** Kebalikan `waktuWibUntukInput`. `null` untuk bentuk lain atau tanggal yang "menggelinding" (30 Feb). */
export function bacaWaktuInputWib(teks: string): Date | null {
  const m = POLA_INPUT.exec(teks);
  if (!m) return null;
  const [, th, bl, tg, jm, mn] = m.map(Number);
  if (jm > 23 || mn > 59) return null;
  const d = new Date(Date.UTC(th, bl - 1, tg, jm, mn) - WIB_MS);
  return waktuWibUntukInput(d) === teks ? d : null;
}

export type NilaiBuktiTerima = {
  receivedByName: string;
  receivedAt: Date;
  podPhotoUrl: string;
  fotoId: string;
  idempotencyKey: string;
  /** Hanya koreksi; `null` untuk pencatatan pertama. */
  reason: string | null;
  jenisBukti: JenisBukti | null;
};

/**
 * Periksa bentuk masukan sebelum menyentuh basis data. Waktu terhadap
 * pengirimannya diperiksa penulis (butuh baris pengirimannya).
 */
export function periksaMasukanBuktiTerima(
  m: {
    receivedByName: unknown;
    receivedAt: unknown;
    podPhotoUrl: unknown;
    idempotencyKey: unknown;
    reason?: unknown;
    jenisBukti?: unknown;
  },
  jenis: "CATAT" | "KOREKSI",
): { ok: true; nilai: NilaiBuktiTerima } | { ok: false; kode: KodeBuktiTerima } {
  if (typeof m.idempotencyKey !== "string" || m.idempotencyKey.trim() === "" || m.idempotencyKey.length > MAKS_KUNCI) {
    return { ok: false, kode: "KUNCI_TIDAK_SAH" };
  }
  const receivedByName = rapikanNamaPenerima(m.receivedByName);
  if (!receivedByName) return { ok: false, kode: "NAMA_TIDAK_SAH" };

  if (typeof m.receivedAt !== "string" && !(m.receivedAt instanceof Date)) return { ok: false, kode: "WAKTU_TIDAK_SAH" };
  const receivedAt = m.receivedAt instanceof Date ? new Date(m.receivedAt.getTime()) : new Date(m.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return { ok: false, kode: "WAKTU_TIDAK_SAH" };

  if (m.podPhotoUrl === null || m.podPhotoUrl === undefined || m.podPhotoUrl === "") return { ok: false, kode: "FOTO_WAJIB" };
  const fotoId = idFotoDariUrl(m.podPhotoUrl);
  if (!fotoId) return { ok: false, kode: "FOTO_TIDAK_SAH" };

  let jenisBukti: JenisBukti | null = null;
  if (m.jenisBukti !== undefined && m.jenisBukti !== null) {
    if (!JENIS_BUKTI.includes(m.jenisBukti as JenisBukti)) return { ok: false, kode: "JENIS_BUKTI_TIDAK_SAH" };
    jenisBukti = m.jenisBukti as JenisBukti;
  }

  let reason: string | null = null;
  if (jenis === "KOREKSI") {
    const r = typeof m.reason === "string" ? m.reason.trim() : "";
    if (r === "" || r.length > MAKS_ALASAN) return { ok: false, kode: "ALASAN_WAJIB" };
    reason = r;
  }

  return {
    ok: true,
    nilai: {
      receivedByName,
      receivedAt,
      podPhotoUrl: m.podPhotoUrl as string,
      fotoId,
      idempotencyKey: m.idempotencyKey,
      reason,
      jenisBukti,
    },
  };
}

function kantor(izin: string[]): boolean {
  return (
    hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_DELIVER) || hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)
  );
}

/**
 * Siapa yang mencatat bukti ini — dan apakah boleh sama sekali.
 *
 * - `KANTOR`: pemegang izin kirim atau setujui pesanan lapangan (nota kembali
 *   ke kantor, admin memotret dan mencatat).
 * - `SALESMAN`: salesman PEMILIK pesanan, dari HP (`pwa:access`). Salesman lain
 *   ditolak walaupun memegang izin yang sama — bukti terima toko orang lain
 *   bukan sesuatu yang ia saksikan.
 */
export function sumberPencatat(p: { izin: string[] | undefined; userId: string; salesmanId: string }): "KANTOR" | "SALESMAN" | null {
  const izin = p.izin ?? [];
  if (kantor(izin)) return "KANTOR";
  if (p.userId === p.salesmanId && hasPermission(izin, "pwa:access")) return "SALESMAN";
  return null;
}

/**
 * Mengoreksi bukti yang sudah tercatat: kantor saja.
 *
 * Bukti terima melindungi perusahaan dari sangkalan toko; kalau yang mencatat
 * bisa menulis ulang buktinya sendiri, nilainya hilang. Salah ketik dari HP
 * dibetulkan kantor, dengan alasan, dan jejaknya tersimpan.
 */
export function bolehMengoreksiBuktiTerima(izin: string[] | undefined): boolean {
  return kantor(izin ?? []);
}

type IsiBukti = { receivedByName: string | null; receivedAt: Date | null; podPhotoUrl: string | null };

/** Dua isi bukti sama persis (nama, instan, foto) — dasar kiriman ulang yang aman. */
export function samaIsinya(a: IsiBukti, b: IsiBukti): boolean {
  if (!a.receivedAt || !b.receivedAt) return false;
  return (
    a.receivedByName === b.receivedByName &&
    a.receivedAt.getTime() === b.receivedAt.getTime() &&
    a.podPhotoUrl === b.podPhotoUrl
  );
}
