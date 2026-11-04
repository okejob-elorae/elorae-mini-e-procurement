import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Kirim" (PACKED → IN_TRANSIT) juga mengabari salesman pemilik pesanan putus (PESANAN_DIKIRIM) —
 * kabar yang dulu dikirim "Catat pengiriman" (dihapus, P44a). Yang diuji di sini hanya KAITANNYA:
 * dipanggil sesudah sukses dengan pengiriman dan pelaku yang benar, tidak dipanggil saat ditolak.
 * Isi, penerima, dan kapan tidak dikabari diuji di `lib/delivery/kabar-salesman.test.ts`.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  ship: vi.fn(),
  berangkat: vi.fn(async () => ({ penerima: 0 })),
  pesananDikirim: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/delivery/shipment-writer", () => ({
  createDeliveryShipment: vi.fn(),
  updateShipmentTracking: vi.fn(),
  reassignShipmentCarrier: vi.fn(),
  shipDeliveryShipment: h.ship,
  completeDeliveryShipment: vi.fn(),
  cancelDeliveryShipment: vi.fn(),
}));
vi.mock("@/lib/spg/kabar-pengiriman", () => ({
  kabarkanPengirimanBerangkat: h.berangkat,
  kabarkanPengirimanDiserahkan: vi.fn(),
  kabarkanPengirimanDibatalkan: vi.fn(),
}));
vi.mock("@/lib/delivery/kabar-salesman", () => ({ kabarkanPesananDikirim: h.pesananDikirim }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: { deliveryShipment: { findUnique: vi.fn(async () => null) } },
}));

import { shipShipmentAction } from "./delivery-shipments";
import { DeliveryShipmentError } from "@/lib/delivery/errors";

const KANTOR = "gudang-1";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["deliveries:ship"] } });
});

describe("Kirim mengabari salesman pemilik pesanan", () => {
  it("sesudah berhasil: kabar salesman dipanggil sekali dengan pengiriman dan pelakunya, di samping kabar SPG", async () => {
    h.ship.mockResolvedValue({ ok: true });
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toEqual({ ok: true });
    expect(h.pesananDikirim).toHaveBeenCalledTimes(1);
    expect(h.pesananDikirim).toHaveBeenCalledWith({ shipmentId: "shp-1", pelakuId: KANTOR });
    expect(h.berangkat).toHaveBeenCalledTimes(1);
  });

  it("ditolak, atau tanpa izin kirim: tidak ada kabar", async () => {
    h.ship.mockRejectedValue(new DeliveryShipmentError("MISSING_WEIGHT"));
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toMatchObject({ ok: false, reason: "MISSING_WEIGHT" });
    h.auth.mockResolvedValue({ user: { id: KANTOR, permissions: ["deliveries:pod"] } });
    expect(await shipShipmentAction({ shipmentId: "shp-1" })).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(h.pesananDikirim).not.toHaveBeenCalled();
  });
});
