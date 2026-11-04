import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { adalahJurnalSaldoAwal, getAccountBalances } from "./balances";
import { getCashOpeningBalance } from "./cash-flow-queries";
import { listJournals, getAccountLedger } from "@/lib/finance/journals/queries";

/*
 * Saringan jurnal di laporan (bagian A1), basis data sungguhan, NOVEMBER 2001:
 * - draf jurnal manual tidak pernah dihitung;
 * - jurnal penutup tahun hanya ikut bila diminta (Neraca);
 * - jurnal saldo awal keluar dari mutasi arus kas dan masuk kas awal.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TAHUN = 2001;
const BULAN = 11;
const awal = new Date(Date.UTC(TAHUN, BULAN - 1, 1) - 7 * 3600_000);
const akhir = new Date(Date.UTC(TAHUN, BULAN, 1) - 7 * 3600_000 - 1);
const tgl = (hari: number) => new Date(Date.UTC(TAHUN, BULAN - 1, hari, 3));

d("saringan jurnal laporan (test bed only)", () => {
  let token = "";
  let userId = "";
  let kas = "";
  let pendapatan = "";
  let ekuitas = "";

  beforeAll(async () => {
    userId = "";
    kas = "";
    pendapatan = "";
    ekuitas = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-saringan-laporan-${token}@test.local`, name: "Uji saringan" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}31`, name: "Kas uji saringan", type: "ASET", depth: 1 } })).id;
    pendapatan = (await prisma.chartAccount.create({ data: { code: `9${token}32`, name: "Pendapatan uji saringan", type: "PENDAPATAN", depth: 1 } })).id;
    ekuitas = (await prisma.chartAccount.create({ data: { code: `9${token}33`, name: "Ekuitas uji saringan", type: "EKUITAS", depth: 1 } })).id;

    const jurnal = (isi: { hari: number; nilai: number; dr: string; cr: string; sumber?: string; draf?: boolean }) =>
      postJournal(prisma, {
        date: tgl(isi.hari),
        description: `uji saringan ${token}`,
        postedById: userId,
        ...(isi.sumber ? { source: { type: isi.sumber, id: `uji-${token}` } } : {}),
        ...(isi.draf ? { status: "DRAFT" as const, isManual: true } : {}),
        lines: [
          { chartAccountId: isi.dr, debit: isi.nilai, credit: 0 },
          { chartAccountId: isi.cr, debit: 0, credit: isi.nilai },
        ],
      });
    await jurnal({ hari: 1, nilai: 1000, dr: kas, cr: ekuitas, sumber: "OPENING" });
    await jurnal({ hari: 10, nilai: 100, dr: kas, cr: pendapatan });
    await jurnal({ hari: 11, nilai: 50, dr: kas, cr: pendapatan, draf: true });
    await jurnal({ hari: 30, nilai: 100, dr: pendapatan, cr: ekuitas, sumber: "YEAR_END_CLOSE" });
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        if (!j.length) return;
        const ids = j.map((x) => x.id);
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: TAHUN, month: BULAN }, select: { id: true } });
        if (p.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(p.map((x) => x.id)) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(pendapatan), seededId(ekuitas)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[saringan-laporan.test] teardown", e);
      }
    }
  }, 60_000);

  const milik = (rows: Awaited<ReturnType<typeof getAccountBalances>>, id: string) => rows.find((r) => r.accountId === id);

  it("bawaan: draf tidak dihitung, jurnal penutup tahun tidak ikut, saldo awal ikut", async () => {
    const rows = await getAccountBalances({ from: awal, to: akhir });
    expect(milik(rows, kas)).toMatchObject({ debit: 1100, credit: 0 });
    expect(milik(rows, pendapatan)).toMatchObject({ debit: 0, credit: 100, signed: 100 });
  });

  it("Neraca menyertakan jurnal penutup tahun: pendapatan nol, ekuitas menampung", async () => {
    const rows = await getAccountBalances({ to: akhir }, { sertakanTutupTahun: true });
    expect(milik(rows, pendapatan)?.signed).toBe(0);
    expect(milik(rows, ekuitas)?.signed).toBe(1100);
  });

  it("arus kas: saldo awal keluar dari mutasi dan masuk kas awal", async () => {
    const rows = await getAccountBalances({ from: awal, to: akhir }, { kecualiSaldoAwal: true });
    expect(milik(rows, kas)).toMatchObject({ debit: 100, credit: 0 });
    expect(await getCashOpeningBalance(new Date(awal.getTime() - 1), [kas])).toBe(0);
    expect(await getCashOpeningBalance(new Date(awal.getTime() - 1), [kas], { saldoAwalSampai: akhir })).toBe(1000);
    // Sejak awal (tanpa `before`): hanya saldo awal yang menjadi kas awal.
    expect(await getCashOpeningBalance(undefined, [kas], { saldoAwalSampai: akhir })).toBe(1000);
  });

  it("daftar jurnal dan buku besar akun hanya membaca jurnal berlaku", async () => {
    const daftar = await listJournals({ from: awal, to: akhir, search: `uji saringan ${token}` }, { page: 1, pageSize: 50 });
    expect(daftar.totalCount).toBe(3);
    const draf = await listJournals({ from: awal, to: akhir, search: `uji saringan ${token}`, status: "DRAFT" }, { page: 1, pageSize: 50 });
    expect(draf.totalCount).toBe(1);
    const buku = await getAccountLedger(kas, { from: awal, to: akhir });
    expect(buku.rows.map((r) => r.debit)).toEqual([1000, 100]);
  });

  it("jurnal paling awal manual atau dari wizard saldo awal menandai saldo awal sudah dicatat", () => {
    expect(adalahJurnalSaldoAwal({ isManual: false, sourceType: "OPENING" })).toBe(true);
    expect(adalahJurnalSaldoAwal({ isManual: true, sourceType: null })).toBe(true);
    expect(adalahJurnalSaldoAwal({ isManual: false, sourceType: "GRN" })).toBe(false);
  });
});
