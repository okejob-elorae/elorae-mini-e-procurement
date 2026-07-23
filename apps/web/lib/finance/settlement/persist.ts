import { prisma, Prisma } from "@elorae/db";
import type { ParsedSettlement } from "./shopee-settlement-parser";

export type PersistResult = {
  settlementId: string;
  checksumOk: boolean;
  checksumVariance: number;
  lineCount: number;
};

export async function persistSettlement(
  input: { parsed: ParsedSettlement; fileName: string; uploadedById: string; marketplace: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PersistResult> {
  const p = input.parsed;
  const variance = Math.round((p.parsedNetTotal - p.summary.totalDilepas) * 100) / 100;
  const checksumOk = Math.abs(variance) < 1;

  const run = async (tx: Prisma.TransactionClient) => {
    const s = await tx.settlement.create({
      data: {
        marketplace: input.marketplace,
        seller: p.seller,
        periodFrom: new Date(`${p.periodFrom}T00:00:00+07:00`),
        periodTo: new Date(`${p.periodTo}T00:00:00+07:00`),
        fileName: input.fileName,
        uploadedById: input.uploadedById,
        status: "PARSED",
        totalPendapatan: p.summary.totalPendapatan,
        totalPengeluaran: p.summary.totalPengeluaran,
        totalDilepas: p.summary.totalDilepas,
        parsedNetTotal: p.parsedNetTotal,
        checksumOk,
        checksumVariance: variance,
        summaryRaw: p.summary.raw as Prisma.InputJsonValue,
        sellerFeesRaw: p.sellerFeesRaw as Prisma.InputJsonValue,
        adjustmentsRaw: p.adjustmentsRaw as Prisma.InputJsonValue,
        lines: {
          create: p.incomeLines.map((l) => ({
            orderNo: l.orderNo,
            netIncome: l.netIncome,
            hargaAsliProduk: l.hargaAsliProduk,
            totalDiskonProduk: l.totalDiskonProduk,
            biayaAdministrasi: l.biayaAdministrasi,
            biayaLayanan: l.biayaLayanan,
            biayaKomisiAms: l.biayaKomisiAms,
            biayaProsesPesanan: l.biayaProsesPesanan,
            raw: l.raw as Prisma.InputJsonValue,
          })),
        },
      },
      select: { id: true },
    });

    return { settlementId: s.id, checksumOk, checksumVariance: variance, lineCount: p.incomeLines.length };
  };

  return "$transaction" in client
    ? (client as typeof prisma).$transaction(run)
    : run(client as Prisma.TransactionClient);
}
