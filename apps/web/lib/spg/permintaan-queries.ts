import { prisma } from "@elorae/db";
import type { StatusPermintaan } from "./kantor-queries";
import { bacaAlasan, type AlasanPermintaan } from "./saran-minta";

/**
 * Permintaan kiriman milik SATU toko, untuk layar stok SPG.
 *
 * Dibatasi per toko, bukan per SPG: toko dengan dua SPG berbagi rak yang sama,
 * jadi yang satu perlu tahu barang apa yang sudah diminta yang lain — supaya
 * tidak meminta dua kali.
 */

export type PermintaanToko = {
  id: string;
  status: StatusPermintaan;
  peminta: string;
  catatan: string | null;
  /** ISO — diformat di server component, bukan di klien. */
  dibuat: string;
  /** Jawaban kantor/salesman; untuk DITOLAK inilah alasannya. */
  catatanKantor: string | null;
  ditanganiPada: string | null;
  /** Nama yang terakhir memutuskan (orang kantor atau salesman pemegang toko). */
  ditanganiOleh: string | null;
  /** Pesanan yang dibuatkan salesman dari permintaan ini — nomornya saja, tanpa nilai. */
  pesanan: { orderNo: string } | null;
  baris: { productName: string; variantSku: string; qty: number; alasan: AlasanPermintaan | null }[];
  totalQty: number;
};

export const BATAS_PERMINTAAN_TOKO = 20;

export async function permintaanToko(storeId: string, batas = BATAS_PERMINTAAN_TOKO): Promise<PermintaanToko[]> {
  const rows = await prisma.stockRequest.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: batas,
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      requestedById: true,
      handledById: true,
      handledAt: true,
      handleNote: true,
      fieldSalesOrderId: true,
      lines: { select: { productName: true, variantSku: true, qty: true, alasan: true }, orderBy: { productName: "asc" } },
    },
  });

  const idOrang = [...new Set(rows.flatMap((r) => [r.requestedById, ...(r.handledById ? [r.handledById] : [])]))];
  const idPesanan = [...new Set(rows.flatMap((r) => (r.fieldSalesOrderId ? [r.fieldSalesOrderId] : [])))];
  const [users, pesanan] = await Promise.all([
    idOrang.length ? prisma.user.findMany({ where: { id: { in: idOrang } }, select: { id: true, name: true, email: true } }) : [],
    idPesanan.length ? prisma.fieldSalesOrder.findMany({ where: { id: { in: idPesanan } }, select: { id: true, orderNo: true } }) : [],
  ]);
  const nama = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const noPesanan = new Map(pesanan.map((p) => [p.id, p.orderNo]));

  return rows.map((r) => {
    const orderNo = r.fieldSalesOrderId ? noPesanan.get(r.fieldSalesOrderId) : undefined;
    return {
      id: r.id,
      status: r.status,
      peminta: nama.get(r.requestedById) ?? "—",
      catatan: r.note,
      dibuat: r.createdAt.toISOString(),
      catatanKantor: r.handleNote,
      ditanganiPada: r.handledAt ? r.handledAt.toISOString() : null,
      ditanganiOleh: r.handledById ? (nama.get(r.handledById) ?? null) : null,
      pesanan: orderNo ? { orderNo } : null,
      baris: r.lines.map((l) => ({ productName: l.productName, variantSku: l.variantSku, qty: l.qty, alasan: bacaAlasan(l.alasan) })),
      totalQty: r.lines.reduce((n, l) => n + l.qty, 0),
    };
  });
}
