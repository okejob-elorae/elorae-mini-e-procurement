import { describe, it, expect } from "vitest";
import { prisma } from "@elorae/db";
import { persistSettlement } from "./persist";
import type { ParsedSettlement } from "./shopee-settlement-parser";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

function buildParsed(totalDilepas: number): ParsedSettlement {
  return {
    seller: "elorae.official",
    periodFrom: "2026-06-01",
    periodTo: "2026-06-30",
    summary: { totalPendapatan: 100000, totalPengeluaran: 40000, totalDilepas, raw: {} },
    incomeLines: [
      {
        orderNo: "260529AAA",
        netIncome: 40000,
        hargaAsliProduk: 50000,
        totalDiskonProduk: 0,
        biayaAdministrasi: -5000,
        biayaLayanan: -3000,
        biayaKomisiAms: -2000,
        biayaProsesPesanan: -1250,
        raw: {},
      },
      {
        orderNo: "260529BBB",
        netIncome: 20000,
        hargaAsliProduk: 25000,
        totalDiskonProduk: 0,
        biayaAdministrasi: -2500,
        biayaLayanan: -1500,
        biayaKomisiAms: -1000,
        biayaProsesPesanan: -1250,
        raw: {},
      },
    ],
    sellerFeesRaw: [],
    adjustmentsRaw: [],
    parsedNetTotal: 60000,
  };
}

d("persistSettlement (test bed only)", () => {
  it("persists settlement + lines and flags checksum ok", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const parsed = buildParsed(60000);

    const res = await persistSettlement({
      parsed,
      fileName: "t.xlsx",
      uploadedById: admin.id,
      marketplace: "SHOPEE",
    });

    try {
      expect(res.lineCount).toBe(2);
      expect(res.checksumOk).toBe(true);
      expect(res.checksumVariance).toBe(0);

      const s = await prisma.settlement.findUnique({
        where: { id: res.settlementId },
        include: { lines: true },
      });
      expect(s).not.toBeNull();
      expect(s!.lines.length).toBe(2);
    } finally {
      await prisma.settlement.delete({ where: { id: res.settlementId } });
    }
  });

  it("flags checksum mismatch when totals disagree", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const parsed = buildParsed(59000);

    const res = await persistSettlement({
      parsed,
      fileName: "t.xlsx",
      uploadedById: admin.id,
      marketplace: "SHOPEE",
    });

    try {
      expect(res.checksumOk).toBe(false);
      expect(res.checksumVariance).toBe(1000);
    } finally {
      await prisma.settlement.delete({ where: { id: res.settlementId } });
    }
  });
});
