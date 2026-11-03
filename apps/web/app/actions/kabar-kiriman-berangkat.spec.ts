import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kaitan sesudah commit pada pengiriman gudang → toko (keputusan pemilik 2026-11-02):
 * - MENGEMAS ("Buat Pengiriman Barang") sudah mengeluarkan barang dari Gudang Utama: putus menerbitkan
 *   notanya (kedua jurnal nota), konsi memindahkan barang ke "dalam perjalanan" (jurnal pindah barang
 *   konsinyasi), dan stok yang keluar didorong ke Jubelio. Belum ada yang berangkat, jadi SPG toko
 *   belum dikabari.
 * - BERANGKAT ("Kirim" di menu Pengiriman, Dalam Perjalanan) dan DISERAHKAN (penyelesaian dari kantor
 *   maupun HP pembawa) masing-masing satu kabar per pengiriman.
 * - "Tidak jadi dikirim": izinnya mengikuti dokumennya (P41/P41a) — pengiriman putus yang notanya
 *   sudah terbit butuh `deliveries:cancel_nota`, konsi tetap `deliveries:ship`. Keuangan dikabari
 *   (kabar kantor dari penulis), jurnalnya diselaraskan, barang yang kembali didorong ke Jubelio, dan
 *   SPG mendapat kabar ketiga HANYA bila barangnya sudah berangkat.
 * - Persetujuan pesanan tidak mengabari siapa pun.
 * Yang diuji di sini hanya KAITANNYA — dipanggil sesudah sukses, dengan dokumen dan pelaku yang
 * benar, dan tidak dipanggil saat aksinya ditolak. Sekali-per-dokumen dan penerimanya diuji di
 * `lib/spg/kabar-pengiriman.test.ts` terhadap basis data sungguhan.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kabarkan: vi.fn(async () => ({ penerima: 0 })),
  berangkat: vi.fn(async () => ({ penerima: 0 })),
  diserahkan: vi.fn(async () => ({ penerima: 0 })),
  dibatalkan: vi.fn(async () => ({ penerima: 0 })),
  kaitKonsi: vi.fn(async () => {}),
  postAr: vi.fn(async () => {}),
  fanOut: vi.fn(async () => {}),
  pushStok: vi.fn(async () => ({})),
  sebar: vi.fn(async () => {}),
  approve: vi.fn(),
  completeShipment: vi.fn(),
  shipShipment: vi.fn(),
  createShipment: vi.fn(),
  cancelShipment: vi.fn(),
  shipmentLookup: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/spg/pesanan-menuju-toko", () => ({ kabarkanKirimanBerangkat: h.kabarkan }));
vi.mock("@/lib/spg/kabar-pengiriman", () => ({
  kabarkanPengirimanBerangkat: h.berangkat,
  kabarkanPengirimanDiserahkan: h.diserahkan,
  kabarkanPengirimanDibatalkan: h.dibatalkan,
}));
vi.mock("@/lib/spg/stok-writer", () => ({ sebarSesudahTerima: h.sebar }));
vi.mock("@/lib/finance/operasional/kait", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  kaitPindahKonsiPengiriman: h.kaitKonsi,
}));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_DIKIRIM: "PESANAN_DIKIRIM", PESANAN_DITUTUP: "PESANAN_DITUTUP" },
  kabariPengguna: vi.fn(),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: h.fanOut }));
vi.mock("@/app/actions/audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: {
    fieldSalesDelivery: { findUnique: vi.fn(async () => null) },
    fieldSalesOrder: { findUnique: vi.fn(async () => null) },
    deliveryShipment: { findUnique: h.shipmentLookup },
    konsiTransfer: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/delivery/shipment-writer", () => ({
  createDeliveryShipment: h.createShipment,
  updateShipmentTracking: vi.fn(),
  reassignShipmentCarrier: vi.fn(),
  shipDeliveryShipment: h.shipShipment,
  completeDeliveryShipment: h.completeShipment,
  cancelDeliveryShipment: h.cancelShipment,
}));
vi.mock("@/lib/delivery/shipment-queries", () => ({
  listDeliveryShipments: vi.fn(),
  getDeliveryShipment: vi.fn(),
  listMyDeliveries: vi.fn(),
}));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: h.postAr }));
vi.mock("@/lib/finance/ar/delivery-journal", () => ({
  postFieldDeliveryRevenueJournal: vi.fn(),
  postFieldDeliveryCogsJournal: vi.fn(),
}));
vi.mock("@/lib/field-sales/writer", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/field-sales/writer")>()),
  approveFieldSalesOrder: h.approve,
}));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: h.pushStok }));

