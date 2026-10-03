import { prisma } from "@elorae/db";
import { batasAwalTerima, keadaanBuktiTerima, type KeadaanBuktiTerima } from "./bukti-terima";

export type KirimanBuktiTerima = {
  id: string;
  docNo: string;
  deliveredAt: Date;
  pcs: number;
  /** Waktu paling awal yang boleh diisi sebagai jam terima (lihat `batasAwalTerima`). */
  batasAwal: Date;
  keadaan: KeadaanBuktiTerima;
  receivedByName: string | null;
  receivedAt: Date | null;
  podPhotoUrl: string | null;
};

/**
 * Pengiriman satu pesanan beserta bukti terimanya, HANYA bila pesanan itu
 * milik salesman ini — pesanan orang lain menghasilkan daftar kosong, sama
 * dengan pesanan yang belum pernah dikirim.
 */
export async function kirimanPesananSaya(orderId: string, salesmanId: string): Promise<KirimanBuktiTerima[]> {
  const rows = await prisma.fieldSalesDelivery.findMany({
    where: { orderId, order: { salesmanId } },
    orderBy: { deliveredAt: "asc" },
    select: {
      id: true,
      docNo: true,
      deliveredAt: true,
      invoiceDate: true,
      createdAt: true,
      receivedByName: true,
      receivedAt: true,
      podPhotoUrl: true,
      lines: { select: { qty: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    deliveredAt: r.deliveredAt,
    pcs: r.lines.reduce((n, l) => n + l.qty, 0),
    batasAwal: batasAwalTerima(r),
    keadaan: keadaanBuktiTerima(r),
    receivedByName: r.receivedByName,
    receivedAt: r.receivedAt,
    podPhotoUrl: r.podPhotoUrl,
  }));
}
