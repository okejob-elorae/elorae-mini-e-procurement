import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * Voucher kas & bank terhadap basis data sungguhan (Postgres lokal).
 *
 * Tanggal uji 2008 (tidak dipakai tes lain). Pemetaan peran → akun dipalsukan
 * lewat `resolveAccount` ke akun uji berkas ini; rekening kas uji ditandai
 * `cashFlowSection = KAS` supaya terbaca sebagai rekening. Tidak ada pemetaan
 * bersama yang diubah. Teardown lewat `seededId()`.
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

const { catatVoucher, batalkanVoucher, postingUlangJurnalVoucher } = await import("./voucher-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
const HARI_INI = "2008-12-31";
let userId = "";
const akunIds: string[] = [];
const voucherIds: string[] = [];
const kategoriIds: string[] = [];
const imporIds: string[] = [];
const A: Record<string, string> = {};

async function buatAkun(kunci: string, tipe: AccountType, kas = false) {
  const a = await prisma.chartAccount.create({
    data: { code: `7${token}${String(akunIds.length).padStart(2, "0")}`, name: `${kunci} (uji kas)`, type: tipe, depth: 1, isActive: true, ...(kas ? { cashFlowSection: "KAS" } : {}) },
    select: { id: true },
  });
  akunIds.push(a.id);
  A[kunci] = a.id;
  return a.id;
}

async function jurnalDari(sourceType: string, sourceId: string) {
  const j = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { id: true, date: true, reversalOfId: true, lines: { select: { id: true, chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
  if (!j) return null;
  const nama = new Map(Object.entries(A).map(([k, v]) => [v, k]));
  return {
    ...j,
    baris: j.lines.map((l) => [nama.get(l.chartAccountId) ?? l.chartAccountId, Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(b[1]) - Number(a[1])),
  };
}

const kunci = (s: string) => `uji-kas-${token}-${s}`;

d("voucher kas & bank (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `kas-${token}@test.local`, name: "Uji kas" }, select: { id: true } })).id;
    await buatAkun("KAS", "ASET", true);
    await buatAkun("BANK", "ASET", true);
    await buatAkun("BEBAN_LISTRIK", "BEBAN");
    await buatAkun("BEBAN_JASA", "BEBAN");
    await buatAkun("PENDAPATAN_LAIN", "PENDAPATAN");
    await buatAkun("HUTANG_USAHA", "LIABILITAS");
    await buatAkun("HUTANG_PPH23", "LIABILITAS");
    await buatAkun("HUTANG_KOMISI", "LIABILITAS");
    peta.akun.set("COMMISSION_PAYABLE", A.HUTANG_KOMISI);
    peta.akun.set("AP", A.HUTANG_USAHA);
    peta.akun.set("PPH23_PAYABLE", A.HUTANG_PPH23);
    for (const [nama, tipe, akun, potong] of [
      [`Listrik uji ${token}`, "OUT", A.BEBAN_LISTRIK, null],
      [`Jasa uji ${token}`, "OUT", A.BEBAN_JASA, "PPH23"],
      [`Lain masuk uji ${token}`, "IN", A.PENDAPATAN_LAIN, null],
    ] as const) {
      const k = await prisma.cashCategory.create({ data: { name: nama, type: tipe, chartAccountId: akun, withholdingType: potong }, select: { id: true } });
      kategoriIds.push(k.id);
    }
  }, 60_000);

  afterAll(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    const ids = jurnal.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.bankStatementImport.deleteMany({ where: { id: { in: seededIds(imporIds) } } });
    await prisma.cashVoucher.deleteMany({ where: { id: { in: seededIds(voucherIds) } } });
    await prisma.cashCategory.deleteMany({ where: { id: { in: seededIds(kategoriIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("voucher keluar ber-PPh 23: DR beban bruto / CR kas neto / CR hutang PPh; nomor BKK; kirim ulang mengembalikan yang pertama", async () => {
    const isian = {
      jenis: "OUT",
      tanggal: "2008-03-05",
      rekeningId: A.KAS,
      pihak: "CV Jasa Uji",
      jenisPotong: "PPH23",
      baris: [
        { kategoriId: kategoriIds[1], jumlah: "1.000.000", memo: "Jasa desain" },
        { kategoriId: kategoriIds[0], jumlah: "250000", kanal: "LAINNYA" },
      ],
      idempotencyKey: kunci("bkk1"),
      olehUserId: userId,
      hariIni: HARI_INI,
    };
    const r = await catatVoucher(isian);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    voucherIds.push(r.id);
    expect(r.nomor.startsWith("BKK/")).toBe(true);
    const v = await prisma.cashVoucher.findUnique({ where: { id: r.id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(Number(v!.totalAmount)).toBe(1_250_000);
    expect(Number(v!.withholdingAmount)).toBe(20_000);
    expect(Number(v!.netAmount)).toBe(1_230_000);
    expect(v!.withholdingType).toBe("PPH23");
    expect(v!.lines.map((l) => [l.chartAccountId, Number(l.amount)])).toEqual([
      [A.BEBAN_JASA, 1_000_000],
      [A.BEBAN_LISTRIK, 250_000],
    ]);
    const j = await jurnalDari("CASH_VOUCHER", r.id);
    expect(j!.baris).toEqual([
      ["BEBAN_JASA", 1_000_000, 0],
      ["BEBAN_LISTRIK", 250_000, 0],
      ["HUTANG_PPH23", 0, 20_000],
      ["KAS", 0, 1_230_000],
    ]);
    const ulang = await catatVoucher({ ...isian, baris: [{ kategoriId: kategoriIds[0], jumlah: "5" }] });
    expect(ulang).toEqual({ ok: true, id: r.id, nomor: r.nomor, journalId: j!.id, ulang: true });
    expect(await prisma.cashVoucher.count({ where: { idempotencyKey: kunci("bkk1") } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CASH_VOUCHER_RECORDED", entityId: r.id } })).toBe(1);
  });

  it("voucher masuk dan transfer antar rekening", async () => {
    const masuk = await catatVoucher({
      jenis: "IN",
      tanggal: "2008-03-06",
      rekeningId: A.BANK,
      baris: [{ kategoriId: kategoriIds[2], jumlah: 75_000 }],
      olehUserId: userId,
      hariIni: HARI_INI,
    });
    expect(masuk.ok).toBe(true);
    if (!masuk.ok) return;
    voucherIds.push(masuk.id);
    expect(masuk.nomor.startsWith("BKMK/")).toBe(true);
    expect((await jurnalDari("CASH_VOUCHER", masuk.id))!.baris).toEqual([
      ["BANK", 75_000, 0],
      ["PENDAPATAN_LAIN", 0, 75_000],
    ]);
    const trf = await catatVoucher({ jenis: "TRANSFER", tanggal: "2008-03-07", rekeningId: A.BANK, rekeningTujuanId: A.KAS, jumlahTransfer: "2.000.000", olehUserId: userId, hariIni: HARI_INI });
    expect(trf.ok).toBe(true);
    if (!trf.ok) return;
    voucherIds.push(trf.id);
    expect(trf.nomor.startsWith("TRF/")).toBe(true);
    expect((await jurnalDari("CASH_VOUCHER", trf.id))!.baris).toEqual([
      ["BANK", 0, 2_000_000],
      ["KAS", 2_000_000, 0],
    ]);
  });

  it("menolak baris ke akun kas, ke hutang usaha, rekening yang bukan kas, kategori berlawanan jenis, dan potongan tak terpetakan", async () => {
    const dasar = { jenis: "OUT", tanggal: "2008-03-08", rekeningId: A.KAS, olehUserId: userId, hariIni: HARI_INI };
    expect(await catatVoucher({ ...dasar, baris: [{ akunId: A.BANK, jumlah: 1 }] })).toEqual({ ok: false, kode: "AKUN_KAS_DI_BARIS", baris: 1 });
    expect(await catatVoucher({ ...dasar, baris: [{ akunId: A.HUTANG_USAHA, jumlah: 1 }] })).toEqual({ ok: false, kode: "AKUN_HUTANG_USAHA", baris: 1 });
    // Hutang komisi dibayar lewat "Tandai dibayar"-nya; hutang PPh lewat Setoran pajak.
    expect(await catatVoucher({ ...dasar, baris: [{ akunId: A.BEBAN_JASA, jumlah: 1 }, { akunId: A.HUTANG_KOMISI, jumlah: 1 }] })).toEqual({ ok: false, kode: "AKUN_HUTANG_ALUR", baris: 2 });
    expect(await catatVoucher({ ...dasar, baris: [{ akunId: A.HUTANG_PPH23, jumlah: 1 }] })).toEqual({ ok: false, kode: "AKUN_HUTANG_PAJAK", baris: 1 });
    expect(await catatVoucher({ ...dasar, rekeningId: A.BEBAN_LISTRIK, baris: [{ akunId: A.BEBAN_JASA, jumlah: 1 }] })).toEqual({ ok: false, kode: "REKENING_TIDAK_SAH" });
    expect(await catatVoucher({ ...dasar, baris: [{ kategoriId: kategoriIds[2], jumlah: 1 }] })).toEqual({ ok: false, kode: "KATEGORI_TIDAK_SAH", baris: 1 });
    expect(await catatVoucher({ ...dasar, jenisPotong: "PPH4_2", baris: [{ akunId: A.BEBAN_JASA, jumlah: 1000 }] })).toEqual({ ok: false, kode: "UNMAPPED_ROLE", peran: "PPH4_2_PAYABLE" });
    expect(await prisma.cashVoucher.count({ where: { createdById: userId, date: new Date("2008-03-08T00:00:00+07:00") } })).toBe(0);
  });

  it("batal: jurnal pembalik bertanggal asli, mutasi bank yang tercocok dilepas, batal kedua ditolak", async () => {
    const r = await catatVoucher({ jenis: "OUT", tanggal: "2008-04-02", rekeningId: A.BANK, baris: [{ akunId: A.BEBAN_LISTRIK, jumlah: 50_000 }], olehUserId: userId, hariIni: HARI_INI });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    voucherIds.push(r.id);
    const asli = await jurnalDari("CASH_VOUCHER", r.id);
    const barisBank = asli!.lines.find((l) => l.chartAccountId === A.BANK)!;
    const impor = await prisma.bankStatementImport.create({
      data: {
        chartAccountId: A.BANK,
        fileName: "uji.csv",
        importedById: userId,
        lineCount: 1,
        lines: { create: [{ chartAccountId: A.BANK, date: new Date("2008-04-02T00:00:00+07:00"), description: "uji", amount: -50_000, status: "MATCHED", matchedJournalLineId: barisBank.id, matchedAt: new Date(), matchedById: userId }] },
      },
      select: { id: true },
    });
    imporIds.push(impor.id);

    expect(await batalkanVoucher({ id: r.id, olehUserId: userId, alasan: "x" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const b = await batalkanVoucher({ id: r.id, olehUserId: userId, alasan: "Salah rekening" });
    expect(b.ok).toBe(true);
    const balik = await jurnalDari("CASH_VOUCHER_REVERSAL", r.id);
    expect(balik!.reversalOfId).toBe(asli!.id);
    expect(balik!.date.toISOString()).toBe(asli!.date.toISOString());
    expect(balik!.baris).toEqual([
      ["BANK", 50_000, 0],
      ["BEBAN_LISTRIK", 0, 50_000],
    ]);
    const mutasi = await prisma.bankStatementLine.findFirst({ where: { importId: impor.id } });
    expect(mutasi).toMatchObject({ status: "UNMATCHED", matchedJournalLineId: null });
    expect((await prisma.cashVoucher.findUnique({ where: { id: r.id } }))!.status).toBe("CANCELLED");
    expect(await batalkanVoucher({ id: r.id, olehUserId: userId, alasan: "Salah rekening" })).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
  });

  it("sapuan memposting ulang voucher berlaku yang kehilangan jurnalnya, dan idempoten", async () => {
    const v = await prisma.cashVoucher.create({
      data: {
        docNumber: `BKK/UJI/${token}`,
        type: "OUT",
        date: new Date("2008-05-01T00:00:00+07:00"),
        cashAccountId: A.KAS,
        totalAmount: 10_000,
        netAmount: 10_000,
        createdById: userId,
        lines: { create: [{ chartAccountId: A.BEBAN_LISTRIK, amount: 10_000 }] },
      },
      select: { id: true },
    });
    voucherIds.push(v.id);
    const r = await postingUlangJurnalVoucher(v.id, userId);
    expect(r).toMatchObject({ ok: true, created: true });
    expect((await jurnalDari("CASH_VOUCHER", v.id))!.baris).toEqual([
      ["BEBAN_LISTRIK", 10_000, 0],
      ["KAS", 0, 10_000],
    ]);
    expect(await postingUlangJurnalVoucher(v.id, userId)).toMatchObject({ ok: true, created: false });
  });
});
