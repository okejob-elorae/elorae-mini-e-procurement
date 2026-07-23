import { describe, it, expect } from "vitest";
import { prisma } from "@elorae/db";
import { matchSettlement } from "./match";

// Test-bed only — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("matchSettlement (test bed only)", () => {
  it("matches orders, computes profit when cogs is known, flags pending when cogs is missing, and leaves unmatched lines alone", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });

    // Random suffix so parallel spec runs can't collide on salesorderNo/salesorderId.
    const suffix = Math.random().toString(36).slice(2, 10);
    const orderNoA = `AAA-${suffix}`;
    const orderNoB = `BBB-${suffix}`;
    const orderNoC = `CCC-${suffix}`;
    const salesorderIdA = Math.floor(Math.random() * 1_000_000_000);
    const salesorderIdB = salesorderIdA + 1;
    const detailIdA = salesorderIdA + 100;
    const detailIdB = salesorderIdA + 101;

    const settlement = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: "elorae.official",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t.xlsx",
        uploadedById: admin.id,
        status: "PARSED",
        totalPendapatan: 100000,
        totalPengeluaran: 40000,
        totalDilepas: 60000,
        parsedNetTotal: 60000,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        lines: {
          create: [
            {
              orderNo: orderNoA,
              netIncome: 5000,
              hargaAsliProduk: 7000,
              totalDiskonProduk: 0,
              biayaAdministrasi: -1000,
              biayaLayanan: -500,
              biayaKomisiAms: -300,
              biayaProsesPesanan: -200,
              raw: {},
            },
            {
              orderNo: orderNoB,
              netIncome: 3000,
              hargaAsliProduk: 4000,
              totalDiskonProduk: 0,
              biayaAdministrasi: -500,
              biayaLayanan: -300,
              biayaKomisiAms: -150,
              biayaProsesPesanan: -50,
              raw: {},
            },
            {
              orderNo: orderNoC,
              netIncome: 2000,
              hargaAsliProduk: 2500,
              totalDiskonProduk: 0,
              biayaAdministrasi: -300,
              biayaLayanan: -150,
              biayaKomisiAms: -30,
              biayaProsesPesanan: -20,
              raw: {},
            },
          ],
        },
      },
      select: { id: true },
    });

    // Order A: matches, cogs known (1000 x 2 = 2000) → profit = netIncome - cogsSnapshot.
    const orderA = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdA,
        salesorderNo: `SP-${orderNoA}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 5000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 5000,
        transactionDate: new Date(),
      },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: orderA.id,
        salesorderDetailId: detailIdA,
        jubelioItemId: detailIdA,
        jubelioItemCode: "TEST-SKU-A",
        productName: "test product A",
        qty: 2,
        qtyInBase: 2,
        unitPrice: 1000,
        pricePaid: 1000,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 2000,
        cogs: 2000,
      },
    });

    // Order B: matches, but cogs is null → cost pending, no profit yet.
    const orderB = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdB,
        salesorderNo: `SP-${orderNoB}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 3000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 3000,
        transactionDate: new Date(),
      },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: orderB.id,
        salesorderDetailId: detailIdB,
        jubelioItemId: detailIdB,
        jubelioItemCode: "TEST-SKU-B",
        productName: "test product B",
        qty: 1,
        qtyInBase: 1,
        unitPrice: 3000,
        pricePaid: 3000,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 3000,
        cogs: null,
      },
    });

    // Order C: no matching SalesOrder is seeded at all — line C stays unmatched.

    try {
      const res = await matchSettlement(settlement.id);
      expect(res).toMatchObject({ matched: 2, unmatched: 1, profitPending: 1 });

      const a = await prisma.settlementLine.findFirst({ where: { settlementId: settlement.id, orderNo: orderNoA } });
      expect(a!.matchStatus).toBe("MATCHED");
      expect(a!.matchedSalesOrderId).toBe(orderA.id);
      expect(Number(a!.cogsSnapshot)).toBe(2000);
      expect(Number(a!.profit)).toBe(Number(a!.netIncome) - 2000);

      const b = await prisma.settlementLine.findFirst({ where: { settlementId: settlement.id, orderNo: orderNoB } });
      expect(b!.matchStatus).toBe("MATCHED");
      expect(b!.matchedSalesOrderId).toBe(orderB.id);
      expect(b!.cogsSnapshot).toBeNull();
      expect(b!.profit).toBeNull(); // cost pending

      const c = await prisma.settlementLine.findFirst({ where: { settlementId: settlement.id, orderNo: orderNoC } });
      expect(c!.matchStatus).toBe("UNMATCHED");
      expect(c!.matchedSalesOrderId).toBeNull();
      expect(c!.cogsSnapshot).toBeNull();
      expect(c!.profit).toBeNull();

      const s = await prisma.settlement.findUnique({ where: { id: settlement.id } });
      expect(s!.status).toBe("MATCHED");
    } finally {
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: [orderA.id, orderB.id] } } });
      await prisma.salesOrder.deleteMany({ where: { id: { in: [orderA.id, orderB.id] } } });
      await prisma.settlement.delete({ where: { id: settlement.id } }); // cascades to lines
    }
  });
});
