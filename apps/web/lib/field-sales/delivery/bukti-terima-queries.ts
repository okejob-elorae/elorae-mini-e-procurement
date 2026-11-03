import { prisma } from "@elorae/db";
import { STATUS_PENGIRIMAN_BERANGKAT } from "@/lib/spg/kiriman";
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
 *
 * Hanya nota yang boleh diberi bukti terima (R23, aturan yang sama dengan
 * `catatBuktiTerima`): nota sebuah pengiriman setelah barangnya BERANGKAT, atau
 * nota lama yang dicatat tangan (tanpa pengiriman). Nota yang dibatalkan, dan
 * nota yang pengirimannya masih dikemas atau dibatalkan, tidak tampil — HP tidak
 * menawarkan bukti terima yang akan ditolak.
 */
export async function kirimanPesananSaya(orderId: string, salesmanId: string): Promise<KirimanBuktiTerima[]> {
  const rows = await prisma.fieldSalesDelivery.findMany({
    where: {
      orderId,
      order: { salesmanId },
      voidedAt: null,
      OR: [{ shipment: { is: null } }, { shipment: { is: { status: { in: [...STATUS_PENGIRIMAN_BERANGKAT] } } } }],
    },
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
