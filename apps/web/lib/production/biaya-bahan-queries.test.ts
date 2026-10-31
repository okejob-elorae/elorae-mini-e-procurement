import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { nilaiBahanDiProduksi, selisihNilaiPengeluaranBahan } from "./biaya-bahan-queries";

/*
 * Rekonsiliasi buku besar bahan ↔ kartu stok: bahan yang masih di produksi
 * (keluar dari kartu stok, belum dikredit dari buku besar) dan pengeluaran
 * LAMA yang nilainya bukan nilai kartu stok. Data sendiri, dibatasi `woIds`.
 * Nilai kartu stok dibaca dari buku besar stok; arsip `StockMovement` hanya
 * untuk pengeluaran yang buku besarnya tidak punya nilai.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("nilai bahan produksi (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let bahanId = "";
  let woId = "";
  let woSelesaiId = "";
  let issueLamaId = "";
  let issueBaruId = "";
  let issueArsipId = "";
  let issueCampurId = "";
  let issueTakTercatatId = "";
  let issueBukuMenangId = "";

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    bahanId = "";
    woId = "";
    woSelesaiId = "";
    issueLamaId = "";
    issueBaruId = "";
    issueArsipId = "";
    issueCampurId = "";
    issueTakTercatatId = "";
    issueBukuMenangId = "";
    userId = (await prisma.user.create({ data: { email: `bbq-${token}@uji.local`, name: "Uji bahan" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TBB-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-BB-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `Q${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({ data: { sku: `FG-BB-${token}`, nameId: "Kaos uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId }, select: { id: true } })
    ).id;
    bahanId = (
      await prisma.item.create({ data: { sku: `KC-BB-${token}`, nameId: "Kancing uji", nameEn: "Button", type: "ACCESSORIES", uomId }, select: { id: true } })
    ).id;
    const wo = (doc: string, status: "IN_PRODUCTION" | "COMPLETED") =>
      prisma.workOrder.create({
        data: { docNumber: doc, vendorId, finishedGoodId: fgId, plannedQty: 100, consumptionPlan: {}, createdById: userId, status },
        select: { id: true },
      });
    woId = (await wo(`WO-BB-${token}`, "IN_PRODUCTION")).id;
    woSelesaiId = (await wo(`WO-BB-${token}-S`, "COMPLETED")).id;

    // `buku` = baris buku besar stok (null = baris tanpa nilai), `arsip` = baris StockMovement lama.
    const keluar = async (
      doc: string,
      wo: string,
      totalCost: number,
      nilai: { buku?: number | null; arsip?: number },
      jam = 3,
    ) => {
      const i = await prisma.materialIssue.create({
        data: {
          docNumber: doc,
          woId: wo,
          issueType: "ACCESSORIES",
          items: [],
          totalCost,
          issuedById: userId,
          issuedAt: new Date(Date.UTC(2004, 6, 1, jam)),
        },
        select: { id: true },
      });
      if (nilai.buku !== undefined) {
        await prisma.stockLedgerEntry.create({
          data: {
            locationType: "MAIN",
            itemId: bahanId,
            type: "OUT",
            refType: "MaterialIssue",
            refId: i.id,
            refDocNumber: doc,
            qty: -10,
            balanceQty: 0,
            totalCost: nilai.buku,
            balanceValue: nilai.buku === null ? null : 0,
          },
        });
      }
      if (nilai.arsip !== undefined) {
        await prisma.stockMovement.create({
          data: {
            itemId: bahanId,
            type: "OUT",
            refType: "WO_ISSUE",
            refId: i.id,
            refDocNumber: doc,
            qty: -10,
            unitCost: nilai.arsip / 10,
            totalCost: nilai.arsip,
            balanceQty: 0,
            balanceValue: 0,
          },
        });
      }
      return i.id;
    };
    // Pengeluaran LAMA: dicatat 15.000 (harga ketik) padahal keluar dari stok 11.200.
    issueLamaId = await keluar(`MI-BB-${token}-1`, woId, 15_000, { buku: 11_200 });
    // Pengeluaran baru: nilai = kartu stok.
    issueBaruId = await keluar(`MI-BB-${token}-2`, woId, 5_000, { buku: 5_000 });
    await keluar(`MI-BB-${token}-3`, woSelesaiId, 7_000, { buku: 7_000 });
    // Sebelum buku besar stok: nilainya hanya di arsip.
    issueArsipId = await keluar(`MI-BB-${token}-4`, woSelesaiId, 9_000, { arsip: 8_000 }, 4);
    // Buku besar tanpa nilai (2026-09-15 … 09-21): arsip yang memegang nilainya.
    issueCampurId = await keluar(`MI-BB-${token}-5`, woSelesaiId, 4_500, { buku: null, arsip: 4_000 }, 5);
    // Tanpa nilai di mana pun: tidak bisa dibandingkan, bukan "keluar nol".
    issueTakTercatatId = await keluar(`MI-BB-${token}-6`, woSelesaiId, 3_000, { buku: null }, 6);
    // Tercatat di keduanya: buku besar yang dipakai, tidak dijumlahkan dengan arsip.
    issueBukuMenangId = await keluar(`MI-BB-${token}-7`, woSelesaiId, 2_000, { buku: 2_000, arsip: 1_500 }, 7);
    await prisma.fGReceipt.create({
      data: {
        docNumber: `RCPT-BB-${token}-1`,
        woId,
        receiptType: "GENERIC",
        qtyReceived: 30,
        qtyAccepted: 30,
        materialCost: 6_000,
        serviceCost: 450_000,
        additionalCost: 0,
        totalCostValue: 456_000,
        receivedById: userId,
      },
    });
  });

  afterAll(async () => {
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds([woId, woSelesaiId]) } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(bahanId) } });
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(bahanId) } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds([woId, woSelesaiId]) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds([woId, woSelesaiId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([fgId, bahanId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("bahan di produksi = keluar − kembali − bagian BAHAN penerimaan (bukan totalCostValue); WO selesai tidak dihitung", async () => {
    const hasil = await nilaiBahanDiProduksi({ woIds: [woId, woSelesaiId] });
    expect(hasil.perWo).toEqual([
      { woId, docNumber: `WO-BB-${token}`, status: "IN_PRODUCTION", keluar: 20_000, kembali: 0, dibebankan: 6_000, diProduksi: 14_000 },
    ]);
    expect(hasil.total).toBe(14_000);
  });

  it("hanya pengeluaran yang nilainya menyimpang dari kartu stok yang dilaporkan", async () => {
    const selisih = await selisihNilaiPengeluaranBahan({ woIds: [woId, woSelesaiId] });
    expect(selisih.map((s) => [s.issueId, s.tercatat, s.keluarStok, s.selisih])).toEqual([
      [issueLamaId, 15_000, 11_200, 3_800],
      [issueArsipId, 9_000, 8_000, 1_000],
      [issueCampurId, 4_500, 4_000, 500],
    ]);
    expect(selisih.map((s) => s.issueId)).not.toContain(issueBaruId);
  });

  it("nilai yang tidak tercatat di mana pun dilewati; buku besar tidak dijumlahkan dengan arsip", async () => {
    const ids = (await selisihNilaiPengeluaranBahan({ woIds: [woSelesaiId] })).map((s) => s.issueId);
    expect(ids).not.toContain(issueTakTercatatId);
    expect(ids).not.toContain(issueBukuMenangId);
  });
});
