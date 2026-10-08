import { prisma, Prisma, sqlId } from "@elorae/db";
import type { DokumenTanpaJurnal, OpsiCariSapuan } from "./registri";

/**
 * Pencari "dokumen tanpa jurnal" berbasis SQL untuk satu tabel sumber: baris
 * yang tanggalnya di rentang, memenuhi `syarat`, dan BELUM punya jurnal
 * ber-(sourceType, id dokumen). Satu kueri ber-`NOT EXISTS` + `LIMIT`, jadi
 * tabel besar yang hampir semuanya sudah berjurnal tetap murah.
 *
 * `tanggal` dan `syarat` adalah potongan SQL atas alias `d` (tabel sumber);
 * identifier ditulis lewat `sqlId` supaya sama di MariaDB dan Postgres.
 */
export async function cariTanpaJurnalSql(isi: {
  tabel: string;
  sourceType: string;
  /** Ekspresi tanggal dokumen atas alias `d`. */
  tanggal: Prisma.Sql;
  /** Kolom nomor dokumen (label) di `d`. */
  kolomLabel: string;
  /** Syarat tambahan, diawali `AND`. */
  syarat?: Prisma.Sql;
  opsi: OpsiCariSapuan;
}): Promise<DokumenTanpaJurnal[]> {
  const batas = Math.max(1, Math.floor(isi.opsi.batas));
  const rows = await prisma.$queryRaw<Array<{ id: string; tanggal: Date | string; label: string | null }>>(Prisma.sql`
    SELECT d.${sqlId("id")} AS ${sqlId("id")}, ${isi.tanggal} AS ${sqlId("tanggal")}, d.${sqlId(isi.kolomLabel)} AS ${sqlId("label")}
    FROM ${sqlId(isi.tabel)} d
    WHERE ${isi.tanggal} >= ${isi.opsi.sejak}
      AND ${isi.tanggal} <= ${isi.opsi.sampai}
      ${isi.syarat ?? Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM ${sqlId("Journal")} j
        WHERE j.${sqlId("sourceType")} = ${isi.sourceType} AND j.${sqlId("sourceId")} = d.${sqlId("id")}
      )
    ORDER BY ${isi.tanggal} ASC
    LIMIT ${batas}
  `);
  return rows.map((r) => ({ id: r.id, tanggal: new Date(r.tanggal), label: r.label ?? r.id }));
}
