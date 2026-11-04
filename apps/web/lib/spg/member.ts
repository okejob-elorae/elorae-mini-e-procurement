/**
 * Member Elorae — aturan murni (tanpa Prisma), dipakai server, layar kantor,
 * dan HP SPG. Keputusan sementara pemilik 98–110 (2026-10-20, "yang belum ada
 * tambahkan saja"):
 *
 * - Member berlaku di SEMUA toko Elorae dan dikenali dari nomor WhatsApp-nya
 *   (`Member.phone`, bentuk `62812…` yang sama dengan `StoreCustomer.phone`).
 *   Pelanggan tetap dicatat per toko; member menyatukan nomor yang sama.
 * - Mendaftar gratis di konter dengan persetujuan pembeli (`minBelanjaDaftar` 0).
 * - Tingkat DITURUNKAN, tidak disimpan (bawaan Reguler Rp0 / Silver Rp1,5 jt / Gold Rp5 jt): dari belanja bersih (sesudah retur)
 *   `periodeBulan` bulan terakhir di semua toko, dengan nomor yang sama —
 *   termasuk belanja sebelum mendaftar. Tingkat tertinggi yang `minBelanja`-nya
 *   tercapai.
 * - Diskon member bawaan MATI (`diskonAktif`): mendaftar, tingkat, promo khusus
 *   member, dan pelacakan jalan; potongan uangnya menunggu pemilik.
 * - Diskon member hanya untuk potong yang tidak kena promo barang
 *   (`gabungPromo: false`), ditanggung penuh Elorae di toko konsinyasi
 *   (`bagianTokoPersen: 0`), dan langsung berlaku di nota tempat mendaftar.
 * - Poin TIDAK dibangun: poin adalah utang ke pembeli yang harus dibukukan.
 *
 * Disimpan di `SystemSetting["spg.member"]` (JSON), diubah di Pengaturan → SPG.
 */
import type { AnggotaNota } from "./promo-konter";

export const KUNCI_MEMBER = "spg.member";

/** Nama tindakan jejak member (`AuditLog.action`). */
export const JEJAK_MEMBER = {
  DIDAFTARKAN: "MEMBER_REGISTERED",
  DINONAKTIFKAN: "MEMBER_DEACTIVATED",
  DIAKTIFKAN: "MEMBER_REACTIVATED",
  PENGATURAN_DIUBAH: "SPG_MEMBER_SETTINGS_UPDATED",
} as const;

export const ENTITAS_MEMBER = "Member";

export type TingkatMember = { kode: string; nama: string; minBelanja: number; diskonPersen: number };

export type AturanMember = {
  /** Program member menerima pendaftaran baru. Mati = member lama tetap member, tidak ada yang baru. */
  aktif: boolean;
  /** Urut dari `minBelanja` terkecil; yang pertama selalu 0. */
  tingkat: TingkatMember[];
  /** Jendela belanja penentu tingkat, dalam bulan. */
  periodeBulan: number;
  /** Diskon tingkat dipotong di nota. */
  diskonAktif: boolean;
  /** Diskon member juga untuk potong yang sudah kena promo barang. */
  gabungPromo: boolean;
  /** Bagian toko konsinyasi dari diskon member, 0–100. */
  bagianTokoPersen: number;
  /** Nilai nota minimal (sebelum diskon member) untuk mendaftar di nota itu. */
  minBelanjaDaftar: number;
  /** Pelanggan "tidur" sesudah sekian hari tanpa belanja. */
  hariTidur: number;
};

export const TINGKAT_BAWAAN: TingkatMember[] = [
  { kode: "REGULER", nama: "Reguler", minBelanja: 0, diskonPersen: 0 },
  { kode: "SILVER", nama: "Silver", minBelanja: 1_500_000, diskonPersen: 5 },
  { kode: "GOLD", nama: "Gold", minBelanja: 5_000_000, diskonPersen: 10 },
];

