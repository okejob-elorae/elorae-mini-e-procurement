import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { jurnalSesudahDitutup, jurnalTakSeimbang, jurnalYatim, saldoBertandaTerbalik } from "./queries";

/*
 * Pemeriksaan integritas di basis data sungguhan — data tes sendiri, tahun
 * 2001 (tidak pernah berisi data sungguhan). Jurnal rusak ditulis LANGSUNG
 * lewat Prisma (melewati `postJournal`), karena itulah satu-satunya jalan
 * data seperti itu bisa ada.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TAHUN = 2001;
const BULAN = 9;

d("integritas buku besar (test bed only)", () => {
  let token = "";
  let userId = "";
  let aset = "";
  let beban = "";
  let grnAda = "";
  const jurnalIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    aset = "";
    beban = "";
    grnAda = "";
    jurnalIds.length = 0;
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-integritas-${token}@test.local`, name: "Uji integritas" } })).id;
    aset = (await prisma.chartAccount.create({ data: { code: `9${token}41`, name: "Aset uji integritas", type: "ASET", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}42`, name: "Beban uji integritas", type: "BEBAN", depth: 1 } })).id;
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        const ids = [...new Set([...jurnalIds, ...j.map((x) => x.id)])];
        if (!ids.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      async () => {
        if (grnAda) await prisma.gRN.delete({ where: { id: grnAda } });
      },
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: TAHUN, month: { in: [BULAN, BULAN + 1] } }, select: { id: true } });
        if (p.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(p.map((x) => x.id)) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(aset), seededId(beban)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[integritas.test] teardown", e);
      }
    }
  }, 60_000);

  const tanggal = new Date(Date.UTC(TAHUN, BULAN - 1, 12, 3));

  it("jurnal tidak seimbang (ditulis di luar postJournal) dan jurnal satu baris ditemukan; jurnal yang sah tidak", async () => {
    const rusak = await prisma.journal.create({
      data: {
        date: tanggal,
        description: `uji tak seimbang ${token}`,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: beban, debit: 100, credit: 0 },
            { chartAccountId: aset, debit: 0, credit: 90 },
          ],
        },
      },
    });
    const satuBaris = await prisma.journal.create({
      data: { date: tanggal, description: `uji satu baris ${token}`, postedById: userId, lines: { create: [{ chartAccountId: beban, debit: 5, credit: 0 }] } },
    });
    jurnalIds.push(rusak.id, satuBaris.id);
    const sah = await postJournal(prisma, {
      date: tanggal,
      description: `uji sah ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: beban, debit: 10, credit: 0 },
        { chartAccountId: aset, debit: 0, credit: 10 },
      ],
    });

    const hasil = await jurnalTakSeimbang();
    const ids = hasil.map((h) => h.id);
    expect(ids).toContain(rusak.id);
    expect(ids).toContain(satuBaris.id);
    expect(ids).not.toContain(sah.journalId);
    expect(hasil.find((h) => h.id === rusak.id)).toMatchObject({ debit: 100, kredit: 90, jumlahBaris: 2 });
  });

  it("jurnal GRN yang dokumennya tidak ada = yatim; yang dokumennya ada tidak", async () => {
    const pemasok = await prisma.supplier.findFirst({ select: { id: true } });
    if (!pemasok) return;
    grnAda = (
      await prisma.gRN.create({ data: { docNumber: `UJIINTEG-${token}`, supplierId: pemasok.id, receivedBy: "uji", totalAmount: 10, items: [], grnDate: tanggal } })
    ).id;
    const baris = [
      { chartAccountId: aset, debit: 10, credit: 0 },
      { chartAccountId: beban, debit: 0, credit: 10 },
    ];
    const ada = await postJournal(prisma, { date: tanggal, description: "uji grn ada", postedById: userId, source: { type: "GRN", id: grnAda }, lines: baris });
    const hilang = await postJournal(prisma, {
      date: tanggal,
      description: "uji grn hilang",
      postedById: userId,
      source: { type: "GRN", id: `tidak-ada-${token}` },
      lines: baris,
    });
    const hasil = await jurnalYatim();
    const ids = hasil.yatim.map((y) => y.id);
    expect(ids).toContain(hilang.journalId);
    expect(ids).not.toContain(ada.journalId);
  });

  it("akun aset bersaldo kredit = saldo terbalik", async () => {
    const hasil = await saldoBertandaTerbalik();
    // Aset uji: +10 (GRN ada) +10 (GRN hilang) −10 (jurnal sah) −90 (rusak) = −80.
    const baris = hasil.find((h) => h.accountId === aset);
    expect(baris).toBeTruthy();
    expect(baris!.saldo).toBeLessThan(0);
    expect(hasil.find((h) => h.accountId === beban)).toBeUndefined();
  });

  it("jurnal di bulan tertutup yang dibuat sesudah ditutup (ditulis di luar postJournal) ditemukan", async () => {
    const ditutup = new Date(Date.now() - 60_000);
    await prisma.accountingPeriod.upsert({
      where: { year_month: { year: TAHUN, month: BULAN } },
      create: { year: TAHUN, month: BULAN, status: "CLOSED", closedAt: ditutup },
      update: { status: "CLOSED", closedAt: ditutup },
    });
    const selundup = await prisma.journal.create({
      data: {
        date: tanggal,
        description: `uji selundup ${token}`,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: beban, debit: 1, credit: 0 },
            { chartAccountId: aset, debit: 0, credit: 1 },
          ],
        },
      },
    });
    jurnalIds.push(selundup.id);
    const hasil = await jurnalSesudahDitutup();
    expect(hasil.find((h) => h.id === selundup.id)).toMatchObject({ bulan: `${TAHUN}-0${BULAN}` });
  });
});
