import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar barang ke toko SPG, per jalur:
 * - Jalur SATU LANGKAH — pengiriman putus yang dicatat tangan dan kirim titipan konsinyasi —
 *   tetap satu kabar (`kabarkanKirimanBerangkat`) saat dicatat.
 * - Pengiriman DUA TAHAP — dua kabar per pengiriman: saat BERANGKAT ("Kirim" di menu Pengiriman,
 *   status Dalam Perjalanan; BUKAN mengemas) dan saat DISERAHKAN (penyelesaian dari kantor maupun
 *   HP pembawa), putus maupun konsi. Persetujuan pesanan konsi TIDAK mengabari: ia hanya
 *   mencadangkan stok.
 * - Pengiriman KONSI yang selesai memicu jurnal pindah barang konsinyasi
 *   (`kaitPindahKonsiPengiriman`) sesudah commit, di setiap cabangnya.
 * Yang diuji di sini hanya KAITANNYA — dipanggil sesudah sukses, dengan dokumen dan pelaku yang
 * benar, dan tidak dipanggil saat aksinya gagal. Sekali-per-dokumen dan penerimanya diuji di
 * `lib/spg/pesanan-menuju-toko.test.ts` dan `lib/spg/kabar-pengiriman.test.ts` terhadap basis data
 * sungguhan.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kabarkan: vi.fn(async () => ({ penerima: 0 })),
  berangkat: vi.fn(async () => ({ penerima: 0 })),
  diserahkan: vi.fn(async () => ({ penerima: 0 })),
  kaitKonsi: vi.fn(async () => {}),
  recordDelivery: vi.fn(),
  approve: vi.fn(),
  kirimTitipan: vi.fn(),
  deliveryLookup: vi.fn(async () => null),
  completeShipment: vi.fn(),
  shipShipment: vi.fn(),
  createShipment: vi.fn(),
  shipmentLookup: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/spg/pesanan-menuju-toko", () => ({ kabarkanKirimanBerangkat: h.kabarkan }));
vi.mock("@/lib/spg/kabar-pengiriman", () => ({
  kabarkanPengirimanBerangkat: h.berangkat,
  kabarkanPengirimanDiserahkan: h.diserahkan,
}));
vi.mock("@/lib/finance/operasional/kait", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  kaitPindahKonsiPengiriman: h.kaitKonsi,
}));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_DIKIRIM: "PESANAN_DIKIRIM", PESANAN_DITUTUP: "PESANAN_DITUTUP" },
  kabariPengguna: vi.fn(),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/app/actions/audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: {
    fieldSalesDelivery: { findUnique: h.deliveryLookup },
    fieldSalesOrder: { findUnique: vi.fn(async () => null) },
    deliveryShipment: { findUnique: h.shipmentLookup },
  },
}));
vi.mock("@/lib/delivery/shipment-writer", () => ({
  createDeliveryShipment: h.createShipment,
  updateShipmentTracking: vi.fn(),
  reassignShipmentCarrier: vi.fn(),
  shipDeliveryShipment: h.shipShipment,
  completeDeliveryShipment: h.completeShipment,
  cancelDeliveryShipment: vi.fn(),
}));
vi.mock("@/lib/delivery/shipment-queries", () => ({
  listDeliveryShipments: vi.fn(),
  getDeliveryShipment: vi.fn(),
  listMyDeliveries: vi.fn(),
}));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: vi.fn(async () => {}) }));
vi.mock("@/lib/finance/ar/delivery-journal", () => ({
  postFieldDeliveryRevenueJournal: vi.fn(),
  postFieldDeliveryCogsJournal: vi.fn(),
}));
vi.mock("@/lib/field-sales/delivery/writer", () => ({
  recordFieldSalesDelivery: h.recordDelivery,
  closeFieldSalesOrderRemainder: vi.fn(),
}));
vi.mock("@/lib/field-sales/writer", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/field-sales/writer")>()),
  approveFieldSalesOrder: h.approve,
}));
vi.mock("@/lib/konsinyasi/writer", () => ({ kirimTitipan: h.kirimTitipan }));
vi.mock("@/lib/konsinyasi/laporan-spg", () => ({ bahanLaporanSpg: vi.fn() }));
vi.mock("@/lib/konsinyasi/varian-kirim", () => ({ pilihanVarianKirim: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => ({})) }));

