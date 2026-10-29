/**
 * Member di HP SPG — aturan murni (tanpa Prisma), dipakai layar jual, rincian
 * pelanggan, dan aksi server yang menyiapkannya.
 *
 * Yang sampai ke HP tentang sebuah NOMOR hanya tingkat dan diskonnya: member
 * dikenali di semua toko Elorae, tapi nama, toko, dan belanja pembeli itu di
 * toko lain tidak pernah dikirim ke layar konter. (Rincian pelanggan toko SPG
 * sendiri boleh menampilkan belanja periode, karena itulah dasar tingkatnya.)
 */
import type { AnggotaNota } from "./promo-konter";
import { anggotaUntukNota, tingkatUntukBelanja, type AturanMember, type KeadaanMember } from "./member";

/**
 * Keadaan member satu nomor untuk layar jual, sudah dihitung server.
 * - `MEMBER`: member aktif; `diskonPersen` = yang SUNGGUH dipotong (0 kalau kantor mematikannya).
 * - `NONAKTIF`: member yang dinonaktifkan kantor — nota tercatat tanpa member.
 * - `BUKAN`: belum member; `tingkatDaftar` = tingkat yang langsung didapat bila
 *   mendaftar di nota ini (dari belanja nomor itu sebelumnya, di semua toko).
 */
export type MemberPembeli =
  | { status: "MEMBER"; tingkat: string; diskonPersen: number }
  | { status: "NONAKTIF" }
  | { status: "BUKAN"; tingkatDaftar: string; diskonPersenDaftar: number };

/** Ringkas untuk HP: keadaan member server (atau tidak ada) + belanja nomor yang bukan member. */
export function memberPembeliDari(keadaan: KeadaanMember | undefined, belanja: number, aturan: AturanMember): MemberPembeli {
  if (keadaan) return keadaan.aktif ? { status: "MEMBER", tingkat: keadaan.tingkat, diskonPersen: keadaan.diskonPersen } : { status: "NONAKTIF" };
  const t = tingkatUntukBelanja(belanja, aturan);
  return { status: "BUKAN", tingkatDaftar: t.nama, diskonPersenDaftar: aturan.diskonAktif ? t.diskonPersen : 0 };
}

const persen = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const nama = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 30;

/** Baca keadaan member dari simpanan HP; bentuk rusak → null (dianggap belum diketahui). */
export function uraiMemberPembeli(v: unknown): MemberPembeli | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.status === "MEMBER" && nama(o.tingkat) && persen(o.diskonPersen)) return { status: "MEMBER", tingkat: o.tingkat, diskonPersen: o.diskonPersen };
  if (o.status === "NONAKTIF") return { status: "NONAKTIF" };
  if (o.status === "BUKAN" && nama(o.tingkatDaftar) && persen(o.diskonPersenDaftar)) {
    return { status: "BUKAN", tingkatDaftar: o.tingkatDaftar, diskonPersenDaftar: o.diskonPersenDaftar };
  }
  return null;
}

/**
 * Masukan member untuk mesin promo di HP — bentuk yang sama dengan yang
 * dihitung penulis nota (`recordSpgSale`):
 * - member aktif → tingkat dan diskonnya;
 * - member nonaktif → bukan member (tanpa harga member, tanpa promo khusus member);
 * - bukan member yang minta didaftarkan selagi program menerima pendaftaran →
 *   tingkat yang dilaporkan server untuk nomor itu, atau tingkat PERTAMA kalau
 *   server belum ditanya (tanpa sinyal);
 * - selain itu → bukan member.
 */
export function anggotaPratinjau(input: { member: MemberPembeli | null; daftarMember: boolean; aturan: AturanMember }): AnggotaNota | null {
  const { member, aturan } = input;
  const dasar = { gabungPromo: aturan.gabungPromo, bagianTokoPersen: aturan.bagianTokoPersen };
  if (member?.status === "MEMBER") return { tingkat: member.tingkat, diskonPersen: member.diskonPersen, ...dasar };
  if (member?.status === "NONAKTIF") return null;
  if (!input.daftarMember || !aturan.aktif) return null;
  if (member?.status === "BUKAN") return { tingkat: member.tingkatDaftar, diskonPersen: member.diskonPersenDaftar, ...dasar };
  return anggotaUntukNota(aturan.tingkat[0], aturan);
}

/** Pembeli ini sungguh diminta didaftarkan: programnya menerima, dan nomornya belum (diketahui) member. */
export function mintaDaftarMember(input: { member: MemberPembeli | null; daftarMember: boolean; aturan: Pick<AturanMember, "aktif"> }): boolean {
  if (!input.daftarMember || !input.aturan.aktif) return false;
  return input.member === null || input.member.status === "BUKAN";
}
