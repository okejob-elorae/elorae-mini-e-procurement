import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_BAWAAN } from "@/lib/spg/member";

/*
 * Aksi member di HP SPG, tanpa basis data: toko SELALU toko tetap SPG (tidak
 * pernah dari layar), izin `spg_sales:record`, nomor yang diketik hanya
 * mendapat tingkat dan diskon, dan `daftarMember` sampai ke penulis nota dalam
 * kedua bentuk pembeli.
 */
const h = vi.hoisted(() => ({
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] as string[] } } as { user: { id: string; permissions: string[] } } | null,
  toko: "t1" as string | null,
  aturan: vi.fn(),
  daftar: vi.fn(),
  member: vi.fn(),
  cariPelanggan: vi.fn(),
  record: vi.fn(),
  aktif: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sesi) }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => h.toko) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/spg/member-queries", () => ({ bacaAturanMemberDb: h.aturan }));
vi.mock("@/lib/spg/member-writer", () => ({ daftarkanMemberPelanggan: h.daftar }));
vi.mock("@/lib/spg/member-hp-queries", () => ({ memberPembeliPerNomor: h.member }));
vi.mock("@/lib/spg/sale-writer", () => ({ recordSpgSale: h.record }));
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: h.aktif }));
vi.mock("@/lib/pwa/kunjungan-antrean", () => ({ cariKunjunganAntrean: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    storeCustomer: { findMany: h.cariPelanggan },
    user: { findUnique: vi.fn(async () => ({ assignedStoreId: h.toko })) },
  },
}));

const { daftarkanMemberPelangganAction } = await import("./spg-member-hp");
const { cariPelangganSpgAction, cekMemberNomorAction } = await import("./spg-pelanggan-cari");
const { recordSpgSaleAction } = await import("./spg-sale");

beforeEach(() => {
  h.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
  h.toko = "t1";
  h.aturan.mockReset().mockResolvedValue(MEMBER_BAWAAN);
  h.daftar.mockReset().mockResolvedValue({ ok: true, id: "m1", baru: true });
  h.member.mockReset().mockImplementation(async (phones: string[]) => new Map(phones.map((p) => [p, { status: "MEMBER", tingkat: "Gold", diskonPersen: 10 }])));
  h.cariPelanggan.mockReset().mockResolvedValue([{ id: "c1", name: "Ani", phone: "6281234567890" }]);
  h.record.mockReset().mockResolvedValue({ ok: true, spgSaleId: "s1", docNo: "SPG/1", changeGiven: 0, total: 90_000, member: { tingkat: "Gold", potongan: 10_000, baru: false }, tanpaMember: null });
  h.aktif.mockReset().mockResolvedValue({ id: "v1", storeId: "t1" });
});

describe("daftarkanMemberPelangganAction", () => {
  it("registers a customer of the SPG's own store only", async () => {
    expect(await daftarkanMemberPelangganAction({ customerId: "c1", storeId: "toko-lain" })).toEqual({ ok: true, baru: true });
    expect(h.daftar).toHaveBeenCalledWith({ customerId: "c1", storeId: "t1", userId: "spg1" });
  });

  it("refuses without the SPG permission or a fixed store", async () => {
    h.sesi = { user: { id: "x", permissions: ["pwa:access"] } };
    expect(await daftarkanMemberPelangganAction({ customerId: "c1" })).toEqual({ ok: false, code: "FORBIDDEN" });
    h.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
    h.toko = null;
    expect(await daftarkanMemberPelangganAction({ customerId: "c1" })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(h.daftar).not.toHaveBeenCalled();
  });

  it("a minimum spend to register means registering only from a receipt; a closed programme refuses", async () => {
    h.aturan.mockResolvedValue({ ...MEMBER_BAWAAN, minBelanjaDaftar: 100_000 });
    expect(await daftarkanMemberPelangganAction({ customerId: "c1" })).toEqual({ ok: false, code: "LEWAT_NOTA" });
    h.aturan.mockResolvedValue({ ...MEMBER_BAWAAN, aktif: false });
    expect(await daftarkanMemberPelangganAction({ customerId: "c1" })).toEqual({ ok: false, code: "PROGRAM_MATI" });
    expect(h.daftar).not.toHaveBeenCalled();
    h.aturan.mockResolvedValue(MEMBER_BAWAAN);
    h.daftar.mockResolvedValue({ ok: false, code: "MEMBER_NONAKTIF" });
    expect(await daftarkanMemberPelangganAction({ customerId: "c1" })).toEqual({ ok: false, code: "MEMBER_NONAKTIF" });
    expect(await daftarkanMemberPelangganAction({})).toEqual({ ok: false, code: "VALIDATION" });
  });
});

describe("cekMemberNomorAction / cariPelangganSpgAction", () => {
  it("normalises the typed number and returns only the member state", async () => {
    expect(await cekMemberNomorAction("0812 3456 7890")).toEqual({ ok: true, hp: "6281234567890", member: { status: "MEMBER", tingkat: "Gold", diskonPersen: 10 } });
    expect(h.member).toHaveBeenCalledWith(["6281234567890"]);
    expect(await cekMemberNomorAction("022-123456")).toEqual({ ok: false, code: "HP_TIDAK_VALID" });
    h.sesi = null;
    expect(await cekMemberNomorAction("081234567890")).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("adds member state to search results only when asked, from the SPG's own store", async () => {
    const tanpa = await cariPelangganSpgAction("Ani");
    expect(tanpa).toEqual({ ok: true, hasil: [{ id: "c1", name: "Ani", phone: "6281234567890" }] });
    expect(h.member).not.toHaveBeenCalled();
    const dengan = await cariPelangganSpgAction("Ani", { member: true });
    expect(dengan).toEqual({ ok: true, hasil: [{ id: "c1", name: "Ani", phone: "6281234567890", member: { status: "MEMBER", tingkat: "Gold", diskonPersen: 10 } }] });
    expect(h.cariPelanggan).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ storeId: "t1" }) }));
  });
});

describe("recordSpgSaleAction — member", () => {
  const nota = { idempotencyKey: "n1", lines: [{ itemId: "i1", variantSku: null, qty: 1 }] };

  it("forwards the registration request for an existing and a new buyer, and returns the member outcome", async () => {
    const r = await recordSpgSaleAction({ ...nota, pembeli: { id: "c1", daftarMember: true } });
    expect(r).toMatchObject({ ok: true, total: 90_000, member: { tingkat: "Gold", potongan: 10_000, baru: false }, tanpaMember: null });
    expect(h.record).toHaveBeenLastCalledWith(expect.objectContaining({ pembeli: { id: "c1", daftarMember: true } }));
    await recordSpgSaleAction({ ...nota, pembeli: { nama: "Ani", hp: "081234567890", setuju: true, daftarMember: true } });
    expect(h.record).toHaveBeenLastCalledWith(expect.objectContaining({ pembeli: { nama: "Ani", hp: "081234567890", setuju: true, daftarMember: true } }));
  });

  it("a refused registration is still a recorded receipt", async () => {
    h.record.mockResolvedValue({ ok: true, spgSaleId: "s2", docNo: "SPG/2", changeGiven: 0, total: 100_000, member: null, tanpaMember: "BELANJA_KURANG" });
    expect(await recordSpgSaleAction({ ...nota, pembeli: { id: "c1", daftarMember: true } })).toMatchObject({ ok: true, member: null, tanpaMember: "BELANJA_KURANG" });
  });
});