import { approveFieldSalesOrderAction } from "./field-sales-orders";
import { cancelShipmentAction, completeShipmentAction, createShipmentAction, shipShipmentAction } from "./delivery-shipments";
import { completePodAction } from "@/app/pwa/deliveries/actions";
import { DeliveryShipmentError } from "@/lib/delivery/errors";
import { DeliveryError, InvalidOrderTransitionError } from "@/lib/field-sales/errors";

const KANTOR = "kantor-1";

/** Tidak ada satu pun kabar SPG yang terkirim. */
function tidakAdaKabar() {
  expect(h.kabarkan).not.toHaveBeenCalled();
  expect(h.berangkat).not.toHaveBeenCalled();
  expect(h.diserahkan).not.toHaveBeenCalled();
  expect(h.dibatalkan).not.toHaveBeenCalled();
}

/** Kedua jurnal nota putus untuk satu nota, lewat `postArJournalSafely`. */
function jurnalNota(deliveryId: string) {
  expect(h.postAr).toHaveBeenCalledWith("field_delivery_revenue", deliveryId, expect.any(Function));
  expect(h.postAr).toHaveBeenCalledWith("field_delivery_cogs", deliveryId, expect.any(Function));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["*"] } });
  h.shipmentLookup.mockResolvedValue(null);
});

describe("persetujuan pesanan", () => {
  it("an approval tells no one — the goods leave when a shipment is packed", async () => {
    h.approve.mockResolvedValue({ ok: true });
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: true });
    tidakAdaKabar();
  });

  it("a refused approval tells no one", async () => {
    h.approve.mockRejectedValue(new InvalidOrderTransitionError("REJECTED", "APPROVED"));
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    tidakAdaKabar();
  });
});

