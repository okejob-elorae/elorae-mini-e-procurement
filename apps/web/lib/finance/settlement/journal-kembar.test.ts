import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/*
 * Settlement uji bertanggal Juni/Juli 2026 — sebelum tanggal mulai buku besar
 * di basis data uji. Gerbang tanggal mulai diuji di `periode/gerbang.test.ts`;
 * di sini dimatikan supaya yang diuji tetap jurnalnya.
 */
vi.mock("@/lib/finance/periode/gerbang", () => ({ seluruhnyaSebelumTanggalMulai: async () => false }));
import { prisma, seededId, seededIds } from "@elorae/db";
import { postSettlementJournal } from "./journal";
import { setAccountMapping } from "../journals/mapping";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

// Menulis jurnal + pemetaan akun — jangan pernah dijalankan ke basis data produksi.
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Penjaga server untuk settlement kembar: tombol jurnalnya sudah dimatikan di
 * layar, tetapi `postSettlementJournal` (dan aksinya) tidak boleh menjurnal
 * kembaran bila dipanggil langsung — bank didebit dan piutang dikredit dua kali.
 */
d("postSettlementJournal menolak settlement kembar (basis data uji)", () => {
  let token = "";
  let adminId = "";
  let bankId = "";
  let arId = "";
  let feeId = "";
  let settlementIds: string[] = [];
  let mappingSnapshot: MappingSnapshot = {};

  async function buatSettlement(opts: { seller: string; createdAt: Date; fileName: string }): Promise<string> {
    const s = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: opts.seller,
        periodFrom: new Date("2026-07-01T00:00:00+07:00"),
        periodTo: new Date("2026-07-31T00:00:00+07:00"),
        fileName: opts.fileName,
        uploadedById: adminId,
        status: "MATCHED",
        totalPendapatan: 1000,
        totalPengeluaran: 60,
        totalDilepas: 940,
        parsedNetTotal: 940,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        createdAt: opts.createdAt,
      },
      select: { id: true },
    });
    settlementIds.push(s.id);
    return s.id;
  }

  async function jumlahJurnal(settlementId: string): Promise<number> {
    return prisma.journal.count({ where: { sourceType: "SETTLEMENT", sourceId: seededId(settlementId) } });
  }

  beforeEach(async () => {
    token = "";
    adminId = "";
    bankId = "";
    arId = "";
    feeId = "";
    settlementIds = [];
    mappingSnapshot = {};

    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings(["BANK", "AR", "MARKETPLACE_FEE_OTHER"]);
    const user = await prisma.user.create({
      data: { email: `test-settlement-kembar-${token}@test.local`, name: "Uji Kembar" },
    });
    adminId = user.id;
    bankId = (
      await prisma.chartAccount.create({
        data: { code: `8${token}1`, name: "Bank (uji kembar)", type: "ASET", depth: 1, isActive: true },
      })
    ).id;
    arId = (
      await prisma.chartAccount.create({
        data: { code: `8${token}2`, name: "Piutang (uji kembar)", type: "ASET", depth: 1, isActive: true },
      })
    ).id;
    feeId = (
      await prisma.chartAccount.create({
        data: { code: `8${token}3`, name: "Biaya marketplace (uji kembar)", type: "BEBAN", depth: 1, isActive: true },
      })
    ).id;
    await setAccountMapping("BANK", bankId);
    await setAccountMapping("AR", arId);
    await setAccountMapping("MARKETPLACE_FEE_OTHER", feeId);
  });

  afterEach(async () => {
    // Pemetaan akun dipulihkan PALING DULU: itu konfigurasi buku besar sungguhan.
    await restoreMappings(mappingSnapshot);
    const jurnal = await prisma.journal.findMany({
      where: { sourceType: "SETTLEMENT", sourceId: { in: seededIds(settlementIds) } },
      select: { id: true },
    });
    const jurnalIds = jurnal.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnalIds) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    await prisma.settlement.deleteMany({ where: { id: { in: seededIds(settlementIds) } } });
    await prisma.chartAccount.deleteMany({
      where: { id: { in: [seededId(bankId), seededId(arId), seededId(feeId)] } },
    });
    if (adminId) await prisma.user.delete({ where: { id: seededId(adminId) } });
  });

  it("menolak kembaran yang diunggah belakangan tanpa menulis apa pun, lalu yang asli tetap bisa dijurnal", async () => {
    const seller = `kembar-${token}`;
    const asli = await buatSettlement({ seller, createdAt: new Date("2026-08-01T03:00:00Z"), fileName: "asli.xlsx" });
    const kembar = await buatSettlement({ seller, createdAt: new Date("2026-08-02T03:00:00Z"), fileName: "kembar.xlsx" });

    const ditolak = await postSettlementJournal(kembar, adminId, prisma);
    expect(ditolak).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: asli });
    expect(await jumlahJurnal(kembar)).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: kembar }, select: { status: true } });
    expect(s.status).toBe("MATCHED");

    const diterima = await postSettlementJournal(asli, adminId, prisma);
    expect(diterima).toMatchObject({ ok: true, created: true });
    expect(await jumlahJurnal(asli)).toBe(1);

    // Sesudah yang asli dijurnal, kembarannya tetap ditolak.
    const lagi = await postSettlementJournal(kembar, adminId, prisma);
    expect(lagi).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: asli });
    expect(await jumlahJurnal(kembar)).toBe(0);
  });

  it("menolak unggahan lebih awal bila kembarannya yang SUDAH dijurnal; jurnal yang ada tetap idempoten", async () => {
    const seller = `kembar-dijurnal-${token}`;
    // Yang dijurnal lebih dulu (sebelum penjaga unggahan ada) menjadi yang berlaku di buku besar.
    const dijurnal = await buatSettlement({ seller, createdAt: new Date("2026-08-05T03:00:00Z"), fileName: "b.xlsx" });
    expect(await postSettlementJournal(dijurnal, adminId, prisma)).toMatchObject({ ok: true, created: true });
    const lebihAwal = await buatSettlement({ seller, createdAt: new Date("2026-08-01T03:00:00Z"), fileName: "a.xlsx" });

    const ditolak = await postSettlementJournal(lebihAwal, adminId, prisma);
    expect(ditolak).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: dijurnal });
    expect(await jumlahJurnal(lebihAwal)).toBe(0);

    expect(await postSettlementJournal(dijurnal, adminId, prisma)).toMatchObject({ ok: true, created: false });
    expect(await jumlahJurnal(dijurnal)).toBe(1);
  });

  it("juga menolak saat dipanggil dengan klien transaksi milik pemanggil", async () => {
    const seller = `kembar-tx-${token}`;
    const asli = await buatSettlement({ seller, createdAt: new Date("2026-08-01T03:00:00Z"), fileName: "asli.xlsx" });
    const kembar = await buatSettlement({ seller, createdAt: new Date("2026-08-02T03:00:00Z"), fileName: "kembar.xlsx" });

    const hasil = await prisma.$transaction((tx) => postSettlementJournal(kembar, adminId, tx));
    expect(hasil).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: asli });
    expect(await jumlahJurnal(kembar)).toBe(0);
  });

  it("balapan: asli dua kali + kembaran bersamaan → tepat satu jurnal untuk kelompok itu", async () => {
    const seller = `kembar-balap-${token}`;
    const asli = await buatSettlement({ seller, createdAt: new Date("2026-08-01T03:00:00Z"), fileName: "asli.xlsx" });
    const kembar = await buatSettlement({ seller, createdAt: new Date("2026-08-02T03:00:00Z"), fileName: "kembar.xlsx" });

    const hasil = await Promise.all([
      postSettlementJournal(asli, adminId, prisma),
      postSettlementJournal(kembar, adminId, prisma),
      postSettlementJournal(asli, adminId, prisma),
    ]);

    expect(hasil[1]).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: asli });
    const berhasil = [hasil[0], hasil[2]];
    expect(berhasil.every((h) => h.ok)).toBe(true);
    expect(berhasil.filter((h) => h.ok && h.created)).toHaveLength(1);
    expect(await jumlahJurnal(asli)).toBe(1);
    expect(await jumlahJurnal(kembar)).toBe(0);
  });

  it("settlement tanpa kembaran tetap dijurnal seperti biasa", async () => {
    const tunggal = await buatSettlement({
      seller: `tunggal-${token}`,
      createdAt: new Date("2026-08-01T03:00:00Z"),
      fileName: "tunggal.xlsx",
    });
    expect(await postSettlementJournal(tunggal, adminId, prisma)).toMatchObject({ ok: true, created: true });
  });
});
