import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar PESANAN_DIKIRIM ke salesman saat pengiriman putus berangkat. Basis data dan pengiriman push
 * dipalsukan: yang diuji SIAPA yang dikabari, KAPAN tidak, dan isinya.
 */
const h = vi.hoisted(() => ({
  baris: null as unknown,
  kirim: [] as { userId: string; jenis: string; judul: string; isi: string; data: Record<string, string> }[],
}));
vi.mock("@elorae/db", async (asli) => ({
  ...(await asli<typeof import("@elorae/db")>()),
  prisma: { deliveryShipment: { findUnique: vi.fn(async () => h.baris) } },
}));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_DIKIRIM: "PESANAN_DIKIRIM" },
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string; isi: string; data: Record<string, string> }) => {
    h.kirim.push({ userId, ...k });
  }),
}));

import { kabarkanPesananDikirim } from "./kabar-salesman";

function pengiriman(ubah: { status?: string; orderType?: string; deliveryStatus?: string; voidedAt?: Date | null; tanpaNota?: boolean } = {}) {
  return {
    status: ubah.status ?? "IN_TRANSIT",
    delivery: ubah.tanpaNota ? null : { id: "d1", docNo: "DLV/26/0001", total: 1_250_000, voidedAt: ubah.voidedAt ?? null },
    order: {
      id: "o1",
      orderNo: "PUT/26/0001",
      orderType: ubah.orderType ?? "PUTUS",
      salesmanId: "sales",
      deliveryStatus: ubah.deliveryStatus ?? "PARTIAL",
      store: { name: "Toko Sinar" },
    },
  };
}

beforeEach(() => {
  h.kirim = [];
  h.baris = pengiriman();
});

describe("kabarkanPesananDikirim", () => {
  it("putus yang berangkat: salesman pemilik pesanan dikabari dengan nomor dan nilai notanya", async () => {
    await kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "gudang" });
    expect(h.kirim).toHaveLength(1);
    expect(h.kirim[0]).toMatchObject({ userId: "sales", jenis: "PESANAN_DIKIRIM", judul: "Pesanan PUT/26/0001 dikirim sebagian", data: { orderId: "o1", deliveryId: "d1" } });
    expect(h.kirim[0].isi).toContain("Toko Sinar · nota DLV/26/0001");
    expect(h.kirim[0].isi).toContain("1.250.000");
  });

  it("pesanan yang sudah terkirim seluruhnya: 'sudah dikirim'", async () => {
    h.baris = pengiriman({ deliveryStatus: "DELIVERED" });
    await kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "gudang" });
    expect(h.kirim[0].judul).toBe("Pesanan PUT/26/0001 sudah dikirim");
  });

  it("tidak dikabari: konsinyasi, belum berangkat, nota dibatalkan, tanpa nota, atau pelakunya salesman itu sendiri", async () => {
    for (const baris of [
      pengiriman({ orderType: "KONSI" }),
      pengiriman({ status: "PACKED" }),
      pengiriman({ voidedAt: new Date() }),
      pengiriman({ tanpaNota: true }),
    ]) {
      h.baris = baris;
      await kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "gudang" });
    }
    h.baris = pengiriman();
    await kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "sales" });
    h.baris = null;
    await kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "gudang" });
    expect(h.kirim).toHaveLength(0);
  });

  it("tidak pernah melempar", async () => {
    h.baris = { status: "IN_TRANSIT" };
    await expect(kabarkanPesananDikirim({ shipmentId: "s1", pelakuId: "gudang" })).resolves.toBeUndefined();
  });
});
