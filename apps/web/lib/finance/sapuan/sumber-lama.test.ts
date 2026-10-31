import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { semuaSumberSapuan } from "./registri";
import "./sumber-lama";

/*
 * Pencari sumber lama di basis data sungguhan: SQL-nya sah di dialek yang
 * dipakai (rentang tahun 2001 yang kosong), dan GRN memakai syarat penulisnya
 * (GRN ditolak pemilik bukan "tanpa jurnal penerimaan", tetapi menjadi
 * "tanpa jurnal pembatalan" begitu jurnal penerimaannya berdiri).
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const SUMBER_LAMA = [
  "GRN",
  "GRN_REVERSAL",
  "OPNAME",
  "VAN_LOAD",
  "VAN_SALE",
  "VAN_RECONCILE",
  "SALESORDER_REVENUE",
  "SALESORDER_COGS",
];

const TAHUN = 2001;
const rentang = { sejak: new Date(Date.UTC(TAHUN, 0, 1) - 7 * 3600_000), sampai: new Date(Date.UTC(TAHUN, 11, 31, 16, 59, 59)) };

d("sumber sapuan lama (test bed only)", () => {
  let token = "";
  let userId = "";
  let akunA = "";
  let akunB = "";
  let grnTerima = "";
  let grnTolak = "";
  let uomId = "";
  let barangId = "";
  let opnameIds: string[] = [];

  beforeEach(async () => {
    userId = "";
    akunA = "";
    akunB = "";
    grnTerima = "";
    grnTolak = "";
    uomId = "";
    barangId = "";
    opnameIds = [];
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-sapuan-lama-${token}@test.local`, name: "Uji sapuan" } })).id;
    akunA = (await prisma.chartAccount.create({ data: { code: `9${token}71`, name: "Persediaan uji sapuan", type: "ASET", depth: 1 } })).id;
    akunB = (await prisma.chartAccount.create({ data: { code: `9${token}72`, name: "Hutang uji sapuan", type: "LIABILITAS", depth: 1 } })).id;
  });

  afterEach(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    if (jurnal.length) {
      const ids = jurnal.map((j) => j.id);
      await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
      await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    }
    const grn = [grnTerima, grnTolak].filter(Boolean);
    if (grn.length) await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grn) } } });
    if (opnameIds.length) {
      await prisma.stockLedgerEntry.deleteMany({ where: { refId: { in: seededIds(opnameIds) } } });
      await prisma.stockMovement.deleteMany({ where: { refId: { in: seededIds(opnameIds) } } });
      await prisma.stockOpname.deleteMany({ where: { id: { in: seededIds(opnameIds) } } });
    }
    if (barangId) await prisma.item.delete({ where: { id: seededId(barangId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    const periode = await prisma.accountingPeriod.findMany({ where: { year: TAHUN, month: 3 }, select: { id: true } });
    if (periode.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(periode.map((p) => p.id)) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(akunA), seededId(akunB)] } } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  });

  it("semua sumber lama terdaftar, dan SQL pencarinya sah (rentang kosong → tidak ada dokumen)", async () => {
    const terdaftar = semuaSumberSapuan().map((s) => s.sourceType);
    for (const t of SUMBER_LAMA) expect(terdaftar).toContain(t);
    for (const s of semuaSumberSapuan().filter((x) => SUMBER_LAMA.includes(x.sourceType))) {
      const hasil = await s.cariTanpaJurnal({ sejak: rentang.sejak, sampai: new Date(Date.UTC(TAHUN, 0, 2)), batas: 5 });
      expect(Array.isArray(hasil), s.sourceType).toBe(true);
    }
  });

  it("GRN: yang diterima tanpa jurnal ditemukan; yang ditolak pemilik tidak — sampai jurnal penerimaannya ada, lalu ia jadi tanpa jurnal pembatalan", async () => {
    const pemasok = await prisma.supplier.findFirst({ select: { id: true } });
    if (!pemasok) return; // basis data tanpa pemasok: SQL sudah diuji di tes pertama
    const tgl = new Date(Date.UTC(TAHUN, 2, 10, 3));
    grnTerima = (
      await prisma.gRN.create({
        data: { docNumber: `UJISAPUAN-${token}-A`, supplierId: pemasok.id, receivedBy: "uji", totalAmount: 1000, items: [], grnDate: tgl },
      })
    ).id;
    grnTolak = (
      await prisma.gRN.create({
        data: {
          docNumber: `UJISAPUAN-${token}-B`,
          supplierId: pemasok.id,
          receivedBy: "uji",
          totalAmount: 2000,
          items: [],
          grnDate: tgl,
          ownerDeclinedAt: new Date(Date.UTC(TAHUN, 2, 12, 3)),
        },
      })
    ).id;

    const cari = (jenis: string) =>
      semuaSumberSapuan()
        .find((s) => s.sourceType === jenis)!
        .cariTanpaJurnal({ ...rentang, batas: 50 })
        .then((r) => r.map((x) => x.id).filter((id) => id === grnTerima || id === grnTolak));

    expect(await cari("GRN")).toEqual([grnTerima]);
    expect(await cari("GRN_REVERSAL")).toEqual([]);

    await postJournal(prisma, {
      date: tgl,
      description: "uji",
      postedById: userId,
      source: { type: "GRN", id: grnTolak },
      lines: [
        { chartAccountId: akunA, debit: 2000, credit: 0 },
        { chartAccountId: akunB, debit: 0, credit: 2000 },
      ],
    });
    expect(await cari("GRN_REVERSAL")).toEqual([grnTolak]);

    const hasil = await semuaSumberSapuan().find((s) => s.sourceType === "GRN")!.cariTanpaJurnal({ ...rentang, batas: 50 });
    const baris = hasil.find((x) => x.id === grnTerima);
    expect(baris?.label).toBe(`UJISAPUAN-${token}-A`);
    expect(baris?.tanggal.toISOString()).toBe(tgl.toISOString());
  });

  it("OPNAME: membaca buku besar stok seperti `opnameNetDelta` — selisih bernilai dan baris tanpa nilai ditemukan, arsip StockMovement tidak", async () => {
    uomId = (await prisma.uOM.create({ data: { code: `S${token}`.slice(0, 10), nameId: "Meter", nameEn: "Meter" } })).id;
    barangId = (
      await prisma.item.create({ data: { sku: `UJISAPUAN-${token}-KN`, nameId: "Kain uji sapuan", nameEn: "Fabric", type: "FABRIC", uomId } })
    ).id;
    const tgl = new Date(Date.UTC(TAHUN, 4, 10, 3));
    const opname = async (akhiran: string) => {
      const id = (
        await prisma.stockOpname.create({
          data: {
            docNumber: `UJISAPUAN-${token}-OPN-${akhiran}`,
            scope: "FABRIC",
            status: "APPROVED",
            snapshotAt: tgl,
            createdById: userId,
            approvedById: userId,
            approvedAt: tgl,
          },
        })
      ).id;
      opnameIds.push(id);
      return id;
    };
    const buku = (refId: string, qty: number, totalCost: number | null) =>
      prisma.stockLedgerEntry.create({
        data: {
          locationType: "MAIN",
          itemId: barangId,
          type: "ADJUSTMENT",
          qty,
          balanceQty: 0,
          totalCost,
          refType: "StockOpname",
          refId,
        },
      });

    const bernilai = await opname("A");
    await buku(bernilai, -2, -20_000);
    const nolBersih = await opname("B");
    await buku(nolBersih, 3, 30_000);
    await buku(nolBersih, -3, -30_000);
    const tanpaNilai = await opname("C");
    await buku(tanpaNilai, 1, null);
    const hanyaArsip = await opname("D");
    await prisma.stockMovement.create({
      data: {
        itemId: barangId,
        type: "ADJUSTMENT",
        refType: "OPNAME",
        refId: hanyaArsip,
        refDocNumber: `UJISAPUAN-${token}-OPN-D`,
        qty: -1,
        unitCost: 10_000,
        totalCost: -10_000,
        balanceQty: 0,
        balanceValue: 0,
      },
    });

    const temu = (
      await semuaSumberSapuan()
        .find((s) => s.sourceType === "OPNAME")!
        .cariTanpaJurnal({ ...rentang, batas: 50, ids: opnameIds })
    ).map((x) => x.id);
    expect(temu.sort()).toEqual([bernilai, tanpaNilai].sort());
  });
});
