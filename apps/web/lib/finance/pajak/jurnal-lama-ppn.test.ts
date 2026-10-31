import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * Jurnal LAMA dalam mode PKP: penjualan & HPP marketplace, retur (mengikuti
 * penjualan asalnya), penerimaan barang ber-PPN masukan, penjualan kanvas,
 * settlement (PPN biaya + PPh 22), dan sampel KOL (PPN pemberian cuma-cuma).
 *
 * Basis data bersama TIDAK disentuh pengaturannya: status PKP dipalsukan lewat
 * `bacaPengaturanPpn`, dan pemetaan peran → akun dipalsukan lewat
 * `resolveAccount` ke akun uji milik berkas ini (peran baru belum terpetakan di
 * basis data lokal, dan pemetaan bersama tidak boleh diubah). Mode bawaan
 * (BELUM_DITETAPKAN) tetap diuji oleh tes lama tiap penulis.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));

vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({
  bacaPengaturanPpn: vi.fn(async () => ({
    statusPkp: "PKP",
    tarifPersen: 12,
    pakaiDppNilaiLain: true,
    hargaJualTermasukPpn: true,
    berlakuSejak: null,
  })),
}));

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

const { postSalesRevenueJournal, postSalesCogsJournal } = await import("@/lib/finance/sales/sales-journal");
const { postSalesReturnRevenueJournal } = await import("@/lib/finance/sales/sales-return-journal");
const { postGrnJournal, postGrnReversalJournal } = await import("@/lib/inventory/grn-journal");
const { postVanSaleJournal } = await import("@/lib/canvassing/van-journal");
const { postSettlementJournal } = await import("@/lib/finance/settlement/journal");
const { postJurnalSampelKol } = await import("@/lib/creative/jurnal-kol");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const PERAN: [string, AccountType][] = [
  ["AR", "ASET"],
  ["CASH", "ASET"],
  ["BANK", "ASET"],
  ["INVENTORY", "ASET"],
  ["INVENTORY_FG", "ASET"],
  ["INVENTORY_VAN", "ASET"],
  ["PPN_MASUKAN", "ASET"],
  ["PPH22_PREPAID", "ASET"],
  ["AP", "LIABILITAS"],
  ["PPN_KELUARAN", "LIABILITAS"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["COGS", "HPP"],
  ["MARKETPLACE_FEE", "BEBAN"],
  ["KOL_EXPENSE", "BEBAN"],
];

const token = Math.floor(Math.random() * 1e7);
const tag = `PPNL${token}`;
let userId = "";
let uomId = "";
let fgId = "";
let supplierTypeId = "";
let supplierId = "";
let kolId = "";
const akunIds: string[] = [];
const orderIds: string[] = [];
const returnIds: string[] = [];
const grnIds: string[] = [];
const vanSaleIds: string[] = [];
const settlementIds: string[] = [];
const kolabIds: string[] = [];
const pengirimanIds: string[] = [];
const jurnalManualIds: string[] = [];

type Baris = { peran: string; debit: number; credit: number; memo: string | null; channel: string | null; storeId: string | null };

async function barisJurnal(sourceType: string, sourceId: string): Promise<Baris[]> {
  const j = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true, storeId: true } } },
  });
  const peranDari = new Map([...peta.akun.entries()].map(([r, id]) => [id, r]));
  return (j?.lines ?? [])
    .map((l) => ({
      peran: peranDari.get(l.chartAccountId) ?? l.chartAccountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      memo: l.memo,
      channel: l.channel,
      storeId: l.storeId,
    }))
    .sort((a, b) => `${a.peran}${a.debit}${a.credit}`.localeCompare(`${b.peran}${b.debit}${b.credit}`));
}

const seimbang = (b: Baris[]) => Math.round(b.reduce((s, x) => s + x.debit - x.credit, 0) * 100);

