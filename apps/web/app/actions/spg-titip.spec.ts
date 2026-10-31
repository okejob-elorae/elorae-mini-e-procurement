import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi pelanggan & titip pesan SPG: toko SELALU dari server (toko tetap SPG),
 * tidak pernah dari isian HP; akun tanpa izin jual SPG atau tanpa toko tetap
 * ditolak sebelum penulis dipanggil. Tanpa basis data.
 */

const state = {
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] } } as { user: { id: string; permissions: string[] } } | null,
  toko: "t1" as string | null,
  dipanggil: [] as { fn: string; input: Record<string, unknown> }[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.toko) }));
vi.mock("@/lib/spg/titip-writer", () => {
  const catat = (fn: string) =>
    vi.fn(async (input: Record<string, unknown>) => {
      state.dipanggil.push({ fn, input });
      return fn === "tandaiDikabari" ? { ok: true, holdUntil: "2026-10-06", ulang: false } : { ok: true, id: "r1", customerId: "c1", ulang: false };
    });
  return {
    buatTitipan: catat("buatTitipan"),
    catatDicariDenganTitip: catat("catatDicariDenganTitip"),
    tandaiDikabari: catat("tandaiDikabari"),
    tutupTitipan: catat("tutupTitipan"),
  };
});
vi.mock("@/lib/spg/pelanggan-writer", () => ({
  tambahPelanggan: vi.fn(async (input: Record<string, unknown>) => {
    state.dipanggil.push({ fn: "tambahPelanggan", input });
    return { ok: true, id: "c1", sudahAda: false, nama: "Rina" };
  }),
  ubahPelanggan: vi.fn(async (input: Record<string, unknown>) => {
    state.dipanggil.push({ fn: "ubahPelanggan", input });
    return { ok: true, id: "c1" };
  }),
}));

const { buatTitipanAction, catatDicariDenganTitipAction, tandaiDikabariAction, tutupTitipanAction } = await import("./spg-titip");
const { tambahPelangganAction, ubahPelangganAction } = await import("./spg-pelanggan");

beforeEach(() => {
  state.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
  state.toko = "t1";
  state.dipanggil = [];
});

const TITIP = { pembeli: { nama: "Rina", hp: "0812", setuju: true }, itemId: "i1", variantSku: "i1-L", qty: 1, idempotencyKey: "hp-1" };

describe("titip pesan & pelanggan — aksi", () => {
  it("passes the SPG's own store to every writer and ignores a store in the payload", async () => {
    await buatTitipanAction({ ...TITIP, storeId: "t9" });
    await catatDicariDenganTitipAction({ ...TITIP, description: "Kaos L", storeId: "t9" });
    await tandaiDikabariAction({ requestId: "r1", storeId: "t9" });
    await tutupTitipanAction({ requestId: "r1", hasil: "BATAL", alasan: "tidak jadi", storeId: "t9" });
    await tambahPelangganAction({ nama: "Rina", hp: "0812", setuju: true, storeId: "t9" });
    await ubahPelangganAction({ id: "c1", nama: "Rina", hp: "0812", storeId: "t9" });
    expect(state.dipanggil).toHaveLength(6);
    for (const p of state.dipanggil) expect(p.input).toMatchObject({ storeId: "t1", userId: "spg1" });
  });

  it("refuses an account without SPG sales permission, or without a fixed store, before any writer", async () => {
    state.sesi = { user: { id: "s1", permissions: ["pwa:access"] } };
    expect(await buatTitipanAction(TITIP)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await tambahPelangganAction({ nama: "Rina", hp: "0812", setuju: true })).toEqual({ ok: false, code: "FORBIDDEN" });
    state.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
    state.toko = null;
    expect(await tandaiDikabariAction({ requestId: "r1" })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(await ubahPelangganAction({ id: "c1", nama: "Rina", hp: "0812" })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    state.sesi = null;
    expect(await tutupTitipanAction({ requestId: "r1", hasil: "SELESAI" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("refuses a malformed payload before any writer", async () => {
    expect(await buatTitipanAction({ ...TITIP, qty: 0 })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await buatTitipanAction({ ...TITIP, pembeli: { id: "c1", nama: "x" } })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await catatDicariDenganTitipAction({ ...TITIP, description: "" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await tutupTitipanAction({ requestId: "r1", hasil: "HILANG" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("returns the hold date from the writer when notifying", async () => {
    expect(await tandaiDikabariAction({ requestId: "r1" })).toEqual({ ok: true, id: "r1", holdUntil: "2026-10-06", ulang: false });
  });
});
