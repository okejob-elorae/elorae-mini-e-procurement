import { prisma, type Prisma } from "@elorae/db";
import { awalPeriodeMember, type AturanMember } from "./member";
import { bacaAturanMemberDb, belanjaBersihPerNomor, keadaanMemberPerNomor } from "./member-queries";
import { memberPembeliDari, type MemberPembeli } from "./member-hp";

/**
 * Keadaan member per nomor untuk layar jual SPG (server). Member dibaca lewat
 * `keadaanMemberPerNomor` — bacaan yang sama dengan penulis nota — dan nomor
 * yang belum member diberi tingkat yang langsung didapatnya bila mendaftar
 * (belanja bersih nomor itu di semua toko dalam jendela pengaturan). Yang
 * dikembalikan HANYA tingkat dan diskon: tidak ada nama, toko, atau belanja.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

export async function memberPembeliPerNomor(
  phones: readonly string[],
  opsi: { waktu?: Date; aturan?: AturanMember; klien?: Klien } = {},
): Promise<Map<string, MemberPembeli>> {
  const klien = opsi.klien ?? prisma;
  const waktu = opsi.waktu ?? new Date();
  const unik = [...new Set(phones.filter(Boolean))];
  const hasil = new Map<string, MemberPembeli>();
  if (unik.length === 0) return hasil;
  const aturan = opsi.aturan ?? (await bacaAturanMemberDb(klien));
  const keadaan = await keadaanMemberPerNomor(unik, { waktu, aturan, klien });
  const bukan = unik.filter((p) => !keadaan.has(p));
  // Program yang tidak menerima pendaftaran tidak butuh tingkat calon member.
  const belanja =
    bukan.length > 0 && aturan.aktif
      ? await belanjaBersihPerNomor(klien, bukan, awalPeriodeMember(waktu, aturan.periodeBulan), waktu)
      : new Map<string, number>();
  for (const p of unik) hasil.set(p, memberPembeliDari(keadaan.get(p), belanja.get(p) ?? 0, aturan));
  return hasil;
}