describe("mengemas pengiriman (barang keluar dari Gudang Utama)", () => {
  const isian = {
    orderId: "order-1",
    method: "SALESMAN_CARRY" as const,
    lines: [{ orderLineId: "line-1", qty: 2 }],
    idempotencyKey: "kunci-1",
  };
  const hasilPutus = {
    shipmentId: "shp-1",
    docNo: "SHP/1",
    orderType: "PUTUS",
    deliveryId: "dlv-1",
    transferId: null,
    barangKeluar: ["item-1"],
    ulang: false,
  };
  const hasilKonsi = { ...hasilPutus, shipmentId: "shp-2", docNo: "SHP/2", orderType: "KONSI", deliveryId: null, transferId: "trf-2" };

  it("a PUTUS shipment posts both journals of the nota it issued and pushes the stock that left — and tells no one", async () => {
    h.createShipment.mockResolvedValue(hasilPutus);
    expect(await createShipmentAction({ ...isian, dueDate: "2026-12-02" })).toEqual({
      ok: true,
      shipmentId: "shp-1",
      docNo: "SHP/1",
      ulang: false,
    });
    expect(h.createShipment).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-1", packedById: KANTOR, idempotencyKey: "kunci-1" }));
    jurnalNota("dlv-1");
    expect(h.kaitKonsi).not.toHaveBeenCalled();
    expect(h.pushStok).toHaveBeenCalledWith(["item-1"], expect.objectContaining({ userId: KANTOR }));
    tidakAdaKabar();
  });

  it("a KONSI shipment posts its consignment move journal, not a nota journal — and tells no one", async () => {
    h.createShipment.mockResolvedValue(hasilKonsi);
    h.shipmentLookup.mockResolvedValue({ order: { orderType: "KONSI" } });
    expect(await createShipmentAction(isian)).toMatchObject({ ok: true, shipmentId: "shp-2" });
    expect(h.kaitKonsi).toHaveBeenCalledTimes(1);
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-2", KANTOR);
    expect(h.postAr).not.toHaveBeenCalled();
    tidakAdaKabar();
  });

  it("a replay of the same dialog re-runs the idempotent journals and pushes the same stock again — the first response may have been lost before its push ran", async () => {
    h.createShipment.mockResolvedValue({ ...hasilPutus, ulang: true });
    expect(await createShipmentAction(isian)).toMatchObject({ ok: true, ulang: true });
    jurnalNota("dlv-1");
    expect(h.pushStok).toHaveBeenCalledWith(["item-1"], expect.objectContaining({ userId: KANTOR }));
    tidakAdaKabar();
  });

  it("a refused shipment posts nothing, pushes nothing and tells no one", async () => {
    h.createShipment.mockRejectedValue(new DeliveryShipmentError("MISSING_DATES"));
    expect(await createShipmentAction(isian)).toMatchObject({ ok: false, reason: "MISSING_DATES" });
    expect(h.postAr).not.toHaveBeenCalled();
    expect(h.kaitKonsi).not.toHaveBeenCalled();
    expect(h.pushStok).not.toHaveBeenCalled();
    tidakAdaKabar();
  });

  it("refuses without deliveries:ship, and without a dialog key or with a non-day due date, before the writer runs", async () => {
    h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["deliveries:cancel_nota", "deliveries:pod"] } });
    expect(await createShipmentAction(isian)).toEqual({ ok: false, reason: "FORBIDDEN" });
    h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["deliveries:ship"] } });
    expect(await createShipmentAction({ ...isian, idempotencyKey: "" })).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(await createShipmentAction({ ...isian, dueDate: "2026-02-30" })).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(h.createShipment).not.toHaveBeenCalled();
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
    h.shipShipment.mockRejectedValue(new DeliveryShipmentError("MISSING_WEIGHT"));
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toMatchObject({ ok: false, reason: "MISSING_WEIGHT" });
    tidakAdaKabar();
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
  const hasil = (deliveryId: string, podReceipt: unknown = null) => ({
    ok: true,
    deliveryId,
    transferId: deliveryId ? null : "trf-1",
    mode: "INFO_ONLY",
    podReceipt,
    barangKembali: [],
    ulang: false,
  });

  it("a completed PUTUS shipment tells the store's SPG it was handed over, with its delivery, and re-syncs the nota journals", async () => {
    h.completeShipment.mockResolvedValue(hasil("dlv-7"));
    expect(await completeShipmentAction(selesai(2))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledTimes(1);
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: "dlv-7", pelakuId: KANTOR });
    jurnalNota("dlv-7");
    expect(h.kaitKonsi).not.toHaveBeenCalled();
    expect(h.sebar).not.toHaveBeenCalled();
  });

  it("a completed KONSI shipment tells the SPG about that shipment and re-syncs its consignment move journal", async () => {
    h.completeShipment.mockResolvedValue(hasil(""));
    h.shipmentLookup.mockResolvedValue({ status: "DELIVERED", order: { orderType: "KONSI" } });
    expect(await completeShipmentAction(selesai(2))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: null, pelakuId: KANTOR });
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-1", KANTOR);
    expect(h.postAr).not.toHaveBeenCalled();
  });

  it("at a store without an SPG the completion is the store receipt, whose post-commit half runs here", async () => {
    const sesudah = { notifikasiNota: [], barangKembali: ["item-1"] };
    h.completeShipment.mockResolvedValue(
      hasil("dlv-8", { receiptId: "rcp-1", storeId: "toko-1", sourceType: "PUTUS_DELIVERY", sesudah }),
    );
    expect(await completeShipmentAction(selesai(1))).toEqual({ ok: true });
    expect(h.sebar).toHaveBeenCalledWith({
      storeId: "toko-1",
      userId: KANTOR,
      sourceType: "PUTUS_DELIVERY",
      receiptId: "rcp-1",
      sesudah,
    });
    jurnalNota("dlv-8");
  });

  it("the carrier's phone completion runs the same tail", async () => {
    h.completeShipment.mockResolvedValue(hasil(""));
    h.shipmentLookup.mockResolvedValue({ status: "PARTIALLY_DELIVERED", order: { orderType: "KONSI" } });
    expect(await completePodAction(selesaiHp(3))).toEqual({ ok: true });
    expect(h.diserahkan).toHaveBeenCalledWith({ shipmentId: "shp-1", deliveryId: null, pelakuId: KANTOR });
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-1", KANTOR);
  });

  it("a refused completion tells no one and posts nothing, from the office and from the phone", async () => {
    h.completeShipment.mockRejectedValue(new DeliveryShipmentError("INVALID_STATE"));
    h.shipmentLookup.mockResolvedValue({ status: "IN_TRANSIT", order: { orderType: "KONSI" } });
    expect(await completeShipmentAction(selesai(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });
    expect(await completePodAction(selesaiHp(2))).toMatchObject({ ok: false, reason: "INVALID_STATE" });

    const replay = { deliveryId: "dlv-9", docNo: "DLV/9", invoiceDate: new Date(), dueDate: new Date(), lines: [] };
    h.completeShipment.mockRejectedValue(new DeliveryError("REPLAY_MISMATCH", [], replay));
    expect(await completeShipmentAction(selesai(2))).toMatchObject({ ok: false, reason: "REPLAY_MISMATCH" });

    tidakAdaKabar();
    expect(h.kaitKonsi).not.toHaveBeenCalled();
    expect(h.postAr).not.toHaveBeenCalled();
    expect(h.sebar).not.toHaveBeenCalled();
  });
});

