import { prisma, type Prisma } from "@elorae/db";
import { sisaPesanan, type InfoAntaran } from "./antaran";
import type { JenisKiriman } from "./kiriman";

/**
 * Pemuat antaran dan pesanan konsinyasi lama. Aturannya di `antaran.ts`.
 *
 * Barang konsinyasi diterima SPG PER ANTARAN (keputusan pemilik 2026-11-01):
 * satu tanda terima per `KonsiTransfer` yang dibuat saat pengiriman DIBUAT dan
 * masih di perjalanan (`StoreReceipt.sourceType = "KONSI_TRANSFER"`). Pesanan yang disetujui tidak
 * membuka apa pun untuk diterima — persetujuan hanya mencadangkan stok.
 *
 * PESANAN KONSI LAMA: disetujui dengan aturan lama, saat stok keluar gudang
 * SAAT DISETUJUI dan tidak ada pengiriman. Pesanan itu tetap diterima sekali
 * per pesanan (`KONSI_ORDER`), supaya yang dulu bisa diterima tidak menjadi
 * tidak bisa diterima. Dikenali dari datanya sendiri, tanpa perbaikan data:
 * - tidak punya `KonsiTransfer` yang terikat pengiriman, DAN
 * - tidak satu pun barisnya punya cadangan yang masih RESERVED atau sudah
 *   RELEASED — cadangannya habis dipakai saat disetujui (CONSUMED, dengan
 *   `KonsiTransfer` tanpa pengiriman), atau pesanannya lebih tua dari cadangan
 *   stok (tanpa cadangan sama sekali).
 * Pesanan aturan baru selalu mencadangkan saat disetujui: cadangannya RESERVED
 * sampai dikirim, CONSUMED hanya lewat pengiriman (yang membuat transfer
 * berpengiriman), dan RELEASED kalau sisanya ditutup. Jadi tidak satu pun
 * pesanan aturan baru lolos sebagai pesanan lama.
 *
 * JENIS LAMA YANG LAIN — disetujui dengan aturan paling awal, cadangannya MASIH
 * RESERVED tanpa pengiriman — dikenali `bacaPesananKonsiCadanganLama`
 * (`lib/field-sales/konsi-transfer/pesanan-lama.ts`) dan diselesaikan dengan
 * konfirmasi "sudah sampai" dari toko. Cadangannya yang RESERVED membuatnya
 * gugur dari sini; begitu dikonfirmasi sampai, transfernya (tanpa pengiriman,
 * `oldOrderArrival`) juga membuatnya gugur dari sini — pesanan yang sudah habis
 * dikonfirmasi bercadangan CONSUMED dengan transfer tanpa pengiriman, persis
 * bentuk jenis ini, dan tanpa penanda itu akan diterima SPG sekali lagi.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

export type PesananKonsiLama = {
  /** Pesanan yang diterima sekali per pesanan (`KONSI_ORDER`). */
  lama: Set<string>;
  /** Bagian dari `lama` yang tidak punya `KonsiTransfer` sama sekali (sebelum transfer dicatat). */
  tanpaTransfer: Set<string>;
};

/** Dari daftar pesanan KONSI yang DISETUJUI, mana yang disetujui dengan aturan lama. */
export async function bacaPesananKonsiLama(klien: Klien, orderIds: readonly string[]): Promise<PesananKonsiLama> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const hasil: PesananKonsiLama = { lama: new Set(), tanpaTransfer: new Set() };
  if (ids.length === 0) return hasil;

  const [transfer, baris] = await Promise.all([
    klien.konsiTransfer.findMany({ where: { orderId: { in: ids } }, select: { orderId: true, shipmentId: true, oldOrderArrival: true } }),
    klien.fieldSalesOrderLine.findMany({ where: { orderId: { in: ids } }, select: { id: true, orderId: true } }),
  ]);
  // Transfer berpengiriman (aturan baru) dan transfer konfirmasi sampai (pesanan lama yang
  // cadangannya dulu ditahan) sama-sama berarti pesanan ini BUKAN jenis yang diterima per pesanan.
  const berpengiriman = new Set(transfer.filter((t) => t.shipmentId !== null || t.oldOrderArrival).map((t) => t.orderId));
  const adaTransfer = new Set(transfer.map((t) => t.orderId));
  const calon = ids.filter((id) => !berpengiriman.has(id));
  if (calon.length === 0) return hasil;

  const barisCalon = baris.filter((b) => calon.includes(b.orderId));
  const cadanganHidup =
    barisCalon.length === 0
      ? []
      : await klien.stockReservation.findMany({
          where: { fieldSalesLineId: { in: barisCalon.map((b) => b.id) }, state: { in: ["RESERVED", "RELEASED"] } },
          select: { fieldSalesLineId: true },
        });
  const barisHidup = new Set(cadanganHidup.map((r) => r.fieldSalesLineId));
  const pesananHidup = new Set(barisCalon.filter((b) => barisHidup.has(b.id)).map((b) => b.orderId));
  for (const id of calon) {
    if (pesananHidup.has(id)) continue;
    hasil.lama.add(id);
    if (!adaTransfer.has(id)) hasil.tanpaTransfer.add(id);
  }
  return hasil;
}

