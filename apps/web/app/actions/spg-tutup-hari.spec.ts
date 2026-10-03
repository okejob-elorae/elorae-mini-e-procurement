import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockToko, mockKirim, mockPesan, mockRevalidate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockToko: vi.fn(),
  mockKirim: vi.fn(),
  mockPesan: vi.fn(),
  mockRevalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: mockToko }));
vi.mock("@/lib/spg/tutup-hari-writer", () => ({ kirimTutupHari: mockKirim }));
vi.mock("@/lib/spg/tutup-hari-queries", () => ({ pesanWaLaporan: mockPesan }));

import { kirimTutupHariAction } from "./spg-tutup-hari";

const masukan = { day: "2026-10-03", pengunjung: 40, totalKasir: 1_000_000, catatan: "Hujan", foto: ["/api/foto/f1"], idempotencyKey: "kunci-12345" };
const SPG = { user: { id: "u1", permissions: ["spg_sales:record", "pwa:access"] } };

describe("kirimTutupHariAction", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockToko, mockKirim, mockPesan, mockRevalidate]) m.mockReset();
  });

  it("refuses without a session or without the SPG permission, and never reaches the writer", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: false, code: "FORBIDDEN" });
    mockAuth.mockResolvedValue({ user: { id: "s1", permissions: ["pwa:access"] } });
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockKirim).not.toHaveBeenCalled();
  });

  it("refuses a user without a fixed store", async () => {
    mockAuth.mockResolvedValue(SPG);
    mockToko.mockResolvedValue(null);
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(mockKirim).not.toHaveBeenCalled();
  });

  it("takes the store from the server, never from the phone's payload", async () => {
    mockAuth.mockResolvedValue(SPG);
    mockToko.mockResolvedValue("toko-sendiri");
    mockKirim.mockResolvedValue({ ok: true, id: "c1", ulangan: false, diperbarui: false, laporan: {} });
    mockPesan.mockResolvedValue("teks");
    const r = await kirimTutupHariAction({ ...masukan, storeId: "toko-orang-lain" });
    expect(r).toEqual({ ok: true, diperbarui: false, teksWa: "teks" });
    expect(mockKirim).toHaveBeenCalledWith({
      userId: "u1",
      storeId: "toko-sendiri",
      day: "2026-10-03",
      isi: { pengunjung: 40, totalKasir: 1_000_000, catatan: "Hujan", foto: ["/api/foto/f1"] },
      idempotencyKey: "kunci-12345",
    });
    expect(mockPesan).toHaveBeenCalledWith("toko-sendiri", "2026-10-03");
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/spg-tutup-hari");
  });

  it("rejects a malformed payload before the writer", async () => {
    mockAuth.mockResolvedValue(SPG);
    mockToko.mockResolvedValue("toko-sendiri");
    expect(await kirimTutupHariAction({ ...masukan, day: "kemarin" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await kirimTutupHariAction({ ...masukan, idempotencyKey: "x" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mockKirim).not.toHaveBeenCalled();
  });

  it("passes the writer's refusal through and refreshes nothing", async () => {
    mockAuth.mockResolvedValue(SPG);
    mockToko.mockResolvedValue("toko-sendiri");
    mockKirim.mockResolvedValue({ ok: false, kode: "FOTO_WAJIB" });
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: false, code: "FOTO_WAJIB" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("returns a code instead of throwing on a server error, and still succeeds when only the WhatsApp text fails", async () => {
    mockAuth.mockResolvedValue(SPG);
    mockToko.mockResolvedValue("toko-sendiri");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockKirim.mockRejectedValueOnce(new Error("koneksi putus"));
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: false, code: "GENERIC" });
    mockKirim.mockResolvedValueOnce({ ok: true, id: "c1", ulangan: false, diperbarui: true, laporan: {} });
    mockPesan.mockRejectedValueOnce(new Error("lambat"));
    expect(await kirimTutupHariAction(masukan)).toEqual({ ok: true, diperbarui: true, teksWa: null });
    err.mockRestore();
  });
});
