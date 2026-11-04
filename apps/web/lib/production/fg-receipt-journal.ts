import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type AutoJournalLine, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { memoDpp } from "@/lib/finance/pajak/jurnal-ppn";
import { komponenJurnalPenerimaan, type KomponenJurnalPenerimaan } from "./biaya-penerimaan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export const SUMBER_JURNAL_PENERIMAAN_FG = "FG_RECEIPT";

/**
 * Baris jurnal penerimaan barang jadi (murni). Keputusan sementara pemilik 34 —
 * ongkos jahit (CMT) dan jasa langkah WO lainnya masuk HPP (PSAK 14):
 *
 *   DR Persediaan barang jadi (`INVENTORY_FG`)   nilai persediaan
 *   DR PPN Masukan (`PPN_MASUKAN`)               PPN jasa, hanya bila Elorae PKP
 *      CR Persediaan bahan (`INVENTORY`)          bahan yang dipikul penerimaan ini
 *      CR Hutang usaha (`AP`)                     tagihan jasa pemasok (termasuk PPN-nya)
 *      CR Biaya yang masih harus dibayar          biaya tambahan per pcs (kemasan, dll.)
 *         (`ACCRUED_EXPENSE`)
 *
 * Komponen nol dibuang. Bahan dikredit ke `INVENTORY` (bahan baku): bahan yang
 * dikeluarkan ke WO tidak dijurnal saat keluar (tidak ada akun barang dalam
 * proses), jadi persediaan bahan di buku besar baru berkurang di sini.
 */
export function barisJurnalPenerimaanFG(k: KomponenJurnalPenerimaan, memo?: { jasa?: string }): AutoJournalLine[] {
  const baris: AutoJournalLine[] = [];
  const dr = (role: AutoJournalLine["role"], nilai: number, catatan?: string) => {
    if (nilai >= 0.005) baris.push({ role, debit: nilai, credit: 0, ...(catatan ? { memo: catatan } : {}) });
  };
  const cr = (role: AutoJournalLine["role"], nilai: number, catatan?: string) => {
    if (nilai >= 0.005) baris.push({ role, debit: 0, credit: nilai, ...(catatan ? { memo: catatan } : {}) });
  };
  dr("INVENTORY_FG", k.persediaan);
  // DPP jasa = tagihan penjahit (termasuk PPN) − PPN-nya; rekap masa PPN membacanya dari memo.
  dr("PPN_MASUKAN", k.ppnMasukan, memoDpp(k.jasa - k.ppnMasukan));
  cr("INVENTORY", k.bahan);
  cr("AP", k.jasa, memo?.jasa);
  cr("ACCRUED_EXPENSE", k.tambahan);
  return baris;
}

export async function postFgReceiptJournal(
  receiptId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const receipt = await client.fGReceipt.findUnique({
    where: { id: receiptId },
    select: {
      totalCostValue: true,
      materialCost: true,
      serviceCost: true,
      additionalCost: true,
      qtyAccepted: true,
      docNumber: true,
      receivedAt: true,
      wo: { select: { docNumber: true } },
    },
  });
  if (!receipt) return { ok: false, code: "NOTHING_TO_POST" };
  if (Number(receipt.qtyAccepted) <= 0) return { ok: false, code: "NOTHING_TO_POST" };
  const komponen = komponenJurnalPenerimaan(receipt);
  if (!komponen) return { ok: false, code: "UNBALANCED" };
  if (Math.abs(komponen.persediaan) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const nomorWo = receipt.wo?.docNumber ?? null;
  const lines = barisJurnalPenerimaanFG(komponen, { jasa: nomorWo ? `Jasa produksi WO ${nomorWo}` : undefined });
  return generateAutoJournal(client, SUMBER_JURNAL_PENERIMAAN_FG, receiptId, lines, {
    date: receipt.receivedAt ?? new Date(),
    description: nomorWo
      ? `Penerimaan barang jadi ${receipt.docNumber} (WO ${nomorWo})`
      : `Penerimaan barang jadi ${receipt.docNumber}`,
    postedById,
  });
}
