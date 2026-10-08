import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { withRetry } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { splitMarketplaceFees, type MarketplaceFeeRole } from "./fee-split";
import { tandaiSettlementGanda } from "./persist";
import { seluruhnyaSebelumTanggalMulai } from "@/lib/finance/periode/gerbang";
import { pajakSettlement } from "@/lib/finance/pajak/settlement-pajak";
import { memoDpp } from "@/lib/finance/pajak/jurnal-ppn";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export type PostSettlementJournalResult =
  | { ok: true; journalId: string; created: boolean }
  | {
      ok: false;
      code:
        | "CHECKSUM_BLOCKED"
        | "UNMAPPED_ROLE"
        | "UNBALANCED"
        | "ALREADY_RECONCILED_DIFF"
        | "NON_POSTABLE_ACCOUNT"
        /* Kembar dengan unggahan lain yang sudah dijurnal atau lebih dulu diunggah. */
        | "SETTLEMENT_KEMBAR"
        /*
         * Seluruh periode settlement sebelum tanggal mulai buku besar: penjualannya
         * dibukukan di luar sistem, jadi piutangnya tidak pernah didebit di sini —
         * mengkreditnya membuat piutang marketplace minus.
         */
        | "SEBELUM_TANGGAL_MULAI";
      role?: string;
      /* Hanya pada SETTLEMENT_KEMBAR: id unggahan yang berlaku. */
      pertamaId?: string;
    };

/**
 * Penjaga server settlement kembar (marketplace, penjual, periode, dan uang
 * dilepas sama). Jurnal berkunci id settlement, jadi kembaran yang ikut
 * dijurnal = bank didebit dan piutang dikredit dua kali. Mengembalikan id
 * unggahan yang berlaku bila settlement ini kembarannya.
 */
async function cariPertamaKembar(settlementId: string, client: AnyClient): Promise<string | null> {
  const tanda = await tandaiSettlementGanda([settlementId], client as Prisma.TransactionClient);
  return tanda[settlementId]?.id ?? null;
}

/**
 * Falls back to the legacy lumped `MARKETPLACE_FEE` account when a per-category
 * role is not mapped yet, so settlements keep posting on an existing chart of
 * accounts instead of failing until an admin wires five new mappings.
 */
async function resolveFeeAccount(role: MarketplaceFeeRole, client: AnyClient): Promise<string> {
  try {
    return await resolveAccount(role, client);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
    try {
      return await resolveAccount("MARKETPLACE_FEE", client);
    } catch (fallbackError) {
      /* Name the category the operator actually hit, not the fallback they never chose. */
      if (fallbackError instanceof UnmappedRoleError) throw new UnmappedRoleError(role);
      throw fallbackError;
    }
  }
}

