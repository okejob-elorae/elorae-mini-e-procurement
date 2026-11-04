import { prisma, type Prisma } from "@elorae/db";
import { nilaiBersihSpg } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { awalPeriodeMember, bacaAturanMember, keadaanMember, KUNCI_MEMBER, type AturanMember, type KeadaanMember } from "./member";

/**
 * Bacaan member (server). Tingkat dihitung dari belanja bersih nomor itu di
 * SEMUA toko — `StoreCustomer` dengan nomor yang sama di toko mana pun — dalam
 * jendela `periodeBulan` sebelum `waktu`. Penulis nota memakai fungsi yang sama
 * di dalam transaksinya, jadi tingkat di layar = tingkat di nota.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

export async function bacaAturanMemberDb(klien: Klien = prisma): Promise<AturanMember> {
  const r = await klien.systemSetting.findUnique({ where: { key: KUNCI_MEMBER }, select: { value: true } });
  return bacaAturanMember(r?.value);
}

const bulat = (v: number) => Math.round(v * 100) / 100;

/** Belanja bersih (sesudah retur) per nomor, nota dalam [sejak, sampai). */
export async function belanjaBersihPerNomor(klien: Klien, phones: readonly string[], sejak: Date, sampai: Date): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  const unik = [...new Set(phones.filter(Boolean))];
  if (unik.length === 0) return hasil;
  const pelanggan = await klien.storeCustomer.findMany({ where: { phone: { in: unik } }, select: { id: true, phone: true } });
  if (pelanggan.length === 0) return hasil;
  const nomorPer = new Map(pelanggan.map((p) => [p.id, p.phone]));
  const nota = await klien.spgSale.findMany({
    where: { customerId: { in: pelanggan.map((p) => p.id) }, createdAt: { gte: sejak, lt: sampai } },
    select: {
      customerId: true,
      total: true,
      lines: { where: { returnedQty: { gt: 0 } }, select: { qty: true, returnedQty: true, unitPrice: true, lineTotal: true } },
    },
  });
  for (const n of nota) {
    const phone = n.customerId ? nomorPer.get(n.customerId) : undefined;
    if (!phone) continue;
    hasil.set(phone, bulat((hasil.get(phone) ?? 0) + nilaiBersihSpg(n.total, n.lines)));
  }
  return hasil;
}

export async function belanjaBersihNomor(klien: Klien, phone: string, sejak: Date, sampai: Date): Promise<number> {
  return (await belanjaBersihPerNomor(klien, [phone], sejak, sampai)).get(phone) ?? 0;
}

/**
 * Keadaan member per nomor pada `waktu` (member yang dinonaktifkan ikut, dengan
 * `aktif: false` dan diskon 0). Nomor yang bukan member tidak ada di peta.
 */
export async function keadaanMemberPerNomor(
  phones: readonly string[],
  opsi: { waktu?: Date; aturan?: AturanMember; klien?: Klien; bahasa?: "id" | "en" } = {},
): Promise<Map<string, KeadaanMember>> {
  const klien = opsi.klien ?? prisma;
  const waktu = opsi.waktu ?? new Date();
  const unik = [...new Set(phones.filter(Boolean))];
  const hasil = new Map<string, KeadaanMember>();
  if (unik.length === 0) return hasil;
  const [aturan, member] = await Promise.all([
    opsi.aturan ? Promise.resolve(opsi.aturan) : bacaAturanMemberDb(klien),
    klien.member.findMany({ where: { phone: { in: unik } }, select: { id: true, phone: true, isActive: true, joinedAt: true } }),
  ]);
  if (member.length === 0) return hasil;
  const belanja = await belanjaBersihPerNomor(
    klien,
    member.map((m) => m.phone),
    awalPeriodeMember(waktu, aturan.periodeBulan),
    waktu,
  );
  for (const m of member) {
    hasil.set(
      m.phone,
      keadaanMember({ member: m, belanja: belanja.get(m.phone) ?? 0, aturan, sejakTeks: formatDisplayDate(m.joinedAt, opsi.bahasa ?? "id") }),
    );
  }
  return hasil;
}
