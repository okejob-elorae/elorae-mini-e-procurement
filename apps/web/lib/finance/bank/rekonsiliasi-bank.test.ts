import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { bacaMutasiDariKisi } from "./baca-mutasi";

/*
 * Rekonsiliasi bank terhadap basis data sungguhan: impor (tolak ganda), cocok
 * otomatis/manual, abaikan, voucher dari mutasi, laporan per tanggal.
 * Tanggal uji 2008-07. Peran dipalsukan ke akun uji berkas ini.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});

const w = await import("./mutasi-writer");
const q = await import("./queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
let userId = "";
const akunIds: string[] = [];
const A: Record<string, string> = {};
const tgl = (h: string) => new Date(`${h}T10:00:00+07:00`);

async function buatAkun(k: string, tipe: AccountType, kas = false) {
  const a = await prisma.chartAccount.create({
    data: { code: `6${token}${String(akunIds.length).padStart(2, "0")}`, name: `${k} (uji bank)`, type: tipe, depth: 1, isActive: true, ...(kas ? { cashFlowSection: "KAS" } : {}) },
    select: { id: true },
  });
  akunIds.push(a.id);
  A[k] = a.id;
}

async function jurnalBank(hari: string, jumlah: number, uraian: string) {
  const r = await postJournal(prisma, {
    date: tgl(hari),
    description: `${uraian} ${token}`,
    postedById: userId,
    lines:
      jumlah >= 0
        ? [
            { chartAccountId: A.BANK, debit: jumlah, credit: 0 },
            { chartAccountId: A.PENDAPATAN, debit: 0, credit: jumlah },
          ]
        : [
            { chartAccountId: A.BEBAN, debit: -jumlah, credit: 0 },
            { chartAccountId: A.BANK, debit: 0, credit: -jumlah },
          ],
  });
  const b = await prisma.journalLine.findFirst({ where: { journalId: r.journalId, chartAccountId: A.BANK }, select: { id: true } });
  return b!.id;
}

const MUTASI = bacaMutasiDariKisi([
  ["Tanggal", "Keterangan", "Debit", "Kredit", "Saldo"],
  ["2008-07-02", "TRF KE PT KAIN", "1500000", "", "8500000"],
  ["2008-07-03", "SETORAN", "", "900000", "9400000"],
  ["2008-07-05", "BIAYA ADM", "10000", "", "9390000"],
  ["2008-07-05", "BIAYA ADM", "10000", "", "9380000"],
  ["2008-07-06", "BUNGA", "", "2500", "9382500"],
]);

d("rekonsiliasi bank (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `bank-${token}@test.local`, name: "Uji bank" }, select: { id: true } })).id;
    await buatAkun("BANK", "ASET", true);
    await buatAkun("BEBAN", "BEBAN");
    await buatAkun("BIAYA_BANK", "BEBAN");
    await buatAkun("PENDAPATAN", "PENDAPATAN");
    await buatAkun("PENDAPATAN_LAIN", "PENDAPATAN");
    await buatAkun("HUTANG_USAHA", "LIABILITAS");
    peta.akun.set("BANK_CHARGES", A.BIAYA_BANK);
    peta.akun.set("OTHER_INCOME", A.PENDAPATAN_LAIN);
    peta.akun.set("AP", A.HUTANG_USAHA);
  }, 60_000);

  afterAll(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal.map((j) => j.id)) } } });
    await prisma.bankStatementImport.deleteMany({ where: { chartAccountId: seededId(A.BANK) } });
    await prisma.cashVoucher.deleteMany({ where: { createdById: seededId(userId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("impor, tolak baris ganda saat impor ulang, cocok otomatis ±3 hari, lalu laporan", async () => {
    expect(MUTASI.ok).toBe(true);
    if (!MUTASI.ok) return;
    const jTrf = await jurnalBank("2008-06-30", -1_500_000, "Bayar kain");
    const jSetor = await jurnalBank("2008-07-03", 900_000, "Setoran");
    const jLuar = await jurnalBank("2008-07-10", 400_000, "Setoran dalam perjalanan");

    const imp = await w.imporMutasi({
      akunId: A.BANK,
      namaBerkas: "juli.csv",
      format: MUTASI.format,
      baris: MUTASI.baris,
      periodeDari: MUTASI.periodeDari,
      periodeSampai: MUTASI.periodeSampai,
      saldoAwalSen: MUTASI.saldoAwalSen,
      saldoAkhirSen: MUTASI.saldoAkhirSen,
      olehUserId: userId,
    });
    expect(imp).toMatchObject({ ok: true, baru: 5, sudahAda: 0, dicocokkan: 2 });
    const ulang = await w.imporMutasi({ akunId: A.BANK, namaBerkas: "juli.csv", format: MUTASI.format, baris: MUTASI.baris, periodeDari: null, periodeSampai: null, saldoAwalSen: null, saldoAkhirSen: null, olehUserId: userId });
    expect(ulang).toEqual({ ok: true, importId: null, baru: 0, sudahAda: 5, dicocokkan: 0 });

    const cocok = await prisma.bankStatementLine.findMany({ where: { chartAccountId: A.BANK, status: "MATCHED" }, select: { matchedJournalLineId: true } });
    expect(cocok.map((c) => c.matchedJournalLineId).sort()).toEqual([jTrf, jSetor].sort());

    const lap = await q.laporanRekonsiliasi(A.BANK, "2008-07-31");
    // Bank 9.382.500; buku = -1.500.000 + 900.000 + 400.000 = -200.000.
    expect(lap.ringkasan.saldoBankSen).toBe(938_250_000);
    expect(lap.ringkasan.saldoBukuSen).toBe(-20_000_000);
    expect(lap.jurnalBelumCocok.map((j) => j.jumlah)).toEqual([400_000]);
    expect(lap.mutasiBelumCocok.map((m) => m.jumlah)).toEqual([-10_000, -10_000, 2_500]);
    // Tanpa saldo awal yang tercatat di buku besar, selisih = saldo awal bank (10.000.000).
    expect(lap.ringkasan.selisihSen).toBe(1_000_000_000);
    expect(lap.sejak).toBe("2008-07-02");
    void jLuar;
  });

  it("voucher dari mutasi (biaya admin, bunga), abaikan, cocok manual, lepas, hapus impor ditolak", async () => {
    const belum = await prisma.bankStatementLine.findMany({ where: { chartAccountId: A.BANK, status: "UNMATCHED" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
    const [adm1, adm2, bunga] = belum;
    const v = await w.buatVoucherDariMutasi({ mutasiId: adm1.id, olehUserId: userId, peranCepat: "BIAYA_ADMIN" });
    expect(v).toMatchObject({ ok: true });
    if (!v.ok) return;
    expect(v.nomor.startsWith("BKK/")).toBe(true);
    const b = await w.buatVoucherDariMutasi({ mutasiId: bunga.id, olehUserId: userId, peranCepat: "BUNGA" });
    expect(b.ok && b.nomor.startsWith("BKMK/")).toBe(true);
    const terisi = await prisma.bankStatementLine.findUnique({ where: { id: adm1.id } });
    expect(terisi).toMatchObject({ status: "MATCHED" });
    expect(terisi!.createdJournalId).not.toBeNull();
    expect(await w.lepasCocok({ mutasiId: adm1.id, olehUserId: userId })).toEqual({ ok: false, kode: "DARI_VOUCHER" });

    expect(await w.abaikanMutasi({ mutasiId: adm2.id, olehUserId: userId, alasan: "" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await w.abaikanMutasi({ mutasiId: adm2.id, olehUserId: userId, alasan: "Dobel dari bank" })).toEqual({ ok: true });
    expect(await w.bukaAbaikan({ mutasiId: adm2.id, olehUserId: userId })).toEqual({ ok: true });

    const jManual = await jurnalBank("2008-07-20", -10_000, "Admin dicatat manual");
    const jSalah = await jurnalBank("2008-07-20", -11_000, "Jumlah lain");
    expect(await w.cocokkanManual({ mutasiId: adm2.id, barisJurnalId: jSalah, olehUserId: userId })).toEqual({ ok: false, kode: "JUMLAH_BERBEDA" });
    const kandidat = await q.kandidatJurnal(adm2.id);
    expect(kandidat.map((k) => k.barisId)).toContain(jManual);
    expect(await w.cocokkanManual({ mutasiId: adm2.id, barisJurnalId: jManual, olehUserId: userId })).toEqual({ ok: true });
    expect(await w.lepasCocok({ mutasiId: adm2.id, olehUserId: userId })).toEqual({ ok: true });
    expect(await w.cocokkanManual({ mutasiId: adm2.id, barisJurnalId: jManual, olehUserId: userId })).toEqual({ ok: true });

    const lap = await q.laporanRekonsiliasi(A.BANK, "2008-07-31");
    expect(lap.mutasiBelumCocok).toEqual([]);
    const imporId = (await prisma.bankStatementImport.findFirst({ where: { chartAccountId: A.BANK }, select: { id: true } }))!.id;
    expect(await w.hapusImporMutasi({ importId: imporId, olehUserId: userId })).toEqual({ ok: false, kode: "ADA_YANG_COCOK" });
    const halaman = await q.daftarMutasi({ akunId: A.BANK });
    expect(halaman.total).toBe(5);
    expect(halaman.jumlahPerStatus.MATCHED).toBe(5);
    expect(halaman.baris.find((x) => x.id === adm1.id)!.dariVoucher).toBe(true);
  });
});
