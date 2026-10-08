import type { Prisma, PrismaClient } from "@elorae/db";
import type { FeeSplitLine, MarketplaceFeeRole } from "@/lib/finance/settlement/fee-split";
import { kanalMarketplace, labelKanalJurnal, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { formatDisplayDate } from "@/lib/date-only";
import { bacaPengaturanPpn } from "./ppn-pengaturan";
import { pisahPpnMasukanTermasuk } from "./jurnal-ppn";
import { pph22DariSettlement } from "./pph22-marketplace";
import type { PengaturanPpn } from "./ppn";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * Bagian PAJAK dan KANAL jurnal settlement marketplace — dipisah dari
 * `lib/finance/settlement/journal.ts` supaya penulis itu hanya menyusun baris.
 *
 * - PPh 22 yang dipungut marketplace (`pph22DariSettlement`) keluar dari sisa
 *   biaya "lainnya" dan dibukukan DR `PPH22_PREPAID` — biaya bukan, pajak
 *   dibayar dimuka.
 * - PKP: empat biaya marketplace yang dirinci (administrasi, layanan, komisi
 *   AMS, proses pesanan) ditagih termasuk PPN; PPN-nya PPN MASUKAN (DR
 *   `PPN_MASUKAN`), bebannya DPP. Sisa "biaya lainnya" (penyesuaian, ongkir,
 *   semua biaya TikTok yang tidak dirinci) TIDAK dipisah — isinya campuran dan
 *   tidak semuanya ber-faktur (keputusan sementara, aman ke arah pajak).
 *   Bukan PKP (bawaan): biaya tetap bruto seperti sebelumnya.
 * - Kanal (`kanalMarketplace(marketplace)`) di setiap baris jurnalnya.
 */

const BIAYA_BERPPN: ReadonlySet<MarketplaceFeeRole> = new Set([
  "MARKETPLACE_FEE_ADMIN",
  "MARKETPLACE_FEE_SERVICE",
  "MARKETPLACE_FEE_COMMISSION",
  "MARKETPLACE_FEE_PROCESSING",
]);

const keSen = (n: number) => Math.round(Number((n * 100).toFixed(4)));

/** Murni: pisahkan PPN masukan dari baris biaya yang berPPN (hanya baris debit). */
export function pisahPpnBiayaMarketplace(
  biaya: readonly FeeSplitLine[],
  pengaturan: PengaturanPpn,
  tanggal: Date,
): { biaya: FeeSplitLine[]; ppn: number; dpp: number } {
  let ppnSen = 0;
  let dppSen = 0;
  const hasil = biaya.map((b) => {
    if (!BIAYA_BERPPN.has(b.role) || b.debit <= 0) return { ...b };
    const p = pisahPpnMasukanTermasuk(b.debit, pengaturan, tanggal);
    if (p.ppn === 0) return { ...b };
    ppnSen += keSen(p.ppn);
    dppSen += keSen(p.dpp);
    return { ...b, debit: p.dpp };
  });
  return { biaya: hasil, ppn: ppnSen / 100, dpp: dppSen / 100 };
}

export type PajakSettlement = {
  channel: KanalJurnal;
  /** PPh 22 dipungut marketplace, positif; 0 bila berkas tidak memuatnya. */
  pph22: number;
  kolomPph22: string | null;
  deskripsi: string;
  pengaturan: PengaturanPpn;
  pisahPpnBiaya(biaya: readonly FeeSplitLine[]): { biaya: FeeSplitLine[]; ppn: number; dpp: number };
};

export async function pajakSettlement(
  s: { id: string; marketplace: string; seller: string; periodFrom: Date; periodTo: Date; summaryRaw: unknown },
  client: AnyClient,
): Promise<PajakSettlement> {
  const [pengaturan, baris] = await Promise.all([
    bacaPengaturanPpn(client),
    client.settlementLine.findMany({ where: { settlementId: s.id }, select: { raw: true } }),
  ]);
  const pph22 = pph22DariSettlement(
    baris.map((b) => b.raw),
    s.summaryRaw,
  );
  const channel = kanalMarketplace(s.marketplace);
  return {
    channel,
    pph22: pph22.nilai,
    kolomPph22: pph22.kolom,
    deskripsi: `Settlement ${labelKanalJurnal(channel)} ${s.seller} ${formatDisplayDate(s.periodFrom)}–${formatDisplayDate(s.periodTo)}`,
    pengaturan,
    pisahPpnBiaya: (biaya) => pisahPpnBiayaMarketplace(biaya, pengaturan, s.periodTo),
  };
}
