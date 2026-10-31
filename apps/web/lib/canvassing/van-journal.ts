import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type AutoJournalLine, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { lineCostTotal, reconcileSplit } from "./van-journal-values";
import { nilaiPerPeranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { KANAL_JURNAL } from "@/lib/finance/journals/kanal";
import { barisPenjualanPpn } from "@/lib/finance/pajak/jurnal-ppn";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

const num = (v: Prisma.Decimal | number): number => Number(v);

/**
 * Loading a van moves stock out of main inventory into a van-held asset. The
 * stock ledger already does this (`VAN_LOAD` adjustment) but posted no journal,
 * so GL `Persediaan` and `InventoryValue` diverged for anything on a van.
 */
export async function postVanLoadJournal(
  vanLoadId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const load = await client.vanLoad.findUnique({
    where: { id: vanLoadId },
    select: { docNo: true, createdAt: true, lines: { select: { qty: true, unitCost: true, item: { select: { type: true } } } } },
  });
  if (!load) return { ok: false, code: "NOTHING_TO_POST" };

  const value = lineCostTotal(load.lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost) })));
  if (value < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  // Barang kanvas adalah barang jadi: keluar dari `INVENTORY_FG`, tempat penerimaan
  // barang jadi mendebitnya (peran-persediaan.ts). Σ pecahan = `value` (sen per baris).
  const asal = nilaiPerPeranPersediaan(load.lines.map((l) => ({ tipeBarang: l.item.type, nilai: num(l.qty) * num(l.unitCost) })));

  return generateAutoJournal(
    client,
    "VAN_LOAD",
    vanLoadId,
    [
      { role: "INVENTORY_VAN" as const, debit: value, credit: 0 },
      ...asal.map((p) => ({ role: p.role, debit: 0, credit: p.nilai })),
    ],
    { date: load.createdAt, description: `Muat kanvas ${load.docNo}`, postedById },
  );
}

/**
 * A canvassing sale is cash-on-spot: cash in against revenue, and cost out of
 * the van-held asset at the snapshot cost stamped on the sale line.
 *
 * PPN (`barisPenjualanPpn`): PKP → CR pendapatan DPP + CR PPN keluaran dari
 * harga jual yang termasuk PPN; selain itu pendapatan = total seperti dulu.
 * Kanal `KANVAS` dan toko pembeli (bila terdaftar) di baris kas, pendapatan,
 * dan HPP.
 */
export async function postVanSaleJournal(
  vanSaleId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const sale = await client.vanSale.findUnique({
    where: { id: vanSaleId },
    select: { docNo: true, createdAt: true, total: true, storeId: true, lines: { select: { qty: true, unitCost: true } } },
  });
  if (!sale) return { ok: false, code: "NOTHING_TO_POST" };
  const dimensi = { channel: KANAL_JURNAL.KANVAS, storeId: sale.storeId };

  const revenue = num(sale.total);
  const cogs = lineCostTotal(sale.lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost) })));
  if (revenue < 0.01 && cogs < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const lines: AutoJournalLine[] = [];
  if (revenue >= 0.01) {
    const { baris } = barisPenjualanPpn({
      total: revenue,
      peranDebit: "CASH",
      pengaturan: await bacaPengaturanPpn(client),
      tanggal: sale.createdAt,
      dimensi,
    });
    lines.push(...baris);
  }
  if (cogs >= 0.01) {
    lines.push({ role: "COGS" as const, debit: cogs, credit: 0, ...dimensi });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: cogs, ...dimensi });
  }

  return generateAutoJournal(client, "VAN_SALE", vanSaleId, lines, {
    date: sale.createdAt,
    description: `Penjualan kanvas ${sale.docNo}`,
    postedById,
  });
}

/**
 * End-of-day reconcile returns counted stock to main inventory and writes the
 * shortfall off to the variance account — the first time van shrinkage reaches
 * the GL. A zero-value leg is omitted entirely: `postJournal` rejects a line
 * with neither a debit nor a credit.
 */
export async function postVanReconcileJournal(
  vanReconcileId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const recon = await client.vanReconcile.findUnique({
    where: { id: vanReconcileId },
    select: {
      docNo: true,
      createdAt: true,
      lines: { select: { countedQty: true, varianceQty: true, unitCost: true, item: { select: { type: true } } } },
    },
  });
  if (!recon) return { ok: false, code: "NOTHING_TO_POST" };

  const { returned, variance } = reconcileSplit(
    recon.lines.map((l) => ({
      countedQty: num(l.countedQty),
      varianceQty: num(l.varianceQty),
      unitCost: num(l.unitCost),
    })),
  );

  const lines: AutoJournalLine[] = [];
  if (returned >= 0.01) {
    // Barang yang kembali ke gudang masuk lagi ke persediaan menurut tipenya (barang jadi → INVENTORY_FG).
    const tujuan = nilaiPerPeranPersediaan(recon.lines.map((l) => ({ tipeBarang: l.item.type, nilai: num(l.countedQty) * num(l.unitCost) })));
    for (const p of tujuan) lines.push({ role: p.role, debit: p.nilai, credit: 0 });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: returned });
  }
  // Selisih muatan kanvas adalah beban kanal kanvas — barisnya membawa kanal KANVAS.
  if (variance >= 0.01) {
    lines.push({ role: "INVENTORY_VARIANCE" as const, debit: variance, credit: 0, channel: KANAL_JURNAL.KANVAS });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: variance });
  } else if (variance <= -0.01) {
    /* Counted more than expected: reverse the write-off direction. */
    lines.push({ role: "INVENTORY_VAN" as const, debit: -variance, credit: 0 });
    lines.push({ role: "INVENTORY_VARIANCE" as const, debit: 0, credit: -variance, channel: KANAL_JURNAL.KANVAS });
  }

  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  return generateAutoJournal(client, "VAN_RECONCILE", vanReconcileId, lines, {
    date: recon.createdAt,
    description: `Rekonsiliasi kanvas ${recon.docNo}`,
    postedById,
  });
}
