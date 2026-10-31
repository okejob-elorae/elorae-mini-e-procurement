import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { batalkanVoucher, catatVoucher } from "@/lib/finance/kas/voucher-writer";

/*
 * Rekonsiliasi bank × voucher yang dibatalkan (uji akuntansi gelombang 2, R3):
 * membatalkan voucher meninggalkan jurnal aslinya BERLAKU plus jurnal
 * pembaliknya — pasangan itu bernilai nol di rekening, jadi tidak satu pun
 * barisnya boleh dicocokkan dengan mutasi bank (otomatis, kandidat manual,
 * atau cocok manual), termasuk saat pembatalan dan pencocokan balapan.
 * Tanggal uji Februari 2002; akun dan pengguna milik tes ini.
 */

const w = await import("./mutasi-writer");
const q = await import("./queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
let userId = "";
let bank = "";
let beban = "";
let periodeLama = new Set<string>();

async function voucher(tanggal: string, jumlah: number): Promise<{ id: string; barisBank: string }> {
  const v = await catatVoucher({
    jenis: "OUT",
    tanggal,
    rekeningId: bank,
    keterangan: `uji batal ${token}`,
    baris: [{ akunId: beban, kategoriId: null, jumlah }],
    olehUserId: userId,
  });
  if (!v.ok || !v.journalId) throw new Error(`voucher gagal: ${v.ok ? "tanpa jurnal" : v.kode}`);
  const b = await prisma.journalLine.findFirstOrThrow({ where: { journalId: v.journalId, chartAccountId: bank }, select: { id: true } });
  return { id: v.id, barisBank: b.id };
}

async function mutasi(tanggal: string, jumlah: number): Promise<string> {
  const imp = await prisma.bankStatementImport.create({ data: { chartAccountId: bank, fileName: `uji-${token}.csv`, lineCount: 1, importedById: userId }, select: { id: true } });
  const m = await prisma.bankStatementLine.create({
    data: { importId: imp.id, chartAccountId: bank, date: new Date(`${tanggal}T00:00:00+07:00`), description: `uji ${token}`, amount: jumlah, status: "UNMATCHED" },
    select: { id: true },
  });
  return m.id;
}

d("rekonsiliasi bank × voucher dibatalkan (test bed only, 2002)", () => {
  beforeAll(async () => {
    userId = "";
    bank = "";
    beban = "";
    periodeLama = new Set((await prisma.accountingPeriod.findMany({ select: { id: true } })).map((p) => p.id));
    userId = (await prisma.user.create({ data: { email: `bank-batal-${token}@test.local`, name: "Uji bank batal" }, select: { id: true } })).id;
    bank = (await prisma.chartAccount.create({ data: { code: `6${token}91`, name: "Bank uji batal", type: "ASET", depth: 1, cashFlowSection: "KAS" }, select: { id: true } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `6${token}92`, name: "Beban uji batal", type: "BEBAN", depth: 1 }, select: { id: true } })).id;
  }, 60_000);

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        const ids = j.map((x) => x.id);
        if (!ids.length) return;
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) }, reversalOfId: { not: null } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      () => prisma.bankStatementImport.deleteMany({ where: { chartAccountId: seededId(bank) } }),
      () => prisma.cashVoucher.deleteMany({ where: { createdById: seededId(userId) } }),
      () => prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } }),
      async () => {
        const baru = (await prisma.accountingPeriod.findMany({ select: { id: true } })).map((p) => p.id).filter((id) => !periodeLama.has(id));
        if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(bank), seededId(beban)] } } }),
      () => prisma.user.deleteMany({ where: { id: seededId(userId) } }),
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[bank batal.test] teardown", e);
      }
    }
  }, 60_000);

  it("baris voucher batal (asli dan pembaliknya) tidak dicocokkan otomatis, tidak muncul di kandidat, dan cocok manual ditolak", async () => {
    const batal = await voucher("2002-02-05", 250_000);
    expect(await batalkanVoucher({ id: batal.id, olehUserId: userId, alasan: "salah catat uji" })).toMatchObject({ ok: true });
    const hidup = await voucher("2002-02-06", 100_000);
    const mBatal = await mutasi("2002-02-05", -250_000);
    const mBalik = await mutasi("2002-02-05", 250_000);
    const mHidup = await mutasi("2002-02-06", -100_000);

    const r = await w.cocokkanOtomatisAkun({ akunId: bank, olehUserId: userId });
    expect(r).toEqual({ ok: true, dicocokkan: 1 });
    const status = async (id: string) => (await prisma.bankStatementLine.findUniqueOrThrow({ where: { id }, select: { status: true, matchedJournalLineId: true } }));
    expect(await status(mHidup)).toEqual({ status: "MATCHED", matchedJournalLineId: hidup.barisBank });
    expect((await status(mBatal)).status).toBe("UNMATCHED");
    expect((await status(mBalik)).status).toBe("UNMATCHED");

    expect((await q.kandidatJurnal(mBatal)).map((k) => k.barisId)).not.toContain(batal.barisBank);
    expect(await q.kandidatJurnal(mBalik)).toEqual([]);
    expect(await w.cocokkanManual({ mutasiId: mBatal, barisJurnalId: batal.barisBank, olehUserId: userId })).toEqual({ ok: false, kode: "JURNAL_DIBATALKAN" });
    const balik = await prisma.journalLine.findFirstOrThrow({ where: { chartAccountId: bank, journal: { reversalOfId: { not: null }, postedById: userId } }, select: { id: true } });
    expect(await w.cocokkanManual({ mutasiId: mBalik, barisJurnalId: balik.id, olehUserId: userId })).toEqual({ ok: false, kode: "JURNAL_DIBATALKAN" });
    expect((await status(mBatal)).status).toBe("UNMATCHED");
  });

  it("balapan cocok manual × batal voucher: akhirnya voucher batal dan mutasinya tidak menunjuk jurnal yang dibatalkan", async () => {
    for (let i = 0; i < 3; i++) {
      const v = await voucher("2002-02-10", 70_000 + i);
      const m = await mutasi("2002-02-10", -(70_000 + i));
      const [cocok, batal] = await Promise.all([
        w.cocokkanManual({ mutasiId: m, barisJurnalId: v.barisBank, olehUserId: userId }),
        batalkanVoucher({ id: v.id, olehUserId: userId, alasan: "balapan uji" }),
      ]);
      expect(batal).toMatchObject({ ok: true });
      expect([true, false]).toContain(cocok.ok);
      const akhir = await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: m }, select: { status: true, matchedJournalLineId: true } });
      expect(akhir).toEqual({ status: "UNMATCHED", matchedJournalLineId: null });
      expect((await prisma.cashVoucher.findUniqueOrThrow({ where: { id: v.id }, select: { status: true } })).status).toBe("CANCELLED");
    }
  });
});