export async function postSettlementJournal(
  settlementId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSettlementJournalResult> {
  const s = await client.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: {
      id: true,
      checksumOk: true,
      totalDilepas: true,
      totalPengeluaran: true,
      totalPendapatan: true,
      seller: true,
      periodTo: true,
      marketplace: true,
      periodFrom: true,
      summaryRaw: true,
    },
  });

  // Diperiksa paling dulu agar kembaran tidak dijawab dengan penolakan lain yang menyesatkan.
  const pertamaAwal = await cariPertamaKembar(s.id, client);
  if (pertamaAwal) return { ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: pertamaAwal };

  if (!s.checksumOk) return { ok: false, code: "CHECKSUM_BLOCKED" };

  // Gerbang tanggal mulai buku besar (bagian A1). Settlement yang melintasi tanggal
  // mulai tetap diposting: penjualan sebelum tanggal mulai yang dicairkannya masuk
  // saldo awal piutang marketplace (wizard saldo awal).
  if (await seluruhnyaSebelumTanggalMulai(s.periodTo)) return { ok: false, code: "SEBELUM_TANGGAL_MULAI" };

  const feeTotals = await client.settlementLine.aggregate({
    where: { settlementId: s.id },
    _sum: {
      biayaAdministrasi: true,
      biayaLayanan: true,
      biayaKomisiAms: true,
      biayaProsesPesanan: true,
    },
  });

  /**
   * `SettlementLine.biaya*` columns and `Settlement.totalPengeluaran` are
   * stored NEGATIVE in real data — they are deductions, not costs — and
   * `splitMarketplaceFees` needs non-negative magnitudes to emit debit lines
   * (see `fee-split.ts`'s "negative amount becomes a credit" rule). Feeding
   * it the raw signed sums would flip every itemized category into a
   * contra-expense credit, the inverse of the intended breakdown, and can
   * leave the journal unbalanced once bank/AR are added. Normalize with
   * `Math.abs()` here, at read time — not in the Shopee parser, since the
   * stored signed values are also consumed elsewhere (e.g. settlement
   * compare views) and flipping them there would ripple. This mirrors the
   * same convention `tiktok-settlement-parser.ts` already applies to
   * `totalBiaya` for the identical reason (see its top-of-file comment and
   * the per-line `Math.abs()` note near its `totalPengeluaran +=`).
   */
  /*
   * Pajak & kanal (`lib/finance/pajak/settlement-pajak.ts`): PPh 22 yang
   * dipungut marketplace keluar dari sisa biaya "lainnya" ke `PPH22_PREPAID`,
   * dan bila PKP PPN empat biaya yang dirinci dipisah ke `PPN_MASUKAN`.
   * Bukan PKP dan tanpa kolom PPh 22 (bawaan): baris sama persis seperti dulu.
   */
  const pajak = await pajakSettlement(s, client);
  const { biaya: feeSplit, ppn: ppnBiaya, dpp: dppBiaya } = pajak.pisahPpnBiaya(
    splitMarketplaceFees(
      {
        admin: Math.abs(Number(feeTotals._sum.biayaAdministrasi ?? 0)),
        service: Math.abs(Number(feeTotals._sum.biayaLayanan ?? 0)),
        commission: Math.abs(Number(feeTotals._sum.biayaKomisiAms ?? 0)),
        processing: Math.abs(Number(feeTotals._sum.biayaProsesPesanan ?? 0)),
      },
      Math.abs(Number(s.totalPengeluaran)) - pajak.pph22,
    ),
  );

  let bank: string, ar: string;
  let ppnMasukan: string | null = null;
  let pph22: string | null = null;
  const feeAccounts = new Map<MarketplaceFeeRole, string>();
  try {
    bank = await resolveAccount("BANK", client);
    ar = await resolveAccount("AR", client);
    for (const split of feeSplit) {
      feeAccounts.set(split.role, await resolveFeeAccount(split.role, client));
    }
    if (ppnBiaya > 0) ppnMasukan = await resolveAccount("PPN_MASUKAN", client);
    if (pajak.pph22 > 0) pph22 = await resolveAccount("PPH22_PREPAID", client);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  const channel = pajak.channel;
  const lines = [
    { chartAccountId: bank, debit: Number(s.totalDilepas), credit: 0, channel },
    ...feeSplit.map((split) => ({
      chartAccountId: feeAccounts.get(split.role)!,
      debit: split.debit,
      credit: split.credit,
      /* Distinguishes categories that share the legacy MARKETPLACE_FEE fallback account. */
      memo: split.role,
      channel,
    })),
    ...(ppnMasukan ? [{ chartAccountId: ppnMasukan, debit: ppnBiaya, credit: 0, memo: memoDpp(dppBiaya) }] : []),
    ...(pph22 ? [{ chartAccountId: pph22, debit: pajak.pph22, credit: 0, memo: pajak.kolomPph22 ?? "PPh 22" }] : []),
    { chartAccountId: ar, debit: 0, credit: Number(s.totalPendapatan), channel },
  ];

  const run = async (tx: Prisma.TransactionClient): Promise<PostSettlementJournalResult> => {
    // Diperiksa ulang di dalam transaksi yang menulis jurnal: keadaan "sudah dijurnal"
    // yang menentukan unggahan mana yang berlaku bisa berubah sejak pemeriksaan awal.
    const pertama = await cariPertamaKembar(s.id, tx);
    if (pertama) return { ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: pertama };
    const res = await postJournal(tx, {
      source: { type: "SETTLEMENT", id: s.id },
      date: s.periodTo,
      description: pajak.deskripsi,
      postedById,
      lines,
    });
    await tx.settlement.update({ where: { id: s.id }, data: { status: "RECONCILED" } });
    return { ok: true, journalId: res.journalId, created: res.created };
  };

  try {
    return hasTx(client)
      ? await withRetry(() =>
          client.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        )
      : await run(client as Prisma.TransactionClient);
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") {
      return { ok: false, code: "NON_POSTABLE_ACCOUNT" };
    }
    throw e;
  }
}
