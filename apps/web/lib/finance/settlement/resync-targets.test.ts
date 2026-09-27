import { describe, it, expect } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { collectResyncTargets } from "./resync-targets";

// Test-bed only — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("collectResyncTargets (test bed only)", () => {
  it("targets unmatched lines and escrow-missing matched lines, deduped, excludes the rest", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);

    const orderNoUnmatched = `UNM-${suffix}`;
    const orderNoMatchedEscrow = `ESC-${suffix}`;
    const orderNoMatchedNoEscrow = `NOE-${suffix}`;
    const orderNoMatchedNoEscrowCancelled = `CAN-${suffix}`;
    const orderNoMatchedNoEscrowUnpaid = `UNP-${suffix}`;

    const baseSalesorderId = Math.floor(Math.random() * 1_000_000_000);

    let settlementId = "";
    let orderEscrowId = "";
    let orderNoEscrowId = "";
    let orderCancelledId = "";
    let orderUnpaidId = "";

    try {
      const orderEscrow = await prisma.salesOrder.create({
        data: {
          salesorderId: baseSalesorderId,
          salesorderNo: `SP-${orderNoMatchedEscrow}`,
          channel: "SHOPEE",
          sourceName: "test",
          status: "COMPLETED",
          subTotal: 5000,
          totalDisc: 0,
          totalTax: 0,
          shippingCost: 0,
          grandTotal: 5000,
          transactionDate: new Date(),
          feeBreakdown: { escrow_amount: "5000" },
        },
        select: { id: true },
      });
      orderEscrowId = orderEscrow.id;

      const orderNoEscrow = await prisma.salesOrder.create({
        data: {
          salesorderId: baseSalesorderId + 1,
          salesorderNo: `SP-${orderNoMatchedNoEscrow}`,
          channel: "SHOPEE",
          sourceName: "test",
          status: "COMPLETED",
          subTotal: 2000,
          totalDisc: 0,
          totalTax: 0,
          shippingCost: 0,
          grandTotal: 2000,
          transactionDate: new Date(),
          feeBreakdown: undefined,
        },
        select: { id: true },
      });
      orderNoEscrowId = orderNoEscrow.id;

      const orderCancelled = await prisma.salesOrder.create({
        data: {
          salesorderId: baseSalesorderId + 2,
          salesorderNo: `SP-${orderNoMatchedNoEscrowCancelled}`,
          channel: "SHOPEE",
          sourceName: "test",
          status: "CANCELLED",
          subTotal: 0,
          totalDisc: 0,
          totalTax: 0,
          shippingCost: 0,
          grandTotal: 0,
          transactionDate: new Date(),
          feeBreakdown: undefined,
        },
        select: { id: true },
      });
      orderCancelledId = orderCancelled.id;

      const orderUnpaid = await prisma.salesOrder.create({
        data: {
          salesorderId: baseSalesorderId + 3,
          salesorderNo: `SP-${orderNoMatchedNoEscrowUnpaid}`,
          channel: "SHOPEE",
          sourceName: "test",
          status: "COMPLETED",
          subTotal: 0,
          totalDisc: 0,
          totalTax: 0,
          shippingCost: 0,
          grandTotal: 0,
          transactionDate: new Date(),
          feeBreakdown: undefined,
        },
        select: { id: true },
      });
      orderUnpaidId = orderUnpaid.id;

      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "MATCHED",
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
                // unmatched — no SalesOrder, UNMATCHED → included
                orderNo: orderNoUnmatched,
                netIncome: 1000,
                hargaAsliProduk: 1000,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoUnmatched },
              },
              {
                // duplicateUnmatched — a second UNMATCHED line with the same orderNo → appears once
                orderNo: orderNoUnmatched,
                netIncome: 500,
                hargaAsliProduk: 500,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoUnmatched },
              },
              {
                // matchedEscrow — MATCHED, order carries escrow_amount "5000" → excluded
                orderNo: orderNoMatchedEscrow,
                netIncome: 5000,
                hargaAsliProduk: 5000,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoMatchedEscrow },
                matchStatus: "MATCHED",
                matchedSalesOrderId: orderEscrowId,
              },
              {
                // matchedNoEscrow — MATCHED to a COMPLETED order with no feeBreakdown, paid → included
                orderNo: orderNoMatchedNoEscrow,
                netIncome: 2000,
                hargaAsliProduk: 2000,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoMatchedNoEscrow },
                matchStatus: "MATCHED",
                matchedSalesOrderId: orderNoEscrowId,
              },
              {
                // matchedNoEscrowCancelled — MATCHED to a CANCELLED order, no feeBreakdown → excluded
                orderNo: orderNoMatchedNoEscrowCancelled,
                netIncome: 0,
                hargaAsliProduk: 0,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoMatchedNoEscrowCancelled },
                matchStatus: "MATCHED",
                matchedSalesOrderId: orderCancelledId,
              },
              {
                // matchedNoEscrowUnpaid — MATCHED, no feeBreakdown, netIncome 0 (unpaid) → excluded
                orderNo: orderNoMatchedNoEscrowUnpaid,
                netIncome: 0,
                hargaAsliProduk: 0,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNoMatchedNoEscrowUnpaid },
                matchStatus: "MATCHED",
                matchedSalesOrderId: orderUnpaidId,
              },
            ],
          },
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      const targets = await collectResyncTargets(settlementId);
      expect([...targets].sort()).toEqual(
        [`SP-${orderNoUnmatched}`, `SP-${orderNoMatchedNoEscrow}`].sort(),
      );
    } finally {
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
      await prisma.salesOrder.deleteMany({
        where: {
          id: {
            in: [
              seededId(orderEscrowId),
              seededId(orderNoEscrowId),
              seededId(orderCancelledId),
              seededId(orderUnpaidId),
            ],
          },
        },
      });
    }
  });
});