import { recordDeliveryAction } from "./field-sales-deliveries";
import { approveFieldSalesOrderAction } from "./field-sales-orders";
import { kirimTitipanAction } from "./konsinyasi";
import { completeShipmentAction, createShipmentAction, shipShipmentAction } from "./delivery-shipments";
import { completePodAction } from "@/app/pwa/deliveries/actions";
import { DeliveryShipmentError } from "@/lib/delivery/errors";
import { DeliveryError } from "@/lib/field-sales/errors";
import { InvalidOrderTransitionError } from "@/lib/field-sales/errors";

const KANTOR = "kantor-1";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["*"] } });
});

describe("pengiriman putus", () => {
  const isian = {
    orderId: "order-1",
    lines: [{ orderLineId: "line-1", qty: 2 }],
    invoiceDate: "2026-10-06",
    dueDate: "2026-11-05",
    idempotencyKey: "kunci-1",
  };

  it("a recorded delivery tells the store's SPG about that delivery", async () => {
    h.recordDelivery.mockResolvedValue({ deliveryId: "dlv-1", docNo: "DLV/2026/10/0001" });
    expect(await recordDeliveryAction(isian)).toEqual({ ok: true });
    expect(h.kabarkan).toHaveBeenCalledTimes(1);
    expect(h.kabarkan).toHaveBeenCalledWith({ sourceType: "PUTUS_DELIVERY", sourceId: "dlv-1", pelakuId: KANTOR });
  });

  it("a refused delivery tells no one", async () => {
    h.recordDelivery.mockRejectedValue(new DeliveryError("OVER_DELIVER"));
    expect(await recordDeliveryAction(isian)).toMatchObject({ ok: false, reason: "OVER_DELIVER" });
    expect(h.kabarkan).not.toHaveBeenCalled();
  });
});

describe("persetujuan pesanan", () => {
  it("an approval tells no one — a konsi approval only reserves; the goods leave when its shipment completes", async () => {
    h.approve.mockResolvedValue({ ok: true });
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: true });
    expect(h.kabarkan).not.toHaveBeenCalled();
  });

  it("a refused approval tells no one", async () => {
    h.approve.mockRejectedValue(new InvalidOrderTransitionError("REJECTED", "APPROVED"));
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    expect(h.kabarkan).not.toHaveBeenCalled();
  });
});

describe("pengiriman berangkat", () => {
  it("'Kirim' in the Pengiriman menu (IN_TRANSIT) tells the store's SPG about that shipment", async () => {
    h.shipShipment.mockResolvedValue({ ok: true });
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toEqual({ ok: true });
    expect(h.berangkat).toHaveBeenCalledTimes(1);
    expect(h.berangkat).toHaveBeenCalledWith({ shipmentId: "shp-1", pelakuId: KANTOR });
    expect(h.diserahkan).not.toHaveBeenCalled();
    expect(h.kabarkan).not.toHaveBeenCalled();
  });

  it("a refused 'Kirim' tells no one", async () => {
    h.shipShipment.mockRejectedValue(new DeliveryShipmentError("MISSING_RESI"));
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toMatchObject({ ok: false, reason: "MISSING_RESI" });
    expect(h.berangkat).not.toHaveBeenCalled();
  });

  it("packing a shipment ('Kirim' in the Buat Pengiriman Barang dialog) tells no one — nothing has left yet", async () => {
    h.createShipment.mockResolvedValue({ shipmentId: "shp-2" });
    expect(
      await createShipmentAction({ orderId: "order-1", method: "SALESMAN_CARRY", lines: [{ orderLineId: "line-1", qty: 2 }] }),
    ).toEqual({ ok: true, shipmentId: "shp-2" });
    expect(h.berangkat).not.toHaveBeenCalled();
    expect(h.diserahkan).not.toHaveBeenCalled();
    expect(h.kabarkan).not.toHaveBeenCalled();
  });
});

