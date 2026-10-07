import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Muat mobil hanya untuk sales kanvas: SPG (toko tetap), admin sistem, dan pengguna tanpa
 * akses HP ditolak di SERVER dengan kodenya sendiri, sebelum stok gudang bergerak.
 */
const { mockAuth, mockLoadVan, mockPeriksa } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockLoadVan: vi.fn(), mockPeriksa: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/canvassing/writer", () => ({ loadVan: mockLoadVan }));
vi.mock("@/lib/canvassing/kelayakan-kanvas", () => ({ periksaKanvas: mockPeriksa }));
vi.mock("@/lib/canvassing/post-van-journal-safely", () => ({ postVanJournalSafely: vi.fn() }));
vi.mock("@/lib/canvassing/van-journal", () => ({ postVanLoadJournal: vi.fn() }));
vi.mock("@/lib/canvassing/journal-pending", () => ({ isJournalRetryable: vi.fn() }));
vi.mock("@/lib/finance/jurnal-tertunda", () => ({ dokumenJurnal: vi.fn(), tandaiJurnalTertundaSelesai: vi.fn() }));

import { loadVanAction } from "./canvassing";

const isian = { canvasserId: "u-spg", lines: [{ itemId: "i1", variantSku: null, qty: 5 }] };

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ user: { id: "admin", permissions: ["canvassing:manage"] } });
  mockLoadVan.mockReset().mockResolvedValue({ ok: true, loadId: "l1", docNo: "VANLOAD/2026/0001" });
  mockPeriksa.mockReset();
});

describe("loadVanAction — penerima harus sales kanvas", () => {
  it.each(["SPG", "ADMIN_SISTEM", "TANPA_AKSES_HP", "TIDAK_ADA"] as const)("%s → NOT_CANVASSER, loadVan tidak dipanggil", async (sebab) => {
    mockPeriksa.mockResolvedValue(sebab);
    expect(await loadVanAction(isian)).toEqual({ ok: false, reason: "NOT_CANVASSER", sebab });
    expect(mockLoadVan).not.toHaveBeenCalled();
  });

  it("salesman kanvas: dimuat seperti biasa", async () => {
    mockPeriksa.mockResolvedValue(null);
    expect(await loadVanAction(isian)).toEqual({ ok: true, docNo: "VANLOAD/2026/0001" });
    expect(mockLoadVan).toHaveBeenCalledTimes(1);
  });

  it("tanpa izin kelola kanvas: FORBIDDEN sebelum memeriksa penerima", async () => {
    mockAuth.mockResolvedValue({ user: { id: "x", permissions: [] } });
    expect(await loadVanAction(isian)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockPeriksa).not.toHaveBeenCalled();
  });
});
