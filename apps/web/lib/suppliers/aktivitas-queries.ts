import { prisma } from "@elorae/db";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { kreditReturPerPo } from "@/lib/purchase-orders/kredit-retur-queries";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { ringkasAktivitasPemasok, type AktivitasPemasok } from "./aktivitas";

/*
 * Pemuat ringkasan kerja pemasok untuk satu halaman daftar pemasok (paling
 * banyak 100 id). Jumlah kueri tetap, tidak bertambah per baris:
 *   PO terbuka/belum dibayar, kredit retur, PO+GRN terbaru, SPK berjalan, SPK terbaru.
 * Hanya yang boleh dilihat yang dibaca.
 */

export type IzinAktivitas = { lihatPo: boolean; lihatUtang: boolean; lihatSpk: boolean };

export type AktivitasBaris = AktivitasPemasok & { wa: string | null };

const BATAS_ID = 100;

export async function aktivitasPemasok(
  supplierIds: readonly string[],
  izin: IzinAktivitas,
  sekarang: Date = new Date(),
): Promise<Record<string, AktivitasBaris>> {
  const ids = [...new Set(supplierIds.filter((id) => typeof id === "string" && id.length > 0))].slice(0, BATAS_ID);
  if (ids.length === 0) return {};
  const bacaPo = izin.lihatPo || izin.lihatUtang;

  const [pemasok, po, terakhirPo, terakhirGrn, spk, terakhirSpk] = await Promise.all([
    prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true } }),
    bacaPo
      ? prisma.purchaseOrder.findMany({
          where: {
            supplierId: { in: ids },
            OR: [
              { status: { in: ["SUBMITTED", "PARTIAL"] } },
              { status: { in: ["CLOSED", "OVER"] }, paidAt: null },
            ],
          },
          select: {
            id: true,
            supplierId: true,
            status: true,
            etaDate: true,
            paymentDueDate: true,
            paidAt: true,
            createdAt: true,
            grandTotal: true,
            ppnRatePercent: true,
            closedAt: true,
            items: { select: { qty: true, receivedQty: true, price: true, ppnIncluded: true } },
          },
        })
      : Promise.resolve([]),
    izin.lihatPo
      ? prisma.purchaseOrder.groupBy({
          by: ["supplierId"],
          where: { supplierId: { in: ids }, status: { notIn: ["DRAFT", "CANCELLED"] } },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    izin.lihatPo
      ? prisma.gRN.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids } }, _max: { grnDate: true } })
      : Promise.resolve([]),
    izin.lihatSpk
      ? prisma.workOrder.findMany({
          where: { vendorId: { in: ids }, status: { in: ["ISSUED", "IN_PRODUCTION", "PARTIAL"] } },
          select: { vendorId: true, status: true, plannedQty: true, targetDate: true, createdAt: true },
        })
      : Promise.resolve([]),
    izin.lihatSpk
      ? prisma.workOrder.groupBy({
          by: ["vendorId"],
          where: { vendorId: { in: ids }, status: { notIn: ["DRAFT", "CANCELLED"] } },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const kredit = izin.lihatUtang ? await kreditReturPerPo(po.map((p) => p.id)) : new Map<string, number>();

  const terakhirPembelian = new Map<string, Date>();
  const catat = (peta: Map<string, Date>, id: string, t: Date | null | undefined) => {
    if (!t) return;
    const lama = peta.get(id);
    if (!lama || t > lama) peta.set(id, t);
  };
  for (const g of terakhirPo) catat(terakhirPembelian, g.supplierId, g._max.createdAt);
  for (const g of terakhirGrn) catat(terakhirPembelian, g.supplierId, g._max.grnDate);
  const terakhirSpkPeta = new Map<string, Date>();
  for (const g of terakhirSpk) catat(terakhirSpkPeta, g.vendorId, g._max.createdAt);

  const ringkas = ringkasAktivitasPemasok({
    supplierIds: ids,
    po,
    spk,
    kredit,
    terakhirPembelian,
    terakhirSpk: terakhirSpkPeta,
    awalHariIni: batasHariIniWib(sekarang).awal,
    ...izin,
  });

  const telepon = new Map(pemasok.map((p) => [p.id, p.phone]));
  const hasil: Record<string, AktivitasBaris> = {};
  for (const id of ids) {
    const n = nomorWhatsApp(telepon.get(id));
    hasil[id] = { ...ringkas[id], wa: n ? `https://wa.me/${n}` : null };
  }
  return hasil;
}
