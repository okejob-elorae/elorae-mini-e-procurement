import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/catalog/queries", () => ({ listCatalogForPwa: vi.fn() }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(), spgBerhentiPada: vi.fn() }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn() }));
vi.mock("@elorae/db", () => ({ prisma: { store: { findUnique: vi.fn() }, fieldSalesOrder: { findFirst: vi.fn() } } }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { listCatalogForPwa } from "@/lib/catalog/queries";
import { ambilTokoTetap, spgBerhentiPada } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockList = listCatalogForPwa as unknown as ReturnType<typeof vi.fn>;
const mockTokoTetap = ambilTokoTetap as unknown as ReturnType<typeof vi.fn>;
const mockBerhenti = spgBerhentiPada as unknown as ReturnType<typeof vi.fn>;
const mockTerkunci = tokoTerkunci as unknown as ReturnType<typeof vi.fn>;
const mockToko = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockPesanan = prisma.fieldSalesOrder.findFirst as unknown as ReturnType<typeof vi.fn>;
const minta = (q: string) => new NextRequest(`http://localhost/pwa/api/catalog${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockTokoTetap.mockResolvedValue(null);
  mockBerhenti.mockResolvedValue(null);
  mockTerkunci.mockResolvedValue(false);
  mockToko.mockResolvedValue({ salesmanId: "u1" });
  mockPesanan.mockResolvedValue(null);
});

describe("GET /pwa/api/catalog", () => {
  it("katalog HP salesman meminta stok rak toko (saldo buku stok, pcs)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, items: [] });
    const res = await GET(minta("?storeId=s1"));
    expect(res.status).toBe(200);
    expect(mockTokoTetap).toHaveBeenCalledWith("u1");
    expect(mockList).toHaveBeenCalledWith("s1", { stokRak: true, hargaKonsi: true });
  });

  it("katalog HP salesman di toko KONSI meminta harga retail konsi (P18)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockList.mockResolvedValue({ store: { id: "k1", termsType: "KONSI", markupPercent: 20, priceDiscountPercent: null }, items: [], hargaKonsiTampil: true });
    const res = await GET(minta("?storeId=k1"));
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("k1", { stokRak: true, hargaKonsi: true });
    expect((await res.json()).hargaKonsiTampil).toBe(true);
  });

  it("SPG yang sudah berhenti tidak membaca katalog toko mana pun (P66)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg-lama", permissions: ["pwa:access"] } });
    mockBerhenti.mockResolvedValue({ hariTerakhir: "2026-10-31", storeId: "toko-lama" });
    const res = await GET(minta("?storeId=toko-lama"));
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("SPG (punya toko tetap) membaca katalog tokonya sendiri tanpa buku stok", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg1", permissions: ["pwa:access"] } });
    mockTokoTetap.mockResolvedValue("toko-spg");
    mockList.mockResolvedValue({ store: { id: "toko-spg", termsType: "KONSI", markupPercent: 25, priceDiscountPercent: null }, items: [] });
    const res = await GET(minta("?storeId=toko-spg"));
    expect(res.status).toBe(200);
    // HP SPG tetap tanpa harga konsi (P18a).
    expect(mockList).toHaveBeenCalledWith("toko-spg", { stokRak: false, hargaKonsi: false });
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
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s1"))).status).toBe(200);
  });

  it("kunci mati: toko pegangan orang lain tetap terbuka (perilaku lama)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockToko.mockResolvedValue({ salesmanId: "u-lain" });
    mockList.mockResolvedValue({ store: { id: "s9", termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s9"))).status).toBe(200);
  });

  it("toko yang tidak ada → 404, katalog tidak dimuat", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockToko.mockResolvedValue(null);
    expect((await GET(minta("?storeId=hilang"))).status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("Ubah pesanan: barang pesanan PENDING milik salesman sendiri di toko ini tetap tampil (P73)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockPesanan.mockResolvedValue({ lines: [{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i1" }] });
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s1&ganti=o1"))).status).toBe(200);
    // Daftarnya dari server, dibatasi pesanan PENDING milik pemanggil di toko yang sama.
    expect(mockPesanan).toHaveBeenCalledWith({
      where: { id: "o1", storeId: "s1", salesmanId: "u1", status: "PENDING_APPROVAL" },
      select: { lines: { select: { itemId: true } } },
    });
    expect(mockList).toHaveBeenCalledWith("s1", { stokRak: true, hargaKonsi: true, tetapTampilkan: ["i1", "i2"] });
  });

  it("Ubah pesanan dengan id pesanan orang lain, toko lain, atau yang sudah diputuskan tidak membuka barang apa pun", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockPesanan.mockResolvedValue(null);
    mockList.mockResolvedValue({ store: { id: "s1", termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, items: [] });
    expect((await GET(minta("?storeId=s1&ganti=bukan-milik"))).status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("s1", { stokRak: true, hargaKonsi: true });
  });

  it("SPG tidak pernah membawa daftar pesanan salesman, walau mengirim ?ganti", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg1", permissions: ["pwa:access"] } });
    mockTokoTetap.mockResolvedValue("toko-spg");
    mockList.mockResolvedValue({ store: { id: "toko-spg", termsType: "KONSI", markupPercent: 25, priceDiscountPercent: null }, items: [] });
    expect((await GET(minta("?storeId=toko-spg&ganti=o1"))).status).toBe(200);
    expect(mockPesanan).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalledWith("toko-spg", { stokRak: false, hargaKonsi: false });
  });

  it("tanpa sesi atau tanpa akses HP tidak memuat apa pun", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(minta("?storeId=s1"))).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    expect((await GET(minta("?storeId=s1"))).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });
});
