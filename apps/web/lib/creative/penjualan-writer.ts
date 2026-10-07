import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { dariSen, keSen } from "./angka-konten";
import { penjualanKosong, periksaPenjualan, type KodeGagalPenjualan } from "./penjualan-aturan";

/*
 * Penjualan afiliasi per kolaborasi (2026-10-07) — diketik, bukan diimpor.
 *
 * Tidak memajukan tahap: penjualan bukan salah satu fakta tahap. Jejaknya
 * ditulis pada KOLABORASI (`entityType "KolBrief"`, `metadata.penjualanId`),
 * sama seperti konten, supaya linimasa kolaborasi menampilkannya.
 */

export type KodeGagalPenjualanTulis = KodeGagalPenjualan | "TIDAK_DITEMUKAN" | "KOLABORASI_TIDAK_DITEMUKAN";

export type HasilPenjualan = { ok: true; id: string } | { ok: false; kode: KodeGagalPenjualanTulis };

const D = (n: number) => new Prisma.Decimal(dariSen(keSen(n)).toFixed(2));

export async function simpanPenjualan(input: {
  id?: string | null;
  kolaborasiId: string;
  date?: Date | null;
  orders?: number;
  gmv?: number;
  commission?: number;
  source?: string | null;
  note?: string | null;
  olehUserId: string;
}): Promise<HasilPenjualan> {
  const baru = !input.id;
  const note = input.note === undefined ? undefined : input.note?.trim() || null;
  const source = input.source === undefined ? undefined : input.source?.trim() || null;
  const salah = periksaPenjualan({
    baru,
    date: input.date,
    orders: input.orders,
    gmv: input.gmv,
    commission: input.commission,
    source,
    note,
  });
  if (salah) return { ok: false, kode: salah };

  return runSerializable(async (tx) => {
    const kolab = await tx.kolBrief.findUnique({
      where: { id: input.kolaborasiId },
      select: { id: true, docNo: true, kol: { select: { name: true } } },
    });
    if (!kolab) return { ok: false as const, kode: "KOLABORASI_TIDAK_DITEMUKAN" as const };

    if (input.id) {
      const lama = await tx.kolSale.findFirst({
        where: { id: input.id, collabId: kolab.id },
        select: { id: true, date: true, orders: true, gmv: true, commission: true, source: true, note: true },
      });
      if (!lama) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
      const orders = input.orders ?? lama.orders;
      const gmv = input.gmv ?? Number(lama.gmv);
      if (penjualanKosong(orders, gmv)) return { ok: false as const, kode: "PENJUALAN_KOSONG" as const };

      const data: Prisma.KolSaleUncheckedUpdateInput = {};
      if (input.date) data.date = input.date;
      if (input.orders !== undefined) data.orders = input.orders;
      if (input.gmv !== undefined) data.gmv = D(input.gmv);
      if (input.commission !== undefined) data.commission = D(input.commission);
      if (source !== undefined) data.source = source;
      if (note !== undefined) data.note = note;
      await tx.kolSale.update({ where: { id: lama.id }, data });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.PENJUALAN_KOL_DIUBAH,
        entityType: "KolBrief",
        entityId: kolab.id,
        changes: {
          before: {
            date: lama.date.toISOString(),
            orders: lama.orders,
            gmv: Number(lama.gmv),
            commission: Number(lama.commission),
            source: lama.source,
          },
          after: {
            date: (input.date ?? lama.date).toISOString(),
            orders,
            gmv: input.gmv !== undefined ? Number(D(input.gmv)) : Number(lama.gmv),
            commission: input.commission !== undefined ? Number(D(input.commission)) : Number(lama.commission),
            source: source === undefined ? lama.source : source,
          },
        },
        metadata: { penjualanId: lama.id, docNo: kolab.docNo, kol: kolab.kol.name },
      });
      return { ok: true as const, id: lama.id };
    }

    const orders = input.orders ?? 0;
    const gmv = input.gmv ?? 0;
    if (penjualanKosong(orders, gmv)) return { ok: false as const, kode: "PENJUALAN_KOSONG" as const };
    const dibuat = await tx.kolSale.create({
      data: {
        collabId: kolab.id,
        date: input.date!,
        orders,
        gmv: D(gmv),
        commission: D(input.commission ?? 0),
        source: source ?? null,
        note: note ?? null,
        createdById: input.olehUserId,
      },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.PENJUALAN_KOL_DICATAT,
      entityType: "KolBrief",
      entityId: kolab.id,
      changes: {
        after: {
          date: input.date!.toISOString(),
          orders,
          gmv: Number(D(gmv)),
          commission: Number(D(input.commission ?? 0)),
          source: source ?? null,
        },
      },
      metadata: { penjualanId: dibuat.id, docNo: kolab.docNo, kol: kolab.kol.name },
    });
    return { ok: true as const, id: dibuat.id };
  });
}

/** Hapus satu baris penjualan. Isinya tetap terbaca di jejak. */
export async function hapusPenjualan(input: { id: string; olehUserId: string }): Promise<HasilPenjualan> {
  return runSerializable(async (tx) => {
    const lama = await tx.kolSale.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        date: true,
        orders: true,
        gmv: true,
        commission: true,
        source: true,
        note: true,
        collab: { select: { id: true, docNo: true, kol: { select: { name: true } } } },
      },
    });
    if (!lama) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    await tx.kolSale.delete({ where: { id: lama.id } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.PENJUALAN_KOL_DIHAPUS,
      entityType: "KolBrief",
      entityId: lama.collab.id,
      changes: {
        before: {
          date: lama.date.toISOString(),
          orders: lama.orders,
          gmv: Number(lama.gmv),
          commission: Number(lama.commission),
          source: lama.source,
          note: lama.note,
        },
        after: null,
      },
      metadata: { penjualanId: lama.id, docNo: lama.collab.docNo, kol: lama.collab.kol.name },
    });
    return { ok: true as const, id: lama.id };
  });
}
