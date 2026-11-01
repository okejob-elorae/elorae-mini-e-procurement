import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { teksPembawa } from "./antaran";
import type { JenisKiriman } from "./kiriman";

/**
 * Dua kabar ke SPG toko untuk SATU pengiriman (`DeliveryShipment`), toko putus
 * maupun konsinyasi (keputusan pemilik 2026-11-01):
 *
 * 1. BERANGKAT — saat "Kirim" di menu Pengiriman / Ubah Pelacakan memindahkan
 *    pengiriman ke Dalam Perjalanan (BUKAN "Kirim" di jendela "Buat Pengiriman
 *    Barang", yang hanya mengemas): "Barang sedang dalam perjalanan ke toko
 *    Anda · N pcs · dibawa <pengantar> / <ekspedisi> resi <resi>". Dikunci pada
 *    PENGIRIMANNYA — nota pengiriman putus belum ada saat barang berangkat.
 * 2. DISERAHKAN — saat pengiriman selesai di toko: "Barang sudah diserahkan ·
 *    N pcs · silakan hitung dan terima", N = yang benar-benar diserahkan di
 *    pengiriman ITU (konsinyasi juga per antaran). Pengiriman 0 pcs memberi
 *    tahu bahwa tidak ada barang yang diserahkan.
 *
 * Jalur satu langkah (pengiriman putus dicatat kantor, titipan konsinyasi)
 * tetap satu kabar — `kabarkanKirimanBerangkat` di `pesanan-menuju-toko.ts`.
 *
 * Tanpa rupiah sama sekali, dan kuerinya tidak memilih kolom harga. Toko tanpa
 * SPG tidak dikabari dan tidak menulis apa pun. Sekali per pengiriman per
 * kabar: penandanya (`AuditLog`) ditulis di `runSerializable` sebelum kabar
 * dikirim, jadi kiriman ulang, penyelesaian ulang oleh pelaku yang sama, atau
 * dua panggilan bersamaan hanya menghasilkan satu kabar per SPG. Dipanggil
 * SESUDAH transaksinya selesai, dan tidak pernah melempar.
 */

/** Penanda "sudah dikabarkan" di `AuditLog`, satu per pengiriman per kabar. */
export const JEJAK_PENGIRIMAN_BERANGKAT = "STORE_SHIPMENT_DEPARTED_NOTIFIED";
export const JEJAK_PENGIRIMAN_DISERAHKAN = "STORE_SHIPMENT_HANDED_OVER_NOTIFIED";
const ENTITAS = "DeliveryShipment";

export type HasilKabarPengiriman = { penerima: number };

const KOSONG: HasilKabarPengiriman = { penerima: 0 };

function sah(x: unknown): x is string {
  return typeof x === "string" && x.trim() !== "";
}

async function spgToko(storeId: string, pelakuId: string): Promise<{ id: string }[]> {
  return prisma.user.findMany({ where: { assignedStoreId: storeId, id: { not: pelakuId } }, select: { id: true }, orderBy: { id: "asc" } });
}

/** Tulis penandanya sekali; false kalau pengiriman ini sudah pernah dikabarkan. */
async function tandaiSekali(action: string, shipmentId: string, pelakuId: string, metadata: Record<string, string | number | boolean>) {
  return runSerializable(async (tx) => {
    const ada = await tx.auditLog.findFirst({ where: { entityType: ENTITAS, entityId: shipmentId, action }, select: { id: true } });
    if (ada) return false;
    await tx.auditLog.create({ data: { userId: pelakuId, action, entityType: ENTITAS, entityId: shipmentId, metadata: { ...metadata, otomatis: true } } });
    return true;
  });
}

async function kirimKeSemua(
  spg: { id: string }[],
  kabar: { jenis: "KIRIMAN_BERANGKAT" | "KIRIMAN_DISERAHKAN"; judul: string; isi: string; data: Record<string, string> },
) {
  // Dimuat di sini: halaman yang hanya membaca tidak perlu ikut memuat Firebase Admin.
  const { JENIS_KABAR, kabariPengguna } = await import("@/lib/notifications/kabar-pengguna");
  for (const s of spg) {
    await kabariPengguna(s.id, { jenis: JENIS_KABAR[kabar.jenis], judul: kabar.judul, isi: kabar.isi, data: kabar.data });
  }
}

/** Murni: isi kabar berangkat. */
export function susunKabarBerangkat(p: {
  docNo: string;
  pcs: number;
  cara: "EXPEDITION" | "SALESMAN_CARRY";
  pengantar: string | null;
  ekspedisi: string | null;
  resi: string | null;
}): { judul: string; isi: string } {
  const pembawa = teksPembawa(p);
  return {
    judul: "Barang sedang dalam perjalanan ke toko Anda",
    isi:
      `${p.pcs} pcs` +
      (pembawa ? ` · dibawa ${pembawa}` : "") +
      ` · pengiriman ${p.docNo}. Hitung dan terima setelah barangnya diserahkan di toko.`,
  };
}

/** Murni: isi kabar diserahkan; `pcs` 0 = tidak ada barang yang diserahkan. */
export function susunKabarDiserahkan(p: { docNo: string; pcs: number }): { judul: string; isi: string } {
  if (p.pcs <= 0) {
    return {
      judul: "Tidak ada barang yang diserahkan",
      isi: `Pengiriman ${p.docNo} selesai tanpa barang yang diserahkan ke toko. Tidak ada yang perlu diterima.`,
    };
  }
  return {
    judul: "Barang sudah diserahkan",
    isi: `${p.pcs} pcs · silakan hitung dan terima di menu Terima kiriman · pengiriman ${p.docNo}.`,
  };
}

