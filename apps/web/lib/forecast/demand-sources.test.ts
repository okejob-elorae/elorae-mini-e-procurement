import { describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  DEFAULT_PAYOUT_DELAY_DAYS,
  loadMarketplaceDemandInput,
  orderNumbersFor,
  parsePayoutDelayDays,
} from "./demand-sources";
import { buildMarketplaceDemand } from "./marketplace-demand";

describe("orderNumbersFor", () => {
  it("collects the ref number and the Shopee number behind SP-, once each", () => {
    expect(orderNumbersFor("SP-2606100001", "2606100001")).toEqual(["2606100001"]);
    expect(orderNumbersFor("TT-123-1", "576000111")).toEqual(["576000111"]);
    expect(orderNumbersFor("SP-2606100002", null)).toEqual(["2606100002"]);
    expect(orderNumbersFor("SO-1", "  ")).toEqual([]);
  });
});

describe("parsePayoutDelayDays", () => {
  it("falls back to the default for a missing, blank, fractional, negative or too-large value", () => {
    for (const v of [undefined, null, "", " ", "1.5", "-1", "121", "abc"]) {
      expect(parsePayoutDelayDays(v)).toBe(DEFAULT_PAYOUT_DELAY_DAYS);
    }
    expect(parsePayoutDelayDays("0")).toBe(0);
    expect(parsePayoutDelayDays("30")).toBe(30);
  });
});

// Test-bed only — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("loadMarketplaceDemandInput (test bed only)", () => {
  it("loads orders, item SKUs, summed settlement nets and ambiguous match keys for its window", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const tag = `FCST-${Math.random().toString(36).slice(2, 10)}`;
    const base = Math.floor(Math.random() * 1_000_000_000);
    // June 2031 holds no real dev rows, so everything the window loads is this spec's own.
    const wib = (day: number) => new Date(`2031-06-${String(day).padStart(2, "0")}T12:00:00+07:00`);

    let uomId = "";
    let itemId = "";
    let settlementId = "";
    const orderIds: string[] = [];

    const order = async (
      n: number,
      data: { channel: "SHOPEE" | "TOKOPEDIA"; salesorderNo: string; channelOrderNo: string; day: number; itemId: string | null }
    ) => {
      const o = await prisma.salesOrder.create({
        data: {
          salesorderId: base + n,
          salesorderNo: data.salesorderNo,
          channelOrderNo: data.channelOrderNo,
          channel: data.channel,
          sourceName: "test",
          status: "COMPLETED",
          subTotal: 2000,
          totalDisc: 0,
          totalTax: 0,
          shippingCost: 0,
          grandTotal: 2000,
          transactionDate: wib(data.day),
          items: {
            create: {
              salesorderDetailId: base + 100 + n,
              jubelioItemId: base + 100 + n,
              jubelioItemCode: `${tag}-V`,
              itemId: data.itemId,
              productName: "test product",
              qty: 2,
              qtyInBase: 2,
              unitPrice: 1000,
              pricePaid: 1000,
              discAmount: 0,
              taxAmount: 0,
              lineTotal: 2000,
            },
          },
        },
      });
      orderIds.push(o.id);
      return o;
    };

    try {
      const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
      uomId = uom.id;
      const item = await prisma.item.create({
        data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true },
      });
      itemId = item.id;

      const a = await order(1, { channel: "SHOPEE", salesorderNo: `SP-${tag}A`, channelOrderNo: `${tag}A`, day: 10, itemId });
      const d1 = await order(2, { channel: "SHOPEE", salesorderNo: `SP-${tag}D`, channelOrderNo: `${tag}D1`, day: 11, itemId });
      const d2 = await order(3, { channel: "SHOPEE", salesorderNo: `SP-${tag}D`, channelOrderNo: `${tag}D2`, day: 11, itemId });
      const t = await order(4, { channel: "TOKOPEDIA", salesorderNo: `TP-${tag}T`, channelOrderNo: `${tag}T`, day: 12, itemId: null });

      const line = (orderNo: string, netIncome: number, matchedSalesOrderId: string) => ({
        orderNo, netIncome, matchStatus: "MATCHED", matchedSalesOrderId,
        hargaAsliProduk: 0, totalDiskonProduk: 0, biayaAdministrasi: 0, biayaLayanan: 0,
        biayaKomisiAms: 0, biayaProsesPesanan: 0, raw: {},
      });
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "test",
          periodFrom: new Date("2031-06-01T00:00:00+07:00"),
          periodTo: new Date("2031-07-14T00:00:00+07:00"),
          fileName: `${tag}.xlsx`,
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          // Order A appears twice (a repeated payout row); its nets must sum, not double-count it.
          lines: { create: [line(`${tag}A`, 5000, a.id), line(`${tag}A`, 1000, a.id), line(`${tag}D`, 2000, d1.id)] },
        },
      });
      settlementId = settlement.id;

      const input = await loadMarketplaceDemandInput({
        start: new Date("2031-06-01T00:00:00+07:00"),
        end: new Date("2031-06-30T23:59:59+07:00"),
      });

      const byId = new Map(input.orders.map((o) => [o.id, o]));
      expect(input.orders.every((o) => orderIds.includes(o.id))).toBe(true);
      expect(byId.get(a.id)).toMatchObject({ matchKeyUnique: true, orderNumbers: [`${tag}A`] });
      expect(byId.get(a.id)?.lines[0]).toMatchObject({ itemId, itemSku: tag, qty: 2, lineTotal: 2000 });
      expect(byId.get(d1.id)?.matchKeyUnique).toBe(false);
      expect(byId.get(d2.id)?.matchKeyUnique).toBe(false);
      expect(byId.get(t.id)?.lines[0]).toMatchObject({ itemId: null, itemSku: null });

      expect(input.settlementNetByOrderId.get(a.id)).toBe(6000);
      expect(input.settlementNetByOrderId.get(d1.id)).toBe(2000);
      expect(input.settlementNetByOrderId.has(t.id)).toBe(false);

      // End to end: A counts; D1/D2 are refused as ambiguous; T's month has no TikTok settlement.
      const result = buildMarketplaceDemand({ ...input, payoutDelayDays: { SHOPEE: 14, TIKTOK: 14 } });
      expect(result.rows.map((r) => [r.itemId, r.netQuantity])).toEqual([[itemId, 2]]);
      expect(result.diagnostics.find((x) => x.family === "SHOPEE")).toMatchObject({
        settled: true,
        countedOrders: 1,
        ambiguousOrders: 1,
        missingPayoutOrders: 1,
      });
      expect(result.diagnostics.find((x) => x.family === "TIKTOK")).toMatchObject({ settled: false, provisionalOrders: 1 });
    } finally {
      if (settlementId) await prisma.settlement.delete({ where: { id: settlementId } });
      await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
      if (itemId) await prisma.item.delete({ where: { id: itemId } });
      if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
    }
  });
});
