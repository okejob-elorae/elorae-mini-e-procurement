import { describe, it, expect } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { matchSettlement } from "./match";
import { lockSettlementRow } from "./lock";

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
    const orderNoD = `DDD-${suffix}`;
    const salesorderIdA = Math.floor(Math.random() * 1_000_000_000);
    const salesorderIdB = salesorderIdA + 1;
    const salesorderIdD1 = salesorderIdA + 2;
    const salesorderIdD2 = salesorderIdA + 3;
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
            {
              orderNo: orderNoD,
              netIncome: 1000,
              hargaAsliProduk: 1200,
              totalDiskonProduk: 0,
              biayaAdministrasi: -100,
              biayaLayanan: -60,
              biayaKomisiAms: -20,
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

    // Order D: TWO SalesOrders share the same salesorderNo (duplicate order number,
    // e.g. a return) — line D must be flagged ambiguous, never guess a cogs/profit.
    const orderD1 = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdD1,
        salesorderNo: `SP-${orderNoD}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 1000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 1000,
        transactionDate: new Date(),
      },
    });
    const orderD2 = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdD2,
        salesorderNo: `SP-${orderNoD}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 1000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 1000,
        transactionDate: new Date(),
      },
    });

    try {
      const res = await matchSettlement(settlement.id);
      expect(res).toMatchObject({ matched: 3, unmatched: 1, profitPending: 2 });

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

      const d = await prisma.settlementLine.findFirst({ where: { settlementId: settlement.id, orderNo: orderNoD } });
      expect(d!.matchStatus).toBe("MATCHED");
      expect(d!.matchedSalesOrderId).not.toBeNull();
      expect(d!.cogsSnapshot).toBeNull();
      expect(d!.profit).toBeNull(); // ambiguous — never guessed

      const s = await prisma.settlement.findUnique({ where: { id: settlement.id } });
      expect(s!.status).toBe("MATCHED");
    } finally {
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: [orderA.id, orderB.id] } } });
      await prisma.salesOrder.deleteMany({
        where: { id: { in: [orderA.id, orderB.id, orderD1.id, orderD2.id] } },
      });
      await prisma.settlement.delete({ where: { id: settlement.id } }); // cascades to lines
    }
  });

  it("matches a TikTok settlement line on channelOrderNo (not salesorderNo)", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });

    const suffix = Math.random().toString(36).slice(2, 10);
    const tiktokOrderNo = `58477178814283${suffix}`;
    const salesorderId = Math.floor(Math.random() * 1_000_000_000);
    const detailId = salesorderId + 100;

    const settlement = await prisma.settlement.create({
      data: {
        marketplace: "TIKTOK",
        seller: "TikTok Shop",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t-tiktok.xlsx",
        uploadedById: admin.id,
        status: "PARSED",
        totalPendapatan: 10000,
        totalPengeluaran: 4000,
        totalDilepas: 6000,
        parsedNetTotal: 6000,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        lines: {
          create: [
            {
              orderNo: tiktokOrderNo,
              netIncome: 6000,
              hargaAsliProduk: 0,
              totalDiskonProduk: 0,
              biayaAdministrasi: 0,
              biayaLayanan: 0,
              biayaKomisiAms: 0,
              biayaProsesPesanan: 0,
              raw: {},
            },
          ],
        },
      },
      select: { id: true },
    });

    // salesorderNo deliberately does NOT contain the TikTok order id — only
    // channelOrderNo does. A match here proves the lookup column switched.
    const order = await prisma.salesOrder.create({
      data: {
        salesorderId,
        salesorderNo: `JUB-${suffix}`,
        channelOrderNo: tiktokOrderNo,
        channel: "TIKTOK",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 6000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 6000,
        transactionDate: new Date(),
      },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: order.id,
        salesorderDetailId: detailId,
        jubelioItemId: detailId,
        jubelioItemCode: "TEST-SKU-TT",
        productName: "test tiktok product",
        qty: 1,
        qtyInBase: 1,
        unitPrice: 4500,
        pricePaid: 4500,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 4500,
        cogs: 4500,
      },
    });

    try {
      const res = await matchSettlement(settlement.id);
      expect(res).toMatchObject({ matched: 1, unmatched: 0, profitPending: 0 });

      const line = await prisma.settlementLine.findFirstOrThrow({
        where: { settlementId: settlement.id, orderNo: tiktokOrderNo },
      });
      expect(line.matchStatus).toBe("MATCHED");
      expect(line.matchedSalesOrderId).toBe(order.id);
      expect(Number(line.cogsSnapshot)).toBe(4500);
      expect(Number(line.profit)).toBe(Number(line.netIncome) - 4500);
    } finally {
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
      await prisma.salesOrder.delete({ where: { id: order.id } });
      await prisma.settlement.delete({ where: { id: settlement.id } }); // cascades to lines
    }
  });

  /*
   * Seeds a Shopee settlement with one line carrying recorded figures, plus a SalesOrder that WOULD
   * match it with a different cost — so any rewrite of the line is visible, not a no-op that happens
   * to write the same values back.
   */
  async function seedSettlementWithMatchableOrder(status: string) {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const orderNo = `REC-${suffix}`;
    /* Negative, so a fixture can never collide with a real Jubelio id on the shared bed. */
    const salesorderId = -Math.floor(Math.random() * 1_000_000_000) - 1;
    const settlement = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: "elorae.official",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t-reconciled.xlsx",
        uploadedById: admin.id,
        status,
        totalPendapatan: 5000,
        totalPengeluaran: 0,
        totalDilepas: 5000,
        parsedNetTotal: 5000,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        lines: {
          create: [
            {
              orderNo,
              netIncome: 5000,
              hargaAsliProduk: 5000,
              totalDiskonProduk: 0,
              biayaAdministrasi: 0,
              biayaLayanan: 0,
              biayaKomisiAms: 0,
              biayaProsesPesanan: 0,
              raw: {},
              matchStatus: "MATCHED",
              matchedSalesOrderId: null,
              cogsSnapshot: 1200,
              profit: 3800,
            },
          ],
        },
      },
      select: { id: true },
    });
    const order = await prisma.salesOrder.create({
      data: {
        salesorderId,
        salesorderNo: `SP-${orderNo}`,
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
      select: { id: true },
    });
    await prisma.salesOrderItem.create({
      data: {
        salesOrderId: order.id,
        salesorderDetailId: salesorderId,
        jubelioItemId: salesorderId,
        jubelioItemCode: "TEST-SKU-REC",
        productName: "test reconciled product",
        qty: 1,
        qtyInBase: 1,
        unitPrice: 2000,
        pricePaid: 2000,
        discAmount: 0,
        taxAmount: 0,
        lineTotal: 2000,
        cogs: 2000,
      },
    });
    return { settlementId: settlement.id, orderId: order.id };
  }

  async function lineFigures(settlementId: string) {
    const rows = await prisma.settlementLine.findMany({
      where: { settlementId },
      select: { id: true, matchStatus: true, matchedSalesOrderId: true, cogsSnapshot: true, profit: true },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => ({
      ...r,
      cogsSnapshot: r.cogsSnapshot === null ? null : r.cogsSnapshot.toString(),
      profit: r.profit === null ? null : r.profit.toString(),
    }));
  }

  async function teardown(settlementId: string, orderId: string) {
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: seededId(orderId) } });
    await prisma.salesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
    await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
  }

  it("refuses a RECONCILED settlement: no line is rewritten and the status stays RECONCILED", async () => {
    let settlementId = "";
    let orderId = "";
    try {
      ({ settlementId, orderId } = await seedSettlementWithMatchableOrder("RECONCILED"));
      const before = await lineFigures(settlementId);

      const res = await matchSettlement(settlementId);
      expect(res).toEqual({ matched: 0, unmatched: 0, profitPending: 0, refused: "RECONCILED" });

      expect(await lineFigures(settlementId)).toEqual(before);
      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.status).toBe("RECONCILED");
    } finally {
      await teardown(settlementId, orderId);
    }
  });

  it("waits on a held settlement row lock and refuses once the holder commits RECONCILED", async () => {
    let settlementId = "";
    let orderId = "";
    try {
      ({ settlementId, orderId } = await seedSettlementWithMatchableOrder("MATCHED"));
      const before = await lineFigures(settlementId);

      /*
       * Stands in for `postSettlementJournal`: takes the same row lock first, then flips the status
       * and commits only when released. The match starts while the lock is held, so its own locking
       * read has to wait and then decide on the committed RECONCILED.
       */
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await lockSettlementRow(tx, settlementId);
          signalLocked();
          await released;
          await tx.settlement.update({ where: { id: settlementId }, data: { status: "RECONCILED" } });
        },
        { timeout: 30_000 },
      );
      await Promise.race([locked, holder]);

      const matching = matchSettlement(settlementId);
      /* Observed later; this only keeps an early rejection from surfacing as unhandled meanwhile. */
      matching.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      release();
      await holder;

      const res = await matching;
      expect(res.refused).toBe("RECONCILED");
      expect(await lineFigures(settlementId)).toEqual(before);
      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.status).toBe("RECONCILED");
    } finally {
      await teardown(settlementId, orderId);
    }
  }, 60_000);
});
