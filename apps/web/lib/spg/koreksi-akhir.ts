import type { Prisma, prisma } from "@elorae/db";
import { bulanPesertaSpg } from "./gaji-pokok-queries";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import type { RefBarisKomisi } from "./koreksi";

type Klien = Prisma.TransactionClient | typeof prisma;

const kunciPasangan = (storeId: string, periode: string) => `${storeId}\u0000${periode}`;
const bulanDari = (tahun: number, bulan: number) => `${tahun}-${String(bulan).padStart(2, "0")}`;

export type SebabBukanAkhir = "BELUM_BERHENTI" | "LAPORAN_BELUM_DITUTUP" | "SIKLUS_BELUM_DIBUKA" | "BARIS_LAIN_BELUM_DIBAYAR";

/**
 * Apakah membayar baris `refId` adalah pembayaran TERAKHIR SPG yang berhenti (B28): ia sudah
 * berhenti, SETIAP bulan tempat ia menjadi peserta gaji di tokonya sampai bulan berhentinya sudah
 * ditutup (toko putus dicek, siklus konsinyasi dikunci) dan ia punya baris di sana, dan setiap baris
 * itu sudah dibayar kecuali baris ini. Dibaca di transaksi pembayaran: dua baris SPG yang sama yang
 * dibayar bersamaan tidak bisa sama-sama menjadi yang terakhir.
 */
export async function pembayaranAkhir(
  tx: Klien,
  input: { userId: string; refType: RefBarisKomisi; refId: string },
): Promise<{ akhir: boolean; sebab: SebabBukanAkhir | null }> {
  const u = await tx.user.findUnique({ where: { id: input.userId }, select: { spgEndedOn: true, spgEndedStoreId: true } });
  if (!u?.spgEndedOn) return { akhir: false, sebab: "BELUM_BERHENTI" };
  const bulan = await bulanPesertaSpg(tx, input.userId);
  if (bulan.length === 0) return { akhir: true, sebab: null };
  const toko = [...new Set(bulan.map((b) => b.storeId))];
  const periode = [...new Set(bulan.map((b) => b.bulan))];
  const [tokoRows, siklus, cek, konsi, putus] = await Promise.all([
    tx.store.findMany({ where: { id: { in: toko } }, select: { id: true, termsType: true } }),
    tx.consignmentCycle.findMany({
      where: { storeId: { in: toko }, OR: periode.map((p) => ({ periodYear: Number(p.slice(0, 4)), periodMonth: Number(p.slice(5, 7)) })) },
      select: { id: true, storeId: true, periodYear: true, periodMonth: true, lockedAt: true },
    }),
    tx.spgSalesCheck.findMany({ where: { storeId: { in: toko }, period: { in: periode } }, select: { storeId: true, period: true } }),
    tx.consignmentCommission.findMany({ where: { spgUserId: input.userId }, select: { id: true, cycleId: true, paidAt: true } }),
    tx.spgCommission.findMany({ where: { userId: input.userId }, select: { id: true, storeId: true, period: true, paidAt: true } }),
  ]);
  const syarat = new Map(tokoRows.map((t) => [t.id, t.termsType]));
  const siklusPer = new Map(siklus.map((s) => [kunciPasangan(s.storeId, bulanDari(s.periodYear, s.periodMonth)), s]));
  const dicek = new Set(cek.map((c) => kunciPasangan(c.storeId, c.period)));
  for (const b of bulan) {
    const k = kunciPasangan(b.storeId, b.bulan);
    const s = siklusPer.get(k);
    if (s) {
      if (!s.lockedAt) return { akhir: false, sebab: "LAPORAN_BELUM_DITUTUP" };
      const r = konsi.find((x) => x.cycleId === s.id);
      if (!r) return { akhir: false, sebab: "LAPORAN_BELUM_DITUTUP" };
      if (!r.paidAt && !(input.refType === REF_KOMISI_KONSI && r.id === input.refId)) return { akhir: false, sebab: "BARIS_LAIN_BELUM_DIBAYAR" };
      continue;
    }
    if (dicek.has(k)) {
      const r = putus.find((x) => x.storeId === b.storeId && x.period === b.bulan);
      if (!r) return { akhir: false, sebab: "LAPORAN_BELUM_DITUTUP" };
      if (!r.paidAt && !(input.refType === REF_KOMISI_SPG_PUTUS && r.id === input.refId)) return { akhir: false, sebab: "BARIS_LAIN_BELUM_DIBAYAR" };
      continue;
    }
    return { akhir: false, sebab: syarat.get(b.storeId) === "KONSI" ? "SIKLUS_BELUM_DIBUKA" : "LAPORAN_BELUM_DITUTUP" };
  }
  return { akhir: true, sebab: null };
}