d("jurnal lama dalam mode PKP (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@test.local`, name: "Uji PPN" }, select: { id: true } })).id;
    for (const [i, [peran, tipe]] of PERAN.entries()) {
      const a = await prisma.chartAccount.create({
        data: { code: `9${token}${String(i).padStart(2, "0")}`, name: `${peran} (uji PPN)`, type: tipe, depth: 1, isActive: true },
        select: { id: true },
      });
      akunIds.push(a.id);
      peta.akun.set(peran, a.id);
    }
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `${tag}-FG`, nameId: "Kaos uji PPN", nameEn: "Test tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 111_000 },
        select: { id: true },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    const jurnal = await prisma.journal.findMany({
      where: {
        OR: [
          { postedById: seededId(userId) },
          { id: { in: seededIds(jurnalManualIds) } },
        ],
      },
      select: { id: true },
    });
    const ids = jurnal.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.kolShipmentLine.deleteMany({ where: { shipmentId: { in: seededIds(pengirimanIds) } } });
    await prisma.kolShipment.deleteMany({ where: { id: { in: seededIds(pengirimanIds) } } });
    await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
    if (kolId) await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
    await prisma.settlement.deleteMany({ where: { id: { in: seededIds(settlementIds) } } });
    await prisma.vanSaleLine.deleteMany({ where: { vanSaleId: { in: seededIds(vanSaleIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanSaleIds) } } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    if (supplierId) await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    if (supplierTypeId) await prisma.supplierType.deleteMany({ where: { id: seededId(supplierTypeId) } });
    await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: { in: seededIds(returnIds) } } });
    await prisma.salesReturn.deleteMany({ where: { id: { in: seededIds(returnIds) } } });
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: seededIds(orderIds) } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    if (fgId) await prisma.item.deleteMany({ where: { id: seededId(fgId) } });
    if (uomId) await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  let seqSo = 0;
  async function pesanan(grandTotal: number, cogs: number) {
    seqSo += 1;
    const base = (token % 1_000_000) * 100 + seqSo;
    const so = await prisma.salesOrder.create({
      data: {
        salesorderId: base,
        salesorderNo: `SO-${tag}-${seqSo}`,
        channel: "TIKTOK",
        sourceName: "uji",
        status: "SHIPPED",
        subTotal: grandTotal,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal,
        transactionDate: new Date("2026-10-02T03:00:00Z"),
        shippedAt: new Date("2026-10-02T03:00:00Z"),
        items: {
          create: [
            {
              salesorderDetailId: base * 10,
              jubelioItemId: base * 10,
              jubelioItemCode: `${tag}-${seqSo}`,
              itemId: fgId,
              productName: "Kaos uji",
              qty: 1,
              qtyInBase: 1,
              unitPrice: grandTotal,
              pricePaid: grandTotal,
              discAmount: 0,
              taxAmount: 0,
              lineTotal: grandTotal,
              cogs,
            },
          ],
        },
      },
      select: { id: true, salesorderId: true },
    });
    orderIds.push(so.id);
    return so;
  }

  async function retur(salesOrderId: string, salesorderId: number, subtotal: number) {
    const r = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: salesorderId + 50_000_000,
        jubelioReturnNo: `RT-${tag}-${salesorderId}`,
        salesOrderId,
        channel: "TIKTOK",
        status: "ACCEPTED",
        totalQty: 1,
        totalValue: subtotal,
        receivedAt: new Date("2026-10-05T03:00:00Z"),
        decidedAt: new Date("2026-10-05T03:00:00Z"),
        rawIngestPayload: {},
        items: {
          create: [{ externalSku: `${tag}-RT`, productName: "Kaos uji", qty: 1, unitPrice: subtotal, subtotal, decision: "ACCEPTED", itemId: fgId }],
        },
      },
      select: { id: true },
    });
    returnIds.push(r.id);
    return r.id;
  }

  it("penjualan marketplace: pendapatan DPP + PPN keluaran, kanal di baris pendapatan/piutang/HPP", async () => {
    const so = await pesanan(111_000, 50_000);
    expect(await postSalesRevenueJournal(so.id, userId)).toMatchObject({ ok: true, created: true });
    const baris = await barisJurnal("SALESORDER_REVENUE", so.id);
    expect(baris).toEqual([
      { peran: "AR", debit: 111_000, credit: 0, memo: null, channel: "TIKTOK", storeId: null },
      { peran: "PPN_KELUARAN", debit: 0, credit: 11_000, memo: "DPP 100000.00", channel: null, storeId: null },
      { peran: "SALES_REVENUE", debit: 0, credit: 100_000, memo: null, channel: "TIKTOK", storeId: null },
    ]);
    expect(await postSalesCogsJournal(so.id, userId)).toMatchObject({ ok: true, created: true });
    const hpp = await barisJurnal("SALESORDER_COGS", so.id);
    expect(hpp.map((b) => [b.peran, b.debit, b.credit, b.channel])).toEqual([
      ["COGS", 50_000, 0, "TIKTOK"],
      ["INVENTORY_FG", 0, 50_000, "TIKTOK"],
    ]);

    // Retur sebagian: PPN keluaran ikut dibalik karena penjualan asalnya memungut PPN.
    const rid = await retur(so.id, so.salesorderId, 55_500);
    expect(await postSalesReturnRevenueJournal(rid, userId)).toMatchObject({ ok: true, created: true });
    const rb = await barisJurnal("SALESRETURN_REVENUE", rid);
    expect(rb).toEqual([
      { peran: "AR", debit: 0, credit: 55_500, memo: null, channel: "TIKTOK", storeId: null },
      { peran: "PPN_KELUARAN", debit: 5_500, credit: 0, memo: "DPP 50000.00", channel: null, storeId: null },
      { peran: "SALES_REVENUE", debit: 50_000, credit: 0, memo: null, channel: "TIKTOK", storeId: null },
    ]);
  });

  it("retur atas penjualan yang DULU tanpa PPN tidak memungut PPN walau sekarang PKP", async () => {
    const so = await pesanan(111_000, 0);
    // Jurnal penjualan asal ditulis seperti di masa non-PKP: tanpa baris PPN.
    const asal = await postJournal(prisma, {
      source: { type: "SALESORDER_REVENUE", id: so.id },
      date: new Date("2026-10-02T03:00:00Z"),
      description: "uji penjualan non-PKP",
      postedById: userId,
      lines: [
        { chartAccountId: peta.akun.get("AR")!, debit: 111_000, credit: 0 },
        { chartAccountId: peta.akun.get("SALES_REVENUE")!, debit: 0, credit: 111_000 },
      ],
    });
    jurnalManualIds.push(asal.journalId);
    const rid = await retur(so.id, so.salesorderId, 111_000);
    expect(await postSalesReturnRevenueJournal(rid, userId)).toMatchObject({ ok: true, created: true });
    expect((await barisJurnal("SALESRETURN_REVENUE", rid)).map((b) => [b.peran, b.debit, b.credit])).toEqual([
      ["AR", 0, 111_000],
      ["SALES_REVENUE", 111_000, 0],
    ]);
  });

  it("penerimaan barang: persediaan neto + PPN masukan, hutang bruto; pembatalan mencerminkan", async () => {
    supplierTypeId = (await prisma.supplierType.create({ data: { code: `T-${tag}`, name: `Tipe ${tag}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({ data: { code: `S-${tag}`, name: `Pemasok ${tag}`, typeId: supplierTypeId }, select: { id: true } })
    ).id;
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN/${tag}`,
        supplierId,
        receivedBy: userId,
        totalAmount: 150_000,
        ppnAmount: 11_000,
        grnDate: new Date("2026-10-03T03:00:00Z"),
        items: JSON.stringify([
          { itemId: fgId, itemType: "FINISHED_GOOD", qty: 1, unitCost: 100_000, totalCost: 100_000, ppnIncluded: false },
          { itemId: fgId, itemType: "FINISHED_GOOD", qty: 1, unitCost: 50_000, totalCost: 50_000 },
        ]),
      },
      select: { id: true },
    });
    grnIds.push(grn.id);
    expect(await postGrnJournal(grn.id, userId)).toMatchObject({ ok: true, created: true });
    const b = await barisJurnal("GRN", grn.id);
    expect(b.map((x) => [x.peran, x.debit, x.credit, x.memo])).toEqual([
      ["AP", 0, 161_000, null],
      ["INVENTORY_FG", 150_000, 0, null],
      ["PPN_MASUKAN", 11_000, 0, "DPP 100000.00"],
    ]);
    expect(await postGrnReversalJournal(grn.id, userId)).toMatchObject({ ok: true, created: true });
    const r = await barisJurnal("GRN_REVERSAL", grn.id);
    expect(r.map((x) => [x.peran, x.debit, x.credit])).toEqual([
      ["AP", 161_000, 0],
      ["INVENTORY_FG", 0, 150_000],
      ["PPN_MASUKAN", 0, 11_000],
    ]);
  });

  it("penjualan kanvas: kas bruto, pendapatan DPP, PPN keluaran, kanal KANVAS", async () => {
    const vs = await prisma.vanSale.create({
      data: {
        docNo: `VS/${tag}`,
        salesmanId: userId,
        subtotal: 222_000,
        total: 222_000,
        amountPaid: 222_000,
        changeAmount: 0,
        createdAt: new Date("2026-10-04T03:00:00Z"),
        lines: { create: [{ itemId: fgId, productName: "Kaos uji", qty: 2, unitPrice: 111_000, unitCost: 40_000, lineTotal: 222_000 }] },
      },
      select: { id: true },
    });
    vanSaleIds.push(vs.id);
    expect(await postVanSaleJournal(vs.id, userId)).toMatchObject({ ok: true, created: true });
    const b = await barisJurnal("VAN_SALE", vs.id);
    expect(b.map((x) => [x.peran, x.debit, x.credit, x.channel])).toEqual([
      ["CASH", 222_000, 0, "KANVAS"],
      ["COGS", 80_000, 0, "KANVAS"],
      ["INVENTORY_VAN", 0, 80_000, "KANVAS"],
      ["PPN_KELUARAN", 0, 22_000, null],
      ["SALES_REVENUE", 0, 200_000, "KANVAS"],
    ]);
    expect(seimbang(b)).toBe(0);
  });

  it("settlement: PPN biaya marketplace ke PPN masukan, PPh 22 ke pajak dibayar dimuka, kanal di baris", async () => {
    const s = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: `toko-${tag}`,
        periodFrom: new Date("2026-10-01T00:00:00+07:00"),
        periodTo: new Date("2026-10-07T00:00:00+07:00"),
        fileName: `${tag}.xlsx`,
        uploadedById: userId,
        status: "MATCHED",
        totalPendapatan: 100_000,
        totalPengeluaran: -2_000,
        totalDilepas: 98_000,
        parsedNetTotal: 98_000,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        lines: {
          create: [
            {
              orderNo: `${tag}-1`,
              netIncome: 98_000,
              hargaAsliProduk: 100_000,
              totalDiskonProduk: 0,
              biayaAdministrasi: -1_110,
              biayaLayanan: 0,
              biayaKomisiAms: 0,
              biayaProsesPesanan: 0,
              raw: { "No. Pesanan": `${tag}-1`, "PPh Pasal 22": -500 },
            },
          ],
        },
      },
      select: { id: true },
    });
    settlementIds.push(s.id);
    expect(await postSettlementJournal(s.id, userId)).toMatchObject({ ok: true, created: true });
    const b = await barisJurnal("SETTLEMENT", s.id);
    expect(b.map((x) => [x.peran, x.debit, x.credit, x.memo, x.channel])).toEqual([
      ["AR", 0, 100_000, null, "SHOPEE"],
      ["BANK", 98_000, 0, null, "SHOPEE"],
      ["MARKETPLACE_FEE", 1_000, 0, "MARKETPLACE_FEE_ADMIN", "SHOPEE"],
      ["MARKETPLACE_FEE", 390, 0, "MARKETPLACE_FEE_OTHER", "SHOPEE"],
      ["PPH22_PREPAID", 500, 0, "PPh Pasal 22", null],
      ["PPN_MASUKAN", 110, 0, "DPP 1000.00", null],
    ]);
    expect(seimbang(b)).toBe(0);
    const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: s.id } }, select: { description: true } });
    expect(j!.description).toMatch(/^Settlement Shopee toko-/);
  });

  it("sampel KOL: PPN keluaran pemberian cuma-cuma ditanggung Elorae, kanal KOL", async () => {
    kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
    const k = await prisma.kolBrief.create({ data: { docNo: `${tag}/1`, kolId, fee: 0, tahap: "DEAL", payStatus: "BELUM" }, select: { id: true } });
    kolabIds.push(k.id);
    const p = await prisma.kolShipment.create({
      data: {
        collabId: k.id,
        sentAt: new Date("2026-10-04T02:00:00Z"),
        stockIssuedAt: new Date("2026-10-04T02:00:00Z"),
        lines: { create: [{ itemId: fgId, itemName: "Kaos uji", qty: 2, unitCost: 60_000 }] },
      },
      select: { id: true },
    });
    pengirimanIds.push(p.id);
    expect(await postJurnalSampelKol(p.id, userId)).toMatchObject({ ok: true, diposting: 1 });
    const b = await barisJurnal("KOL_SAMPLE", p.id);
    expect(b.map((x) => [x.peran, x.debit, x.credit, x.memo, x.channel])).toEqual([
      ["INVENTORY_FG", 0, 120_000, "INVENTORY_FG", "KOL"],
      ["KOL_EXPENSE", 133_200, 0, "KOL_EXPENSE", "KOL"],
      ["PPN_KELUARAN", 0, 13_200, "DPP 120000.00", "KOL"],
    ]);
  });
});
