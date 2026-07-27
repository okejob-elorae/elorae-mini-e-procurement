import { describe, it, expect } from "vitest";
import { prisma } from "@elorae/db";
import { deriveJubelioComparison, deriveJubelioFees, getSettlementById } from "./queries";

// Test-bed only — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

describe("deriveJubelioComparison (pure)", () => {
  it("computes a matching delta when escrow_amount ties out with the excel net income", () => {
    const r = deriveJubelioComparison(5000, { escrow_amount: "5000" });
    expect(r).toEqual({ jubelioNet: 5000, netDelta: 0, matches: true });
  });

  it("computes a differing delta when escrow_amount diverges from the excel net income", () => {
    const r = deriveJubelioComparison(5000, { escrow_amount: "4200" });
    expect(r.jubelioNet).toBe(4200);
    expect(r.netDelta).toBe(800);
    expect(r.matches).toBe(false);
  });

  it("treats a sub-1 rounding difference as a match", () => {
    const r = deriveJubelioComparison(5000.4, { escrow_amount: "5000" });
    expect(r.matches).toBe(true);
  });

  it("returns null delta / not-matched when feeBreakdown is null", () => {
    const r = deriveJubelioComparison(5000, null);
    expect(r).toEqual({ jubelioNet: null, netDelta: null, matches: false });
  });

  it("returns null delta / not-matched when escrow_amount is absent from feeBreakdown", () => {
    const r = deriveJubelioComparison(5000, { service_fee: "100" });
    expect(r).toEqual({ jubelioNet: null, netDelta: null, matches: false });
  });

  it("treats escrow_amount '0' as absent data (dec() default), not a real zero", () => {
    const r = deriveJubelioComparison(5000, { escrow_amount: "0" });
    expect(r).toEqual({ jubelioNet: null, netDelta: null, matches: false });
  });

  it("returns null when escrow_amount is not numeric", () => {
    const r = deriveJubelioComparison(5000, { escrow_amount: "not-a-number" });
    expect(r).toEqual({ jubelioNet: null, netDelta: null, matches: false });
  });
});

describe("deriveJubelioFees (pure)", () => {
  it("parses every fee field from a full feeBreakdown into the camelCase JubelioFees shape", () => {
    const r = deriveJubelioFees({
      total_amount_mp: "7000",
      service_fee: "500",
      order_processing_fee: "200",
      insurance_cost: "50",
      add_fee: "30",
      add_disc: "100",
      voucher_amount: "70",
      cod_fee: "0",
      shipping_tax: "20",
      escrow_amount: "6030",
    });
    expect(r).toEqual({
      totalAmountMp: 7000,
      serviceFee: 500,
      orderProcessingFee: 200,
      insuranceCost: 50,
      addFee: 30,
      addDisc: 100,
      voucherAmount: 70,
      codFee: 0,
      shippingTax: 20,
      escrowAmount: 6030,
    });
  });

  it("defaults missing/non-numeric fields to 0 rather than NaN", () => {
    const r = deriveJubelioFees({ escrow_amount: "5000" });
    expect(r).toEqual({
      totalAmountMp: 0,
      serviceFee: 0,
      orderProcessingFee: 0,
      insuranceCost: 0,
      addFee: 0,
      addDisc: 0,
      voucherAmount: 0,
      codFee: 0,
      shippingTax: 0,
      escrowAmount: 5000,
    });
  });

  it("returns null when feeBreakdown is null", () => {
    expect(deriveJubelioFees(null)).toBeNull();
  });

  it("treats escrow_amount '0' as absent data, mirroring deriveJubelioComparison's jubelioNet null case", () => {
    const r = deriveJubelioFees({ escrow_amount: "0", service_fee: "500" });
    expect(r?.escrowAmount).toBeNull();
    expect(r?.serviceFee).toBe(500);
  });

  it("treats a missing escrow_amount as absent data (escrowAmount null)", () => {
    const r = deriveJubelioFees({ service_fee: "500" });
    expect(r?.escrowAmount).toBeNull();
  });
});

