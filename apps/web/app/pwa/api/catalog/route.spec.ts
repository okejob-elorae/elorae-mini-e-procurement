import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/catalog/queries", () => ({ listCatalogForPwa: vi.fn() }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn() }));

import { auth } from "@/lib/auth";
import { listCatalogForPwa } from "@/lib/catalog/queries";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockList = listCatalogForPwa as unknown as ReturnType<typeof vi.fn>;
const mockTokoTetap = ambilTokoTetap as unknown as ReturnType<typeof vi.fn>;
const minta = (q: string) => new NextRequest(`http://localhost/pwa/api/catalog${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockTokoTetap.mockResolvedValue(null);
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

  it("SPG (punya toko tetap) tidak pernah menerima buku stok toko lain", async () => {
    mockAuth.mockResolvedValue({ user: { id: "spg1", permissions: ["pwa:access"] } });
    mockTokoTetap.mockResolvedValue("toko-spg");
    mockList.mockResolvedValue({ store: { id: "s2", termsType: "KONSI", marginPercent: 25 }, items: [] });
    const res = await GET(minta("?storeId=s2"));
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("s2", { stokRak: false });
  });

  it("tanpa sesi atau tanpa akses HP tidak memuat apa pun", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(minta("?storeId=s1"))).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    expect((await GET(minta("?storeId=s1"))).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });
});
