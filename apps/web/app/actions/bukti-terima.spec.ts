import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCatat, mockKoreksi, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCatat: vi.fn(),
  mockKoreksi: vi.fn(),
  mockRevalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/field-sales/delivery/bukti-terima-writer", () => ({
  catatBuktiTerima: mockCatat,
  koreksiBuktiTerima: mockKoreksi,
}));

import { catatBuktiTerimaAction, koreksiBuktiTerimaAction } from "./bukti-terima";

const masukan = {
  deliveryId: "d1",
  receivedByName: "Bu Siti",
  receivedAt: "2026-09-12T04:00:00.000Z",
  podPhotoUrl: "/api/foto/f1",
  idempotencyKey: "k1",
  jenisBukti: "FOTO" as const,
};

describe("aksi bukti terima", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockCatat.mockReset();
    mockKoreksi.mockReset();
    mockRevalidate.mockReset();
  });

  it("refuses without a session and never reaches the writer", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await catatBuktiTerimaAction(masukan)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(mockCatat).not.toHaveBeenCalled();
  });

  it("hands the writer the session user and permissions, and refreshes both screens", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockCatat.mockResolvedValue({ ok: true, ulangan: false, orderId: "o1", deliveryId: "d1" });
    expect(await catatBuktiTerimaAction(masukan)).toEqual({ ok: true, ulangan: false });
    expect(mockCatat).toHaveBeenCalledWith({ userId: "u1", izin: ["pwa:access"] }, masukan);
    expect(mockRevalidate).toHaveBeenCalledWith("/pwa/orders/o1");
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/field-sales-orders/o1");
  });

  it("passes a rejection through untouched and refreshes nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockCatat.mockResolvedValue({ ok: false, kode: "SUDAH_DITERIMA" });
    expect(await catatBuktiTerimaAction(masukan)).toEqual({ ok: false, kode: "SUDAH_DITERIMA" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("turns an unexpected server error into GAGAL instead of throwing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockKoreksi.mockRejectedValue(new Error("koneksi putus"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await koreksiBuktiTerimaAction({ ...masukan, reason: "x" })).toEqual({ ok: false, kode: "GAGAL" });
    err.mockRestore();
  });

  it("survives a malformed payload from the network", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockCatat.mockResolvedValue({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(await catatBuktiTerimaAction(null as never)).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(mockCatat.mock.calls[0][1]).toMatchObject({ deliveryId: undefined });
  });
});
