import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gerbang halaman rincian pengiriman: sama dengan registernya — siapa pun yang memegang salah satu
 * dari deliveries:ship, deliveries:pod, atau deliveries:cancel_nota (Admin Penjualan, P41a) boleh
 * membukanya, karena setiap baris register menautkan ke sini.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
const kueri = vi.hoisted(() => ({ dipanggil: 0 }));
vi.mock("@/lib/delivery/shipment-queries", () => ({
  getDeliveryShipmentDetail: vi.fn(async (id: string) => {
    kueri.dipanggil += 1;
    return { id };
  }),
}));
vi.mock("./ShipmentDetailClient", () => ({ ShipmentDetailClient: () => null }));

const { default: Halaman } = await import("./page");
const buka = () => Halaman({ params: Promise.resolve({ id: "s1" }) });

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  kueri.dipanggil = 0;
});

describe("halaman rincian pengiriman", () => {
  it("tanpa sesi atau tanpa ketiga izin pengiriman → beranda, kueri tidak jalan", async () => {
    sesi.ada = false;
    await expect(buka()).rejects.toThrow("REDIRECT:/backoffice");
    sesi.ada = true;
    sesi.permissions = ["field_sales_orders:view"];
    await expect(buka()).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.dipanggil).toBe(0);
  });

  it.each([["deliveries:ship"], ["deliveries:pod"], ["deliveries:cancel_nota"]])("%s saja sudah cukup membuka rinciannya", async (izin) => {
    sesi.permissions = [izin];
    const el = (await buka()) as { props: { shipment: { id: string } } };
    expect(el.props.shipment).toEqual({ id: "s1" });
    expect(kueri.dipanggil).toBe(1);
  });
});
