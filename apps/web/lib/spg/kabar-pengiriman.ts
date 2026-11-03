import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { rangkaiDalamBatas, teksPembawa } from "./antaran";
import type { JenisKiriman } from "./kiriman";

/**
 * Tiga kabar ke SPG toko untuk SATU pengiriman (`DeliveryShipment`), toko putus
 * maupun konsinyasi (keputusan pemilik 2026-11-01; kabar ketiga Q24):
 *
 * 1. BERANGKAT — saat "Kirim" di menu Pengiriman / Ubah Pelacakan memindahkan
 *    pengiriman ke Dalam Perjalanan (BUKAN "Kirim" di jendela "Buat Pengiriman
 *    Barang", yang hanya mengemas): "Barang sedang dalam perjalanan ke toko
 *    Anda · N pcs · dibawa <pengantar> / <ekspedisi> resi <resi>". Dikunci pada
 *    PENGIRIMANNYA — nota pengiriman putus belum ada saat barang berangkat.
 * 2. DISERAHKAN — saat pengiriman selesai di toko: "Barang sudah diserahkan ·
 *    N pcs · silakan hitung dan terima", N = yang benar-benar diserahkan di
 *    pengiriman ITU (`DeliveryShipmentLine.deliveredQty`, konsinyasi juga per
 *    antaran). Pengiriman 0 pcs memberi tahu bahwa tidak ada barang yang
 *    diserahkan.
 * 3. DIBATALKAN — pengiriman yang sudah berangkat lalu "tidak jadi dikirim":
 *    "Pengiriman dibatalkan · N pcs · tidak ada yang perlu Anda terima".
 *    Pengiriman yang dibatalkan sebelum berangkat tidak pernah dikabarkan.
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
export const JEJAK_PENGIRIMAN_DIBATALKAN = "STORE_SHIPMENT_CANCELLED_NOTIFIED";
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
  kabar: { jenis: "KIRIMAN_BERANGKAT" | "KIRIMAN_DISERAHKAN" | "KIRIMAN_DIBATALKAN"; judul: string; isi: string; data: Record<string, string> },
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
        konsiTransfer: { select: { id: true } },
      },
    });
    if (!s) return KOSONG;
    const storeId = s.order.storeId;
    const selesai = s.status === "DELIVERED" || s.status === "PARTIALLY_DELIVERED";

    // Dokumen yang akan diterima SPG, dan jumlah yang benar-benar diserahkan di pengiriman ini.
    // Yang diserahkan = yang dicatat ekspedisi/kurir di baris pengiriman ini; dokumennya
    // (nota / surat jalan) sudah ada sejak pengiriman dibuat dan bisa lebih besar.
    let sumber: { sourceType: JenisKiriman; sourceId: string } | null = null;
    const pcs = s.lines.reduce((n, l) => n + Math.max(0, l.deliveredQty ?? 0), 0);
    if (s.order.orderType === "KONSI") {
      if (s.konsiTransfer) sumber = { sourceType: "KONSI_TRANSFER", sourceId: s.konsiTransfer.id };
    } else {
      const deliveryId = sah(input.deliveryId) ? input.deliveryId : s.deliveryId;
      if (deliveryId) {
        const d = await prisma.fieldSalesDelivery.findFirst({
          where: { id: deliveryId, order: { storeId } },
          select: { id: true },
        });
        if (d) sumber = { sourceType: "PUTUS_DELIVERY", sourceId: d.id };
      }
    }
    if (!selesai) return KOSONG;
    if (sumber) {
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

/** Murni: isi kabar dibatalkan (Q24). Tanpa rupiah; muat dalam 191 huruf. */
export function susunKabarDibatalkan(p: { docNo: string; pcs: number }): { judul: string; isi: string } {
  return {
    judul: "Pengiriman dibatalkan",
    isi: rangkaiDalamBatas(
      [
        `${p.pcs} pcs · pengiriman ${p.docNo} tidak jadi dikirim.`,
        "Barang kembali ke gudang — tidak ada yang perlu Anda terima.",
      ],
      191,
    ),
  };
}

/**
 * Kabar 3: pengiriman yang SUDAH BERANGKAT "tidak jadi dikirim" (Q24). Hanya
 * untuk pengiriman berstatus CANCELLED yang punya `shippedAt`; sekali per
 * pengiriman lewat penanda `STORE_SHIPMENT_CANCELLED_NOTIFIED`; toko tanpa SPG
 * tidak dikabari. Tidak pernah melempar.
 */
export async function kabarkanPengirimanDibatalkan(input: { shipmentId: string; pelakuId: string }): Promise<HasilKabarPengiriman> {
  const { shipmentId, pelakuId } = input;
  if (!sah(shipmentId) || !sah(pelakuId)) return KOSONG;
  try {
    const s = await prisma.deliveryShipment.findUnique({
      where: { id: shipmentId },
      select: { docNo: true, status: true, shippedAt: true, order: { select: { storeId: true } }, lines: { select: { plannedQty: true } } },
    });
    if (!s || s.status !== "CANCELLED" || !s.shippedAt) return KOSONG;
    const pcs = s.lines.reduce((n, l) => n + Math.max(0, l.plannedQty), 0);
    const storeId = s.order.storeId;
    const spg = await spgToko(storeId, pelakuId);
    if (spg.length === 0) return KOSONG;
    if (!(await tandaiSekali(JEJAK_PENGIRIMAN_DIBATALKAN, shipmentId, pelakuId, { storeId, docNo: s.docNo, pcs, penerima: spg.length }))) {
      return KOSONG;
    }
    const isi = susunKabarDibatalkan({ docNo: s.docNo, pcs });
    await kirimKeSemua(spg, { jenis: "KIRIMAN_DIBATALKAN", ...isi, data: { storeId, shipmentId } });
    return { penerima: spg.length };
  } catch (err) {
    console.error("[kabar] pengiriman dibatalkan gagal", shipmentId, err);
    return KOSONG;
  }
}
