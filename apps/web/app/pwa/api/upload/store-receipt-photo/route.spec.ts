import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    konsiTransfer: { findFirst: vi.fn() },
    fieldSalesDelivery: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({ isConfigured: vi.fn(), uploadToR2: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { isConfigured, uploadToR2 } from "@/lib/r2";
import { POST } from "./route";

/*
 * Foto penerimaan oleh salesman pemegang (P45a): hanya pemegang toko, hanya dokumen kiriman toko
 * itu, kuncinya di folder dokumen yang diperiksa `terimaKirimanPemegang`.
 */

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockToko = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockTransfer = prisma.konsiTransfer.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockNota = prisma.fieldSalesDelivery.findFirst as unknown as ReturnType<typeof vi.fn>;

const USER = "sales1";
const TOKO = "toko1";
const DOK = "trf1";

function permintaan(isi: Partial<Record<"storeId" | "sourceType" | "sourceId" | "clientId", string>> & { file?: File | null } = {}): Request {
  const fd = new FormData();
  if (isi.file !== null) fd.set("file", isi.file ?? new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
  fd.set("storeId", isi.storeId ?? TOKO);
  fd.set("sourceType", isi.sourceType ?? "KONSI_TRANSFER");
  fd.set("sourceId", isi.sourceId ?? DOK);
  fd.set("clientId", isi.clientId ?? "foto-1");
  return new Request("http://localhost/pwa/api/upload/store-receipt-photo", { method: "POST", body: fd });
}

const kirim = async (isi?: Parameters<typeof permintaan>[0]) => {
  const res = await POST(permintaan(isi) as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER, permissions: ["pwa:access"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockToko.mockResolvedValue({ salesmanId: USER });
  mockTransfer.mockResolvedValue({ id: DOK });
  mockNota.mockResolvedValue({ id: DOK });
});

describe("POST /pwa/api/upload/store-receipt-photo", () => {
  it("401 tanpa sesi, 403 tanpa akses HP, 503 tanpa R2 — tidak ada yang diunggah", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await kirim()).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: USER, permissions: [] } });
    expect((await kirim()).status).toBe(403);
    mockIsConfigured.mockReturnValueOnce(false);
    expect((await kirim()).status).toBe(503);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("menolak isian yang bukan segmen aman, jenis dokumen lain, atau berkas yang bukan gambar", async () => {
    expect((await kirim({ storeId: "../toko" })).status).toBe(400);
    expect((await kirim({ sourceType: "SPG_SALE" })).status).toBe(400);
    expect((await kirim({ clientId: "a/b" })).status).toBe(400);
    expect((await kirim({ file: null })).status).toBe(400);
    expect((await kirim({ file: new File(["x"], "a.txt", { type: "text/plain" }) })).status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("hanya salesman pemegang toko itu", async () => {
    mockToko.mockResolvedValueOnce({ salesmanId: "orang-lain" });
    expect(await kirim()).toEqual({ status: 403, body: { error: "BUKAN_PEMEGANG" } });
    mockToko.mockResolvedValueOnce(null);
    expect((await kirim()).status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("dokumen kiriman toko lain sama dengan tidak ada", async () => {
    mockTransfer.mockResolvedValueOnce(null);
    expect((await kirim()).status).toBe(404);
    expect(mockTransfer).toHaveBeenCalledWith({ where: { id: DOK, storeId: TOKO }, select: { id: true } });
    mockNota.mockResolvedValueOnce(null);
    expect((await kirim({ sourceType: "PUTUS_DELIVERY" })).status).toBe(404);
    expect(mockNota).toHaveBeenCalledWith({ where: { id: DOK, order: { storeId: TOKO } }, select: { id: true } });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("menyimpan ke folder dokumen yang diperiksa penulis penerimaan", async () => {
    const r = await kirim({ sourceType: "PUTUS_DELIVERY", clientId: "foto-9" });
    expect(r.status).toBe(200);
    expect(r.body.key).toBe(`store-receipt-photos/${TOKO}/PUTUS_DELIVERY-${DOK}/foto-9.jpg`);
    expect(r.body.url).toBe(`https://cdn.example/store-receipt-photos/${TOKO}/PUTUS_DELIVERY-${DOK}/foto-9.jpg`);
  });
});