/** Sisa pesanan: belum dikirim gudang dan yang ada di pengiriman yang masih berjalan. */
async function sisaDariPesanan(klien: Klien, orderId: string, kecualiShipmentId: string | null) {
  const [baris, berjalan] = await Promise.all([
    klien.fieldSalesOrderLine.findMany({ where: { orderId }, select: { id: true, qty: true, deliveredQty: true, cancelledQty: true } }),
    klien.deliveryShipment.findMany({
      where: { orderId, status: { in: ["PACKED", "IN_TRANSIT"] }, ...(kecualiShipmentId ? { id: { not: kecualiShipmentId } } : {}) },
      select: { status: true, lines: { select: { orderLineId: true, plannedQty: true } } },
    }),
  ]);
  return sisaPesanan(baris, berjalan);
}

const PILIH_PENGIRIMAN = {
  id: true,
  docNo: true,
  method: true,
  carrierName: true,
  resiNumber: true,
  proofPhotoUrl: true,
  signatureUrl: true,
  weightKg: true,
  carriedBy: { select: { name: true } },
} as const;

type BarisPengiriman = {
  id: string;
  docNo: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  carrierName: string | null;
  resiNumber: string | null;
  proofPhotoUrl: string | null;
  signatureUrl: string | null;
  weightKg: Prisma.Decimal | number | null;
  carriedBy: { name: string | null } | null;
};

function bentukPengiriman(s: BarisPengiriman | null): InfoAntaran["pengiriman"] {
  if (!s) return null;
  return {
    id: s.id,
    docNo: s.docNo,
    cara: s.method,
    pengantar: s.carriedBy?.name?.trim() || null,
    ekspedisi: s.carrierName?.trim() || null,
    resi: s.resiNumber?.trim() || null,
    adaBuktiSerahTerima: Boolean(s.proofPhotoUrl?.trim() || s.signatureUrl?.trim()),
    beratKg: s.weightKg === null ? null : Number(s.weightKg),
  };
}

/**
 * Antaran sebuah kiriman yang diterima SPG: pengiriman yang membawanya dan sisa
 * pesanannya. Hanya pengiriman pesanan putus dan antaran konsinyasi; sumber lain
 * (titipan modul konsinyasi, mutasi, pesanan konsi lama) → null. Disaring ke
 * toko kirimannya. Tidak memilih satu pun kolom harga.
 */
export async function muatInfoAntaran(
  klien: Klien,
  storeId: string,
  sourceType: JenisKiriman,
  sourceId: string,
): Promise<InfoAntaran | null> {
  if (sourceType === "KONSI_TRANSFER") {
    const t = await klien.konsiTransfer.findFirst({
      where: { id: sourceId, storeId, shipmentId: { not: null } },
      select: { orderId: true, shipmentId: true, order: { select: { orderNo: true } }, shipment: { select: PILIH_PENGIRIMAN } },
    });
    if (!t) return null;
    const sisa = await sisaDariPesanan(klien, t.orderId, t.shipmentId);
    return {
      orderId: t.orderId,
      orderNo: t.order.orderNo,
      pengiriman: bentukPengiriman(t.shipment as BarisPengiriman | null),
      belumDikirimGudang: sisa.belumDikirimGudang,
      dalamPengirimanLain: sisa.dikemas + sisa.dalamPerjalanan,
    };
  }
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await klien.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId } },
      select: { orderId: true, order: { select: { orderNo: true } }, shipment: { select: PILIH_PENGIRIMAN } },
    });
    if (!d) return null;
    const shipment = d.shipment as BarisPengiriman | null;
    const sisa = await sisaDariPesanan(klien, d.orderId, shipment?.id ?? null);
    return {
      orderId: d.orderId,
      orderNo: d.order.orderNo,
      pengiriman: bentukPengiriman(shipment),
      belumDikirimGudang: sisa.belumDikirimGudang,
      dalamPengirimanLain: sisa.dikemas + sisa.dalamPerjalanan,
    };
  }
  return null;
}
