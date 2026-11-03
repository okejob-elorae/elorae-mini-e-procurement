import { prisma } from "@elorae/db";
import { REF_KOMISI_SALESMAN } from "@/lib/spg/hilang";
import { awalanKembaliRetur, awalanPotongRetur, ringkasPotonganRetur, type PotonganReturSales } from "./potongan-retur";

export type { PotonganReturSales } from "./potongan-retur";

/**
 * Pembaca kolom "Selisih retur" laporan komisi salesman — KHUSUS SERVER. Aturannya di
 * `potongan-retur.ts`; yang dibaca persis yang ditulis `lib/receivables/potong-beban-retur.ts`.
 *
 * Nama dan bentuknya mengikuti daftar pengenal paket selisih retur (`potonganReturSalesBulan` /
 * `PotonganReturSales`), yang menaruhnya di `lib/receivables/return-queries.ts`. Karena kueri itu tidak
 * pernah dibuat di sana, laporan ini membawanya sendiri supaya halamannya tidak rusak. Kalau kelak
 * dipindah ke lib, pindahkan berkas ini apa adanya — jangan ada dua salinan.
 */
export async function potonganReturSalesBulan(
  salesmanIds: string[],
  bulan: string,
): Promise<Record<string, PotonganReturSales>> {
  const ids = [...new Set(salesmanIds)];
  if (ids.length === 0) return {};
  const [beban, potongan] = await Promise.all([
    prisma.returnCharge.findMany({
      where: { bearer: "SALES", bearerUserId: { in: ids }, status: { in: ["DITETAPKAN", "LUNAS"] } },
      select: { bearerUserId: true, amount: true, settledAmount: true },
    }),
    prisma.returnChargeDeduction.findMany({
      where: {
        refType: REF_KOMISI_SALESMAN,
        OR: ids.flatMap((id) => [
          { refId: { startsWith: awalanPotongRetur(id, bulan) } },
          { refId: { startsWith: awalanKembaliRetur(id, bulan) } },
        ]),
      },
      select: { refId: true, amount: true },
    }),
  ]);
  return ringkasPotonganRetur({
    salesmanIds: ids,
    bulan,
    beban: beban.map((b) => ({ bearerUserId: b.bearerUserId, amount: Number(b.amount), settledAmount: Number(b.settledAmount) })),
    potongan: potongan.map((p) => ({ refId: p.refId, amount: Number(p.amount) })),
  });
}
