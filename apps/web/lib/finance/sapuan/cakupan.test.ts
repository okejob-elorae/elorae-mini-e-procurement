import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma, seededId, seededIds, sqlId } from "@elorae/db";
import { cariTanpaJurnalSql } from "./sql";
import { bacaTandaNihil, catatTandaNihil, cariSemuaTanpaJurnal, jalankanSapuan, JEJAK_SAPUAN_NIHIL } from "./runner";
import type { DokumenTanpaJurnal, SumberSapuan } from "./registri";

/*
 * Cakupan sapuan (`ids`) di pencari SQL bersama dan tanda dokumen nihil, di
 * basis data sungguhan. Dokumen uji: tukar barang tahun 2002 milik tes ini
 * (tabel apa pun cukup untuk pencari SQL generik); sourceType uji unik per
 * jalankan, jadi tidak ada jurnal atau tanda milik orang lain yang ikut.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `UJCK-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T10:00:00+07:00`);

d("cakupan dan tanda nihil sapuan (test bed only)", () => {
  let userId = "";
  let tokoId = "";
  let tukarIds: string[] = [];
  const entitasTanda: string[] = [];
  const notifIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    tokoId = "";
    tukarIds = [];
    const u = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    if (!u) throw new Error("Basis data uji butuh satu pengguna");
    userId = u.id;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    for (const [i, t] of ["2002-03-01", "2002-03-02", "2002-03-03"].entries()) {
      const x = await prisma.storeExchange.create({
        data: { docNo: `${tag}-TKR-${i + 1}`, storeId: tokoId, salesmanId: userId, status: "SELESAI", completedAt: wib(t) },
      });
      tukarIds.push(x.id);
    }
  });

  afterAll(async () => {
    if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    if (entitasTanda.length) await prisma.auditLog.deleteMany({ where: { action: JEJAK_SAPUAN_NIHIL, entityId: { in: seededIds(entitasTanda) } } });
    if (tukarIds.length) await prisma.storeExchange.deleteMany({ where: { id: { in: seededIds(tukarIds) } } });
    if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  });

  const opsiSql = (batas: number, ids?: string[]) =>
    cariTanpaJurnalSql({
      tabel: "StoreExchange",
      sourceType: `UJI_SQL_${tag}`,
      tanggal: Prisma.sql`d.${sqlId("completedAt")}`,
      kolomLabel: "docNo",
      syarat: Prisma.sql`AND d.${sqlId("storeId")} = ${tokoId}`,
      opsi: { sejak: wib("2002-01-01"), sampai: wib("2002-12-31"), batas, ...(ids ? { ids } : {}) },
    });

  it("pencari SQL menerapkan `ids` sebelum LIMIT — dokumen ketiga tetap ditemukan dengan batas 1", async () => {
    expect((await opsiSql(1)).map((x) => x.id)).toEqual([tukarIds[0]]);
    expect((await opsiSql(1, [tukarIds[2]])).map((x) => x.id)).toEqual([tukarIds[2]]);
    expect(await opsiSql(5, [])).toEqual([]);
  });

  it("tanda nihil: ditulis sekali per dokumen, dilewati pemeriksaan, kecuali dokumen itu punya JOURNAL_PENDING terbuka", async () => {
    const sourceType = "STORE_EXCHANGE";
    const [nihil, gagal, biasa] = [`${tag}-nihil`, `${tag}-gagal`, `${tag}-biasa`];
    entitasTanda.push(nihil, gagal, biasa);
    const dok = (id: string): DokumenTanpaJurnal => ({ id, tanggal: wib("2002-05-02"), label: id });
    const sumber: SumberSapuan = {
      sourceType,
      label: "Tukar uji",
      cariTanpaJurnal: async (o) => [nihil, gagal, biasa].filter((id) => !o.ids || o.ids.includes(id)).map(dok),
      posting: async (id) => (id === biasa ? { ok: false, code: "UNMAPPED_ROLE", role: "COGS" } : { ok: false, code: "NOTHING_TO_POST" }),
    };

    const r = await jalankanSapuan({ sumber: [sumber], tanggalMulai: wib("2002-01-01"), sejak: wib("2002-05-01"), sampai: wib("2002-05-31"), olehUserId: userId });
    if (r.dilewati) throw new Error("tidak boleh dilewati");
    expect(r.sumber[0]).toMatchObject({ ditemukan: 3, nihil: 2 });
    // Sapuan kedua tidak menulis tanda kedua.
    await jalankanSapuan({ sumber: [sumber], tanggalMulai: wib("2002-01-01"), sejak: wib("2002-05-01"), sampai: wib("2002-05-31"), olehUserId: userId });
    await catatTandaNihil(sourceType, dok(nihil), userId);
    expect(await prisma.auditLog.count({ where: { action: JEJAK_SAPUAN_NIHIL, entityType: sourceType, entityId: { in: [nihil, gagal, biasa] } } })).toBe(2);

    const cari = (abaikanNihil: boolean) =>
      cariSemuaTanpaJurnal({ sejak: wib("2002-05-01"), sampai: wib("2002-05-31"), batasPerSumber: 10, sumber: [sumber], abaikanNihil });
    expect((await cari(false))[0].dokumen.map((x) => x.id)).toEqual([nihil, gagal, biasa]);
    expect((await cari(true))[0].dokumen.map((x) => x.id)).toEqual([biasa]);

    // Dokumen bertanda yang kemudian gagal sungguhan (JOURNAL_PENDING terbuka) tampil lagi.
    const n = await prisma.adminNotification.create({
      data: { category: "JOURNAL_PENDING", severity: "WARNING", title: `${tag} uji`, message: "uji", metadata: { docId: gagal, kind: "tukar_barang", reason: "UNMAPPED_ROLE" } },
    });
    notifIds.push(n.id);
    expect([...(await bacaTandaNihil(sourceType, [nihil, gagal, biasa]))]).toEqual([nihil]);
    expect((await cari(true))[0].dokumen.map((x) => x.id)).toEqual([gagal, biasa]);
  });
});