d("getSettlementById — jubelioNet/netDelta/matches wiring (test bed only)", () => {
  it("surfaces fee columns + a matching, a differing, and a no-jubelio-data line, and counts differCount", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const orderNoMatch = `MTC-${suffix}`;
    const orderNoDiffer = `DIF-${suffix}`;
    const orderNoNoData = `NOD-${suffix}`;
    const salesorderIdMatch = Math.floor(Math.random() * 1_000_000_000);
    const salesorderIdDiffer = salesorderIdMatch + 1;
    const salesorderIdNoData = salesorderIdMatch + 2;

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
              orderNo: orderNoMatch,
              netIncome: 5000,
              hargaAsliProduk: 7000,
              totalDiskonProduk: 0,
              biayaAdministrasi: -1000,
              biayaLayanan: -500,
              biayaKomisiAms: -300,
              biayaProsesPesanan: -200,
              raw: { "No. Pesanan": orderNoMatch },
            },
            {
              orderNo: orderNoDiffer,
              netIncome: 3000,
              hargaAsliProduk: 4000,
              totalDiskonProduk: 0,
              biayaAdministrasi: -500,
              biayaLayanan: -300,
              biayaKomisiAms: -150,
              biayaProsesPesanan: -50,
              raw: { "No. Pesanan": orderNoDiffer },
            },
            {
              orderNo: orderNoNoData,
              netIncome: 2000,
              hargaAsliProduk: 2500,
              totalDiskonProduk: 0,
              biayaAdministrasi: -300,
              biayaLayanan: -150,
              biayaKomisiAms: -30,
              biayaProsesPesanan: -20,
              raw: { "No. Pesanan": orderNoNoData },
            },
          ],
        },
      },
      select: { id: true },
    });

    const orderMatch = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdMatch,
        salesorderNo: `SP-${orderNoMatch}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 5000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 5000,
        transactionDate: new Date(),
        feeBreakdown: {
          total_amount_mp: "7000",
          service_fee: "500",
          order_processing_fee: "200",
          insurance_cost: "50",
          add_fee: "30",
          add_disc: "100",
          voucher_amount: "70",
          cod_fee: "0",
          shipping_tax: "20",
          escrow_amount: "5000",
        },
      },
    });
    const orderDiffer = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdDiffer,
        salesorderNo: `SP-${orderNoDiffer}`,
        channel: "SHOPEE",
        sourceName: "test",
        status: "COMPLETED",
        subTotal: 3000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 3000,
        transactionDate: new Date(),
        feeBreakdown: { escrow_amount: "2600" },
      },
    });
    const orderNoData = await prisma.salesOrder.create({
      data: {
        salesorderId: salesorderIdNoData,
        salesorderNo: `SP-${orderNoNoData}`,
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
    });

    await prisma.settlementLine.updateMany({
      where: { settlementId: settlement.id, orderNo: orderNoMatch },
      data: { matchStatus: "MATCHED", matchedSalesOrderId: orderMatch.id },
    });
    await prisma.settlementLine.updateMany({
      where: { settlementId: settlement.id, orderNo: orderNoDiffer },
      data: { matchStatus: "MATCHED", matchedSalesOrderId: orderDiffer.id },
    });
    await prisma.settlementLine.updateMany({
      where: { settlementId: settlement.id, orderNo: orderNoNoData },
      data: { matchStatus: "MATCHED", matchedSalesOrderId: orderNoData.id },
    });

    try {
      const detail = await getSettlementById(settlement.id);
      expect(detail).not.toBeNull();

      const lineMatch = detail!.lines.find((l) => l.orderNo === orderNoMatch)!;
      expect(lineMatch.hargaAsliProduk).toBe(7000);
      expect(lineMatch.jubelioNet).toBe(5000);
      expect(lineMatch.netDelta).toBe(0);
      expect(lineMatch.matches).toBe(true);
      expect(lineMatch.jubelioFees).toEqual({
        totalAmountMp: 7000,
        serviceFee: 500,
        orderProcessingFee: 200,
        insuranceCost: 50,
        addFee: 30,
        addDisc: 100,
        voucherAmount: 70,
        codFee: 0,
        shippingTax: 20,
        escrowAmount: 5000,
      });

      const lineDiffer = detail!.lines.find((l) => l.orderNo === orderNoDiffer)!;
      expect(lineDiffer.jubelioNet).toBe(2600);
      expect(lineDiffer.netDelta).toBe(400);
      expect(lineDiffer.matches).toBe(false);

      const lineNoData = detail!.lines.find((l) => l.orderNo === orderNoNoData)!;
      expect(lineNoData.jubelioNet).toBeNull();
      expect(lineNoData.netDelta).toBeNull();
      expect(lineNoData.matches).toBe(false);
      expect(lineNoData.jubelioFees).toBeNull();

      expect(detail!.differCount).toBe(1);
    } finally {
      await prisma.salesOrder.deleteMany({
        where: { id: { in: [orderMatch.id, orderDiffer.id, orderNoData.id] } },
      });
      await prisma.settlement.delete({ where: { id: settlement.id } }); // cascades to lines
    }
  });
});
