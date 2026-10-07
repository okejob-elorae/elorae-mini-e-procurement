import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/catalog/queries", () => ({ listCatalogForPwa: vi.fn() }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn() }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn() }));
vi.mock("@elorae/db", () => ({ prisma: { store: { findUnique: vi.fn() } } }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { listCatalogForPwa } from "@/lib/catalog/queries";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockList = listCatalogForPwa as unknown as ReturnType<typeof vi.fn>;
const mockTokoTetap = ambilTokoTetap as unknown as ReturnType<typeof vi.fn>;
const mockTerkunci = tokoTerkunci as unknown as ReturnType<typeof vi.fn>;
const mockToko = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>;
const minta = (q: string) => new NextRequest(`http://localhost/pwa/api/catalog${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockTokoTetap.mockResolvedValue(null);
  mockTerkunci.mockResolvedValue(false);
  mockToko.mockResolvedValue({ salesmanId: "u1" });
});

describe("GET /pwa/api/catalog", () => {
  it("katalog HP salesman meminta stok rak toko (saldo buku stok, pcs)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", marginPercent: null }, items: [] });
    const res = await GET(minta("?storeId=s1"));
    expect(res.status).toBe(200);
    expect(mockTokoTetap).toHaveBeenCalledWith("u1");
    expect(mockList).toHaveBeenCalledWith("s1", { stokRak: true });
  });

  it("SPG (punya toko tetap) membaca katalog tokonya sendiri tanpa buku stok", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg1", permissions: ["pwa:access"] } });
    mockTokoTetap.mockResolvedValue("toko-spg");
    mockList.mockResolvedValue({ store: { id: "toko-spg", termsType: "KONSI", marginPercent: 25 }, items: [] });
    const res = await GET(minta("?storeId=toko-spg"));
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("toko-spg", { stokRak: false });
  });

  it("SPG tidak bisa membaca katalog toko lain — harga dan stok toko lain tidak pernah dimuat", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg1", permissions: ["pwa:access"] } });
    mockTokoTetap.mockResolvedValue("toko-spg");
    const res = await GET(minta("?storeId=toko-lain"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "STORE_NOT_ASSIGNED" });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("kunci toko-sendiri menyala: salesman tidak bisa membaca katalog toko pegangan orang lain", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockTerkunci.mockResolvedValue(true);
    mockToko.mockResolvedValue({ salesmanId: "u-lain" });
    const res = await GET(minta("?storeId=s9"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "STORE_NOT_ASSIGNED" });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("kunci menyala: toko tanpa pemegang tertutup; toko sendiri terbuka", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockTerkunci.mockResolvedValue(true);
    mockToko.mockResolvedValue({ salesmanId: null });
    expect((await GET(minta("?storeId=s9"))).status).toBe(403);
    mockToko.mockResolvedValue({ salesmanId: "u1" });
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", marginPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s1"))).status).toBe(200);
  });

  it("kunci mati: toko pegangan orang lain tetap terbuka (perilaku lama)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockToko.mockResolvedValue({ salesmanId: "u-lain" });
    mockList.mockResolvedValue({ store: { id: "s9", termsType: "PUTUS", marginPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s9"))).status).toBe(200);
  });

  it("toko yang tidak ada → 404, katalog tidak dimuat", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockToko.mockResolvedValue(null);
    expect((await GET(minta("?storeId=hilang"))).status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("tanpa sesi atau tanpa akses HP tidak memuat apa pun", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(minta("?storeId=s1"))).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    expect((await GET(minta("?storeId=s1"))).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });
});