/** Kabar 1: pengiriman baru BERANGKAT (Dalam Perjalanan). */
export async function kabarkanPengirimanBerangkat(input: { shipmentId: string; pelakuId: string }): Promise<HasilKabarPengiriman> {
  const { shipmentId, pelakuId } = input;
  if (!sah(shipmentId) || !sah(pelakuId)) return KOSONG;
  try {
    const s = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: {
        docNo: true,
        status: true,
        method: true,
        carrierName: true,
        resiNumber: true,
        carriedBy: { select: { name: true } },
        order: { select: { storeId: true } },
        lines: { select: { plannedQty: true } },
      },
    });
    // Hanya yang sedang di jalan: pengiriman yang sudah selesai mendapat kabar "diserahkan".
    if (!s || s.status !== "IN_TRANSIT") return KOSONG;
    const pcs = s.lines.reduce((n, l) => n + Math.max(0, l.plannedQty), 0);
    if (pcs <= 0) return KOSONG;
    const storeId = s.order.storeId;
    const spg = await spgToko(storeId, pelakuId);
    if (spg.length === 0) return KOSONG;
    if (!(await tandaiSekali(JEJAK_PENGIRIMAN_BERANGKAT, shipmentId, pelakuId, { storeId, docNo: s.docNo, pcs, penerima: spg.length }))) {
      return KOSONG;
    }
    const isi = susunKabarBerangkat({
      docNo: s.docNo,
      pcs,
      cara: s.method,
      pengantar: s.carriedBy?.name ?? null,
      ekspedisi: s.carrierName,
      resi: s.resiNumber,
    });
    await kirimKeSemua(spg, { jenis: "KIRIMAN_BERANGKAT", ...isi, data: { storeId, shipmentId } });
    return { penerima: spg.length };
  } catch (err) {
    console.error("[kabar] pengiriman berangkat gagal", shipmentId, err);
    return KOSONG;
  }
}

/**
 * Kabar 2: pengiriman DISERAHKAN di toko. `deliveryId` diteruskan pemanggil
 * untuk penyelesaian putus yang ditolak sebagai kiriman ulang berbeda
 * (`REPLAY_MISMATCH`): notanya nyata dan barangnya sudah diserahkan, walau
 * pengirimannya masih tercatat di jalan.
 */
export async function kabarkanPengirimanDiserahkan(input: {
  shipmentId: string;
  pelakuId: string;
  deliveryId?: string | null;
}): Promise<HasilKabarPengiriman> {
  const { shipmentId, pelakuId } = input;
  if (!sah(shipmentId) || !sah(pelakuId)) return KOSONG;
  try {
    const s = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: {
        docNo: true,
        status: true,
        deliveryId: true,
        order: { select: { storeId: true, orderType: true } },
        lines: { select: { deliveredQty: true } },
        konsiTransfer: { select: { id: true, lines: { select: { qty: true } } } },
      },
    });
    if (!s) return KOSONG;
    const storeId = s.order.storeId;
    const selesai = s.status === "DELIVERED" || s.status === "PARTIALLY_DELIVERED";

    // Dokumen yang akan diterima SPG, dan jumlah yang benar-benar diserahkan di pengiriman ini.
    let sumber: { sourceType: JenisKiriman; sourceId: string } | null = null;
    let pcs = 0;
    if (s.order.orderType === "KONSI") {
      if (s.konsiTransfer) {
        sumber = { sourceType: "KONSI_TRANSFER", sourceId: s.konsiTransfer.id };
        pcs = s.konsiTransfer.lines.reduce((n, l) => n + Math.max(0, Math.round(Number(l.qty))), 0);
      }
    } else {
      const deliveryId = sah(input.deliveryId) ? input.deliveryId : s.deliveryId;
      if (deliveryId) {
        const d = await prisma.fieldSalesDelivery.findFirst({
          where: { id: deliveryId, order: { storeId } },
          select: { id: true, lines: { select: { qty: true } } },
        });
        if (d) {
          sumber = { sourceType: "PUTUS_DELIVERY", sourceId: d.id };
          pcs = d.lines.reduce((n, l) => n + Math.max(0, l.qty), 0);
        }
      }
    }
    if (!sumber) {
      // Tanpa dokumen: hanya pengiriman yang benar-benar selesai tanpa satu potong pun diserahkan.
      if (!selesai || s.lines.some((l) => (l.deliveredQty ?? 0) > 0)) return KOSONG;
      pcs = 0;
    } else {
      // Kiriman yang sudah dihitung SPG tidak dikabarkan lagi.
      const sudah = await prisma.storeReceipt.findUnique({
        where: { sourceType_sourceId: { sourceType: sumber.sourceType, sourceId: sumber.sourceId } },
        select: { id: true },
      });
      if (sudah) return KOSONG;
    }

    const spg = await spgToko(storeId, pelakuId);
    if (spg.length === 0) return KOSONG;
    if (!(await tandaiSekali(JEJAK_PENGIRIMAN_DISERAHKAN, shipmentId, pelakuId, { storeId, docNo: s.docNo, pcs, penerima: spg.length }))) {
      return KOSONG;
    }
    const isi = susunKabarDiserahkan({ docNo: s.docNo, pcs });
    await kirimKeSemua(spg, {
      jenis: "KIRIMAN_DISERAHKAN",
      ...isi,
      data: { storeId, shipmentId, ...(sumber && pcs > 0 ? { sourceType: sumber.sourceType, sourceId: sumber.sourceId } : {}) },
    });
    return { penerima: spg.length };
  } catch (err) {
    console.error("[kabar] pengiriman diserahkan gagal", shipmentId, err);
    return KOSONG;
  }
}
