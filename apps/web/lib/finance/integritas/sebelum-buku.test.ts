import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Integritas: jurnal bertanggal SEBELUM tanggal mulai buku besar yang masuk
 * sesudah bulan tanggal mulai ditutup (uji akuntansi gelombang 2, bug 4) —
 * neraca bulan-bulan yang sudah ditutup ikut berubah, jadi pemeriksaan
 * "jurnal sesudah ditutup" harus melihatnya. Tahun 2000, data tes sendiri;
 * tanggal mulai ditiru. Jurnal ditulis LANGSUNG lewat Prisma (`postJournal`
 * menolaknya), karena hanya data di luar penulis yang bisa begini.
 */

const h = vi.hoisted(() => ({ mulai: new Date("2000-08-01T00:00:00+07:00") as Date | null }));
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));

import { jurnalSesudahDitutup } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("integritas — jurnal sebelum tanggal mulai sesudah bulan pertama ditutup (test bed only)", () => {
  let token = "";
  let userId = "";
  let aset = "";
  let beban = "";
  let periodeId = "";
  const jurnalIds: string[] = [];
  const ditutup = new Date(Date.now() - 60 * 60 * 1000);

  async function jurnal(tanggal: string, dibuat: Date): Promise<string> {
    const j = await prisma.journal.create({
      data: {
        date: new Date(`${tanggal}T10:00:00+07:00`),
        description: `uji sebelum buku ${token}`,
        postedById: userId,
        createdAt: dibuat,
        lines: {
          create: [
            { chartAccountId: beban, debit: 500, credit: 0 },
            { chartAccountId: aset, debit: 0, credit: 500 },
          ],
        },
      },
    });
    jurnalIds.push(j.id);
    return j.id;
  }

  beforeAll(async () => {
    userId = "";
    aset = "";
    beban = "";
    periodeId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-integ-sb-${token}@test.local`, name: "Uji integritas" } })).id;
    aset = (await prisma.chartAccount.create({ data: { code: `9${token}61`, name: "Kas uji integritas", type: "ASET", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}62`, name: "Beban uji integritas", type: "BEBAN", depth: 1 } })).id;
    const ada = await prisma.accountingPeriod.findUnique({ where: { year_month: { year: 2000, month: 8 } }, select: { id: true } });
    if (ada) throw new Error("Periode 2000-08 sudah ada di basis data uji — tes ini butuh bulan itu kosong");
    periodeId = (await prisma.accountingPeriod.create({ data: { year: 2000, month: 8, status: "CLOSED", closedAt: ditutup } })).id;
  });

  afterAll(async () => {
    if (jurnalIds.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnalIds) } } });
      await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    }
    if (periodeId) await prisma.accountingPeriod.delete({ where: { id: seededId(periodeId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(aset), seededId(beban)] } } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("jurnal sebelum tanggal mulai yang dibuat sesudah bulan pertama ditutup tampil; yang dibuat sebelumnya tidak", async () => {
    const selundup = await jurnal("2000-07-20", new Date());
    const lama = await jurnal("2000-07-31", new Date(ditutup.getTime() - 60 * 60 * 1000));
    const hasil = await jurnalSesudahDitutup();
    expect(hasil.find((x) => x.id === selundup)).toMatchObject({ bulan: "2000-07", ditutup: ditutup.toISOString() });
    expect(hasil.find((x) => x.id === lama)).toBeUndefined();

    h.mulai = null;
    expect((await jurnalSesudahDitutup()).find((x) => x.id === selundup)).toBeUndefined();
    h.mulai = new Date("2000-08-01T00:00:00+07:00");
  });
});