export const MEMBER_BAWAAN: AturanMember = {
  aktif: true,
  tingkat: TINGKAT_BAWAAN,
  periodeBulan: 12,
  diskonAktif: false,
  gabungPromo: false,
  bagianTokoPersen: 0,
  minBelanjaDaftar: 0,
  hariTidur: 90,
};

export const MAKS_TINGKAT = 6;
const KODE_TINGKAT = /^[A-Z0-9_]{1,20}$/;
const BELANJA_MAKS = 1_000_000_000_000;

function bacaObjek(nilai: string | null | undefined): Record<string, unknown> | null {
  if (!nilai) return null;
  try {
    const x = JSON.parse(nilai);
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Persen 0–100 dengan paling banyak dua desimal. */
const persenSah = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const rupiahSah = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= BELANJA_MAKS;
const bulatDalam = (v: unknown, min: number, maks: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= maks ? v : null;

/**
 * Daftar tingkat sah: 1–6 tingkat, kode unik huruf besar, nama 1–30 huruf,
 * belanja minimal rupiah utuh yang NAIK ketat dan dimulai dari 0, diskon 0–100.
 */
export function tingkatSah(x: unknown): x is TingkatMember[] {
  if (!Array.isArray(x) || x.length === 0 || x.length > MAKS_TINGKAT) return false;
  const kode = new Set<string>();
  let sebelum = -1;
  for (const t of x) {
    if (!t || typeof t !== "object") return false;
    const o = t as Record<string, unknown>;
    if (typeof o.kode !== "string" || !KODE_TINGKAT.test(o.kode) || kode.has(o.kode)) return false;
    if (typeof o.nama !== "string" || o.nama.trim().length === 0 || o.nama.length > 30 || o.nama !== o.nama.trim()) return false;
    if (!rupiahSah(o.minBelanja) || o.minBelanja <= sebelum) return false;
    if (!persenSah(o.diskonPersen)) return false;
    kode.add(o.kode);
    sebelum = o.minBelanja;
  }
  return (x[0] as TingkatMember).minBelanja === 0;
}

/**
 * Baca pengaturan member. Isian rusak jatuh ke bawaan per kolom. Urutan kunci
 * objek yang dikembalikan tetap — aksi simpan membandingkan JSON-nya.
 */
export function bacaAturanMember(nilai: string | null | undefined): AturanMember {
  const o = bacaObjek(nilai);
  if (!o) return MEMBER_BAWAAN;
  const tingkat = tingkatSah(o.tingkat)
    ? o.tingkat.map((t) => ({ kode: t.kode, nama: t.nama, minBelanja: t.minBelanja, diskonPersen: t.diskonPersen }))
    : MEMBER_BAWAAN.tingkat;
  return {
    aktif: o.aktif !== false,
    tingkat,
    periodeBulan: bulatDalam(o.periodeBulan, 1, 36) ?? MEMBER_BAWAAN.periodeBulan,
    diskonAktif: o.diskonAktif === true,
    gabungPromo: o.gabungPromo === true,
    bagianTokoPersen: persenSah(o.bagianTokoPersen) ? o.bagianTokoPersen : MEMBER_BAWAAN.bagianTokoPersen,
    minBelanjaDaftar: rupiahSah(o.minBelanjaDaftar) ? o.minBelanjaDaftar : MEMBER_BAWAAN.minBelanjaDaftar,
    hariTidur: bulatDalam(o.hariTidur, 7, 730) ?? MEMBER_BAWAAN.hariTidur,
  };
}

/**
 * Sahkan isian kartu pengaturan: yang disimpan harus terbaca kembali PERSIS
 * sama oleh `bacaAturanMember` (pembaca penulis nota), supaya kartu tidak pernah
 * menampilkan aturan yang berbeda dari yang dipakai konter.
 */
export function sahkanAturanMember(isi: unknown): AturanMember | null {
  if (!isi || typeof isi !== "object") return null;
  const o = isi as Record<string, unknown>;
  if (typeof o.aktif !== "boolean" || typeof o.diskonAktif !== "boolean" || typeof o.gabungPromo !== "boolean") return null;
  if (!tingkatSah(o.tingkat)) return null;
  if (bulatDalam(o.periodeBulan, 1, 36) === null || bulatDalam(o.hariTidur, 7, 730) === null) return null;
  if (!persenSah(o.bagianTokoPersen) || !rupiahSah(o.minBelanjaDaftar)) return null;
  const aturan: AturanMember = {
    aktif: o.aktif,
    tingkat: o.tingkat.map((t) => ({ kode: t.kode, nama: t.nama, minBelanja: t.minBelanja, diskonPersen: t.diskonPersen })),
    periodeBulan: o.periodeBulan as number,
    diskonAktif: o.diskonAktif,
    gabungPromo: o.gabungPromo,
    bagianTokoPersen: o.bagianTokoPersen,
    minBelanjaDaftar: o.minBelanjaDaftar,
    hariTidur: o.hariTidur as number,
  };
  return JSON.stringify(bacaAturanMember(JSON.stringify(aturan))) === JSON.stringify(aturan) ? aturan : null;
}

/** Tingkat untuk belanja bersih sekian: yang tertinggi yang syaratnya tercapai. */
export function tingkatUntukBelanja(belanja: number, aturan: Pick<AturanMember, "tingkat">): TingkatMember {
  let hasil = aturan.tingkat[0];
  for (const t of aturan.tingkat) if (belanja >= t.minBelanja) hasil = t;
  return hasil;
}

/** Tingkat berikutnya dan kekurangannya, atau null di tingkat tertinggi. */
export function tingkatBerikut(belanja: number, aturan: Pick<AturanMember, "tingkat">): { tingkat: TingkatMember; kurang: number } | null {
  const t = aturan.tingkat.find((x) => x.minBelanja > belanja);
  return t ? { tingkat: t, kurang: Math.max(0, Math.round((t.minBelanja - belanja) * 100) / 100) } : null;
}

/** Awal jendela belanja penentu tingkat: `periodeBulan` bulan sebelum `waktu`. */
export function awalPeriodeMember(waktu: Date, periodeBulan: number): Date {
  const d = new Date(waktu.getTime());
  d.setUTCMonth(d.getUTCMonth() - periodeBulan);
  return d;
}

/** Bentuk masukan mesin promo untuk member bertingkat ini. */
export function anggotaUntukNota(tingkat: TingkatMember, aturan: AturanMember): AnggotaNota {
  return {
    tingkat: tingkat.nama,
    diskonPersen: aturan.diskonAktif ? tingkat.diskonPersen : 0,
    gabungPromo: aturan.gabungPromo,
    bagianTokoPersen: aturan.bagianTokoPersen,
  };
}

/**
 * Keadaan member satu nomor untuk layar (HP dan kantor), sudah dihitung server.
 * `diskonPersen` = yang SUNGGUH dipotong (0 kalau diskon member dimatikan).
 */
export type KeadaanMember = {
  memberId: string;
  aktif: boolean;
  tingkat: string;
  kodeTingkat: string;
  diskonPersen: number;
  belanjaPeriode: number;
  berikut: { nama: string; kurang: number } | null;
  sejak: string;
};

/** Ringkas keadaan member (tanpa basis data) dari belanja dan pengaturan. */
export function keadaanMember(input: {
  member: { id: string; isActive: boolean; joinedAt: Date };
  belanja: number;
  aturan: AturanMember;
  sejakTeks: string;
}): KeadaanMember {
  const t = tingkatUntukBelanja(input.belanja, input.aturan);
  const b = tingkatBerikut(input.belanja, input.aturan);
  return {
    memberId: input.member.id,
    aktif: input.member.isActive,
    tingkat: t.nama,
    kodeTingkat: t.kode,
    diskonPersen: input.aturan.diskonAktif && input.member.isActive ? t.diskonPersen : 0,
    belanjaPeriode: input.belanja,
    berikut: b ? { nama: b.tingkat.nama, kurang: b.kurang } : null,
    sejak: input.sejakTeks,
  };
}