describe("tidak jadi dikirim", () => {
  const batal = { shipmentId: "shp-1", reason: "toko tutup" };
  const putusBernota = { deliveryId: "dlv-1", order: { orderType: "PUTUS" } };
  const konsi = { deliveryId: null, order: { orderType: "KONSI" } };
  const notifikasi = [{ id: "an-1" }, { id: "an-2" }];
  const hasil = (berangkat: boolean, deliveryId: string | null) => ({
    ok: true,
    orderId: "order-1",
    orderType: deliveryId ? "PUTUS" : "KONSI",
    berangkat,
    deliveryId,
    transferId: deliveryId ? null : "trf-1",
    barangKembali: ["item-1"],
    notifikasi,
  });
  const masuk = (permissions: string[]) => h.auth.mockResolvedValue({ user: { id: KANTOR, permissions } });

  it("a PUTUS shipment whose nota exists needs deliveries:cancel_nota — deliveries:ship alone is FORBIDDEN", async () => {
    h.shipmentLookup.mockResolvedValue(putusBernota);
    masuk(["deliveries:ship"]);
    expect(await cancelShipmentAction(batal)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(h.cancelShipment).not.toHaveBeenCalled();

    h.cancelShipment.mockResolvedValue(hasil(false, "dlv-1"));
    masuk(["deliveries:cancel_nota"]);
    expect(await cancelShipmentAction(batal)).toEqual({ ok: true });
    expect(h.cancelShipment).toHaveBeenCalledWith({ shipmentId: "shp-1", cancelledById: KANTOR, reason: "toko tutup" });
  });

  it("a KONSI shipment keeps deliveries:ship — deliveries:cancel_nota alone is FORBIDDEN", async () => {
    h.shipmentLookup.mockResolvedValue(konsi);
    masuk(["deliveries:cancel_nota"]);
    expect(await cancelShipmentAction(batal)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(h.cancelShipment).not.toHaveBeenCalled();

    h.cancelShipment.mockResolvedValue(hasil(false, null));
    masuk(["deliveries:ship"]);
    expect(await cancelShipmentAction(batal)).toEqual({ ok: true });
  });

  it("after commit: the office is told, the nota journals re-sync and the returned stock goes to Jubelio", async () => {
    h.shipmentLookup.mockResolvedValue(putusBernota);
    h.cancelShipment.mockResolvedValue(hasil(false, "dlv-1"));
    expect(await cancelShipmentAction(batal)).toEqual({ ok: true });
    expect(h.fanOut).toHaveBeenCalledTimes(2);
    expect(h.fanOut).toHaveBeenCalledWith(notifikasi[0]);
    expect(h.fanOut).toHaveBeenCalledWith(notifikasi[1]);
    jurnalNota("dlv-1");
    expect(h.pushStok).toHaveBeenCalledWith(["item-1"], expect.objectContaining({ userId: KANTOR }));
  });

  it("the store's SPG gets the third notice only when the goods had already left", async () => {
    h.shipmentLookup.mockResolvedValue(konsi);
    h.cancelShipment.mockResolvedValue(hasil(false, null));
    expect(await cancelShipmentAction(batal)).toEqual({ ok: true });
    expect(h.dibatalkan).not.toHaveBeenCalled();

    h.cancelShipment.mockResolvedValue(hasil(true, null));
    expect(await cancelShipmentAction(batal)).toEqual({ ok: true });
    expect(h.dibatalkan).toHaveBeenCalledTimes(1);
    expect(h.dibatalkan).toHaveBeenCalledWith({ shipmentId: "shp-1", pelakuId: KANTOR });
    expect(h.kaitKonsi).toHaveBeenCalledWith("shp-1", KANTOR);
  });

  it("a refused cancel tells no one, posts nothing and pushes nothing", async () => {
    h.shipmentLookup.mockResolvedValue(putusBernota);
    h.cancelShipment.mockRejectedValue(new DeliveryShipmentError("RECEIVABLE_PAID", "BKM/2026/11/0001"));
    expect(await cancelShipmentAction(batal)).toEqual({ ok: false, reason: "RECEIVABLE_PAID", detail: "BKM/2026/11/0001" });
    expect(h.fanOut).not.toHaveBeenCalled();
    expect(h.postAr).not.toHaveBeenCalled();
    expect(h.pushStok).not.toHaveBeenCalled();
    tidakAdaKabar();
  });

  it("a missing shipment or a non-text reason never reaches the writer", async () => {
    expect(await cancelShipmentAction(batal)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await cancelShipmentAction({ shipmentId: "shp-1", reason: 7 as never })).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(h.cancelShipment).not.toHaveBeenCalled();
  });
});