describe("penyelesaian pengiriman", () => {
  const selesai = (deliveredQty: number) => ({
    shipmentId: "shp-1",
    proofPhotoUrl: "https://bukti/foto.jpg",
    proofPhotoR2Key: "delivery-proofs/shp-1/1.jpg",
    lines: [{ shipmentLineId: "sl-1", deliveredQty }],
  });
  const selesaiHp = (deliveredQty: number) => ({ ...selesai(deliveredQty), gps: { lat: -6.2, lng: 106.8 } });
  const konsiSelesai = { status: "DELIVERED", order: { orderType: "KONSI" } };

  it("a completed PUTUS shipment tells the store's SPG it was handed over, on the shipment, with its delivery", async () => {
    h.completeShipment.mockResolvedValue({ ok: true, deliveryId: "dlv-7" });
    expect(await completeShipmentAction(selesai(2))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledTimes(1);
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: "dlv-7", pelakuId: KANTOR });
    // Bukan lagi kabar satu-langkah per nota: pengiriman dua tahap dikabarkan per pengiriman.
    expect(h.kabarkan).not.toHaveBeenCalled();
    expect(h.kaitKonsi).not.toHaveBeenCalled();
  });

  it("a completed KONSI shipment tells the SPG about that shipment and posts its consignment move journal", async () => {
    h.completeShipment.mockResolvedValue({ ok: true, deliveryId: "" });
    h.shipmentLookup.mockResolvedValue(konsiSelesai);
    expect(await completeShipmentAction(selesai(2))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: null, pelakuId: KANTOR });
    expect(h.kaitKonsi).toHaveBeenCalledTimes(1);
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-1", KANTOR);
    expect(h.kabarkan).not.toHaveBeenCalled();
  });

  it("the carrier's phone completion of a KONSI shipment does the same", async () => {
    h.completeShipment.mockResolvedValue({ ok: true, deliveryId: "" });
    h.shipmentLookup.mockResolvedValue({ status: "PARTIALLY_DELIVERED", order: { orderType: "KONSI" } });
    expect(await completePodAction(selesaiHp(3))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: null, pelakuId: KANTOR });
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-1", KANTOR);
  });

  it("a shipment that delivered nothing still reaches the notifier — it tells the SPG nothing was handed over", async () => {
    h.completeShipment.mockResolvedValue({ ok: true, deliveryId: "" });
    h.shipmentLookup.mockResolvedValue({ status: "PARTIALLY_DELIVERED", order: { orderType: "KONSI" } });
    expect(await completeShipmentAction(selesai(0))).toEqual({ ok: true });
    expect(await completePodAction(selesaiHp(0))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledTimes(2);
    expect(h.kabarkan).not.toHaveBeenCalled();
  });

  it("a refused completion tells no one; the konsi journal hook still runs for a shipment an earlier attempt completed", async () => {
    h.completeShipment.mockRejectedValue(new DeliveryShipmentError("INVALID_STATE"));
    h.shipmentLookup.mockResolvedValue({ status: "IN_TRANSIT", order: { orderType: "KONSI" } });
    expect(await completeShipmentAction(selesai(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(await completePodAction(selesaiHp(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(h.diserahkan).not.toHaveBeenCalled();
    expect(h.kabarkan).not.toHaveBeenCalled();
    expect(h.kaitKonsi).not.toHaveBeenCalled();

    h.shipmentLookup.mockResolvedValue(konsiSelesai);
    expect(await completeShipmentAction(selesai(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(await completePodAction(selesaiHp(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(h.diserahkan).not.toHaveBeenCalled();
    expect(h.kaitKonsi).toHaveBeenCalledTimes(2);
  });

  it("a refused PUTUS replay whose delivery is real still tells the SPG, with that delivery", async () => {
    const replay = { deliveryId: "dlv-9", docNo: "DLV/9", invoiceDate: new Date(), dueDate: new Date(), lines: [] };
    h.completeShipment.mockRejectedValue(new DeliveryError("REPLAY_MISMATCH", [], replay));
    expect(await completeShipmentAction(selesai(2))).toMatchObject({ ok: false, reason: "REPLAY_MISMATCH" });
    expect(await completePodAction(selesaiHp(2))).toMatchObject({ ok: false, reason: "REPLAY_MISMATCH" });
    expect(h.diserahkan).toHaveBeenCalledTimes(2);
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: "dlv-9", pelakuId: KANTOR });
    expect(h.kaitKonsi).not.toHaveBeenCalled();
  });
});

describe("kirim titipan konsinyasi", () => {
  const isian = {
    storeId: "toko-1",
    shippedAt: "2026-10-06",
    items: [{ itemId: "i1", variantSku: "B-M", itemName: "Blus", qty: 5, price: 100_000 }],
    idempotencyKey: "kirim-1",
  };

  it("a shipment, first or resent, is passed on — the once-per-document rule lives in the notifier", async () => {
    h.kirimTitipan.mockResolvedValue({ ok: true, id: "krm-1", noKirim: "KRM/001", ulang: false, barangBerubah: [] });
    expect(await kirimTitipanAction(isian)).toMatchObject({ ok: true });
    expect(h.kabarkan).toHaveBeenCalledWith({ sourceType: "KONSI_SHIPMENT", sourceId: "krm-1", pelakuId: KANTOR });
  });

  it("a refused shipment tells no one", async () => {
    h.kirimTitipan.mockResolvedValue({ ok: false, alasan: "TANPA_BARIS" });
    expect(await kirimTitipanAction(isian)).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(h.kabarkan).not.toHaveBeenCalled();
  });
});
