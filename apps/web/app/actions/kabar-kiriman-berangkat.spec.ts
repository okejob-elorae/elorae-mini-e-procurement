import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar "barang berangkat ke toko" dipasang di tiga aksi yang membuat barang keluar gudang
 * menuju toko: pengiriman putus, persetujuan pesanan (konsi), dan kirim titipan konsinyasi.
 * Yang diuji di sini hanya KAITANNYA — dipanggil sesudah sukses, dengan dokumen dan pelaku yang
 * benar, dan tidak dipanggil saat aksinya gagal. Sekali-per-dokumen dan penerimanya diuji di
 * `lib/spg/pesanan-menuju-toko.test.ts` terhadap basis data sungguhan.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kabarkan: vi.fn(async () => ({ penerima: 0 })),
  recordDelivery: vi.fn(),
  approve: vi.fn(),
  kirimTitipan: vi.fn(),
  deliveryLookup: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/spg/pesanan-menuju-toko", () => ({ kabarkanKirimanBerangkat: h.kabarkan }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_DIKIRIM: "PESANAN_DIKIRIM", PESANAN_DITUTUP: "PESANAN_DITUTUP" },
  kabariPengguna: vi.fn(),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/app/actions/audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: { fieldSalesDelivery: { findUnique: h.deliveryLookup }, fieldSalesOrder: { findUnique: vi.fn(async () => null) } },
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
  it("an approved order is passed on as a possible konsi shipment", async () => {
    h.approve.mockResolvedValue({ ok: true });
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: true });
    expect(h.kabarkan).toHaveBeenCalledWith({ sourceType: "KONSI_ORDER", sourceId: "order-9", pelakuId: KANTOR });
  });

  it("a refused approval tells no one", async () => {
    h.approve.mockRejectedValue(new InvalidOrderTransitionError("REJECTED", "APPROVED"));
    expect(await approveFieldSalesOrderAction("order-9")).toEqual({ ok: false, reason: "INVALID_TRANSITION" });
    expect(h.kabarkan).not.toHaveBeenCalled();
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
