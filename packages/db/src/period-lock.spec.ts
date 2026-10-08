import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { postJournal, JournalError } from "./journal-writer";
import { firstDayOfMonthWib, nextYearMonth, wibDayLabel, wibYearMonth } from "./period-lock";
import { seededId, seededIds } from "./spec-teardown";

describe("period-lock — kalender WIB (murni)", () => {
  it("bulan WIB: 31 Jan 17:00 UTC sudah 1 Feb WIB", () => {
    expect(wibYearMonth(new Date("2026-01-31T16:59:59.999Z"))).toEqual({ year: 2026, month: 1 });
    expect(wibYearMonth(new Date("2026-01-31T17:00:00.000Z"))).toEqual({ year: 2026, month: 2 });
    expect(wibYearMonth(new Date("2026-12-31T17:00:00.000Z"))).toEqual({ year: 2027, month: 1 });
  });

  it("tanggal 1 bulan WIB, bulan berikut, dan label hari", () => {
    expect(firstDayOfMonthWib(2026, 3).toISOString()).toBe("2026-02-28T17:00:00.000Z");
    expect(nextYearMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    expect(nextYearMonth({ year: 2026, month: 4 })).toEqual({ year: 2026, month: 5 });
    expect(wibDayLabel(new Date("2026-09-14T18:00:00.000Z"))).toBe("15 Sep 2026");
  });
});

// Menulis jurnal dan periode — tidak pernah di basis data produksi (tunnel 3307 / host VPS).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Tahun 2001 tidak pernah berisi data sungguhan; bulan-bulan di bawah hanya
 * disentuh tes ini. Baris periode dicatat id-nya dan dihapus per id.
 */
const TAHUN = 2001;
const BULAN_DIPAKAI = [5, 6, 7, 8];

d("postJournal × periode tertutup (test bed only)", () => {
  let token = "";
  let adminId = "";
  let kasId = "";
  let bebanId = "";

  const tanggal = (bulan: number, hari: number) => new Date(Date.UTC(TAHUN, bulan - 1, hari, 3)); // 10:00 WIB

  async function tutup(bulan: number) {
    await prisma.accountingPeriod.upsert({
      where: { year_month: { year: TAHUN, month: bulan } },
      create: { year: TAHUN, month: bulan, status: "CLOSED", closedAt: new Date() },
      update: { status: "CLOSED", closedAt: new Date() },
    });
  }

  const baris = () => [
    { chartAccountId: bebanId, debit: 1000, credit: 0 },
    { chartAccountId: kasId, debit: 0, credit: 1000 },
  ];

  beforeEach(async () => {
    adminId = "";
    kasId = "";
    bebanId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    adminId = (await prisma.user.create({ data: { email: `test-periode-${token}@test.local`, name: "Uji Periode" } })).id;
    kasId = (await prisma.chartAccount.create({ data: { code: `9${token}81`, name: "Kas uji periode", type: "ASET", depth: 1 } })).id;
    bebanId = (await prisma.chartAccount.create({ data: { code: `9${token}82`, name: "Beban uji periode", type: "BEBAN", depth: 1 } })).id;
  });

  afterEach(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(adminId) }, select: { id: true } });
    const ids = jurnal.map((j) => j.id);
    if (ids.length) {
      await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
      await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    }
    const periode = await prisma.accountingPeriod.findMany({
      where: { year: TAHUN, month: { in: BULAN_DIPAKAI } },
      select: { id: true },
    });
    if (periode.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(periode.map((p) => p.id)) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kasId), seededId(bebanId)] } } });
    if (adminId) await prisma.user.delete({ where: { id: adminId } });
  });

  it("bulan terbuka: tanggal tidak berubah, baris periodenya terbentuk OPEN", async () => {
    const r = await postJournal(prisma, { date: tanggal(5, 10), description: "uji", postedById: adminId, lines: baris() });
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId } });
    expect(j.date.toISOString()).toBe(tanggal(5, 10).toISOString());
    expect(j.originalDate).toBeNull();
    const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: 5 } } });
    expect(p.status).toBe("OPEN");
  });

  it("jurnal manual di bulan tertutup ditolak PERIOD_CLOSED dan tidak menulis apa pun", async () => {
    await tutup(6);
    await expect(
      postJournal(prisma, { date: tanggal(6, 3), description: "manual", postedById: adminId, isManual: true, lines: baris() }),
    ).rejects.toMatchObject({ name: "JournalError", code: "PERIOD_CLOSED" });
    await expect(
      postJournal(prisma, { date: tanggal(6, 3), description: "draf", postedById: adminId, status: "DRAFT", lines: baris() }),
    ).rejects.toBeInstanceOf(JournalError);
    expect(await prisma.journal.count({ where: { postedById: adminId } })).toBe(0);
  });

  it("jurnal otomatis di bulan tertutup digeser ke tanggal 1 bulan terbuka berikutnya — melompati bulan tertutup berderet", async () => {
    await tutup(6);
    await tutup(7);
    const asli = tanggal(6, 20);
    const r = await postJournal(prisma, {
      date: asli,
      description: "GRN uji",
      postedById: adminId,
      source: { type: "UJI_PERIODE", id: `geser-${token}` },
      lines: baris(),
    });
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId } });
    expect(j.date.toISOString()).toBe(firstDayOfMonthWib(TAHUN, 8).toISOString());
    expect(j.originalDate?.toISOString()).toBe(asli.toISOString());
    expect(j.description).toBe(`GRN uji (tanggal asli ${wibDayLabel(asli)}, periodenya sudah ditutup)`);

    // Idempoten: posting ulang sumber yang sama mengembalikan jurnal yang sudah ada, bukan menggeser lagi.
    const ulang = await postJournal(prisma, {
      date: asli,
      description: "GRN uji",
      postedById: adminId,
      source: { type: "UJI_PERIODE", id: `geser-${token}` },
      lines: baris(),
    });
    expect(ulang).toEqual({ journalId: r.journalId, created: false });
  });

  it("mode allow memposting ke bulan tertutup apa adanya (khusus jurnal penutupan tahun)", async () => {
    await tutup(6);
    const r = await postJournal(prisma, {
      date: tanggal(6, 30),
      description: "tutup",
      postedById: adminId,
      closedPeriod: "allow",
      lines: baris(),
    });
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId } });
    expect(j.date.toISOString()).toBe(tanggal(6, 30).toISOString());
    expect(j.originalDate).toBeNull();
  });

  it("banyak posting bersamaan di bulan yang sama (baris periode belum ada lalu sudah ada) semuanya berhasil", async () => {
    const kirim = (i: number) =>
      postJournal(prisma, {
        date: tanggal(7, 1 + i),
        description: `bersamaan ${i}`,
        postedById: adminId,
        source: { type: "UJI_PERIODE_BERSAMAAN", id: `${token}-${i}` },
        lines: baris(),
      });
    const pertama = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(kirim));
    const kedua = await Promise.allSettled([6, 7, 8, 9, 10, 11].map(kirim));
    expect([...pertama, ...kedua].filter((r) => r.status === "rejected")).toEqual([]);
    expect(await prisma.journal.count({ where: { postedById: adminId, sourceType: "UJI_PERIODE_BERSAMAAN" } })).toBe(12);
  });

  it("mode refuse berlaku juga untuk jurnal otomatis bila diminta", async () => {
    await tutup(6);
    await expect(
      postJournal(prisma, { date: tanggal(6, 1), description: "x", postedById: adminId, closedPeriod: "refuse", lines: baris() }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});
