import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Toko retur pembeli selalu toko tetap SPG, apa pun yang dikirim HP; kantor
 * memutuskan laporan hanya dengan `spg_returns:approve`, izin yang sama dengan
 * tombolnya. Tanpa basis data.
 */

type Panggilan = Record<string, unknown>;

const state = {
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] } } as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: "s1" as string | null,
  dicatat: [] as Panggilan[],
  disetujui: [] as Panggilan[],
  ditolak: [] as Panggilan[],
  ditarik: [] as Panggilan[],
  disegarkan: [] as string[],
  /** Kode tolak yang dikembalikan penulis putusan; null = berhasil. */
  tolakanPenulis: null as string | null,
  penulisMelempar: false,
};

function hasilPutusan(input: Panggilan, status: "DISETUJUI" | "DITOLAK" | "DIBATALKAN") {
  if (state.penulisMelempar) throw new Error("basis data mati");
  if (state.tolakanPenulis) return { ok: false, alasan: state.tolakanPenulis };
  return { ok: true, returnId: input.returnId, spgSaleId: "sale1", status };
}

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.disegarkan.push(path);
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/spg/retur-pembeli", () => ({
  catatReturPembeli: vi.fn(async (input: Panggilan) => {
    state.dicatat.push(input);
    return { ok: true, returnId: "r1" };
  }),
  setujuiReturPembeli: vi.fn(async (input: Panggilan) => {
    state.disetujui.push(input);
    return hasilPutusan(input, "DISETUJUI");
  }),
  tolakReturPembeli: vi.fn(async (input: Panggilan) => {
    state.ditolak.push(input);
    return hasilPutusan(input, "DITOLAK");
  }),
  tarikReturPembeli: vi.fn(async (input: Panggilan) => {
    state.ditarik.push(input);
    return hasilPutusan(input, "DIBATALKAN");
  }),
}));

const { catatReturPembeliAction, setujuiReturPembeliAction, tolakReturPembeliAction, tarikReturPembeliAction } =
  await import("./spg-retur");

const ISI = {
  spgSaleId: "sale1",
  alasan: "ukuran",
  idempotencyKey: "hp-1",
  baris: [{ saleLineId: "l1", qty: 1, condition: "LAYAK" }],
};

const SPG = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
const PENYETUJU = { user: { id: "adm1", permissions: ["spg_sales:view", "spg_returns:approve"] } };
const PENGAWAS = { user: { id: "awas1", permissions: ["spg_sales:view"] } };

async function diam<T>(jalan: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await jalan();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  state.sesi = SPG;
  state.tokoTetap = "s1";
  state.dicatat = [];
  state.disetujui = [];
  state.ditolak = [];
  state.ditarik = [];
  state.disegarkan = [];
  state.tolakanPenulis = null;
  state.penulisMelempar = false;
});

describe("catatReturPembeliAction", () => {
  it("uses the SPG's fixed store, ignoring any store the phone sends", async () => {
    expect(await catatReturPembeliAction({ ...ISI, storeId: "s9" })).toEqual({ ok: true, returnId: "r1" });
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", userId: "spg1", spgSaleId: "sale1" });
  });

  it("refuses without spg_sales:record", async () => {
    state.sesi = { user: { id: "u1", permissions: ["pwa:access"] } };
    expect(await catatReturPembeliAction(ISI)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses a user with no fixed store", async () => {
    state.tokoTetap = null;
    expect(await catatReturPembeliAction(ISI)).toEqual({ ok: false, kode: "TANPA_TOKO" });
  });

  it("refuses a malformed payload", async () => {
    expect(await catatReturPembeliAction({ ...ISI, baris: [{ saleLineId: "l1", qty: 1.5 }] })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
  });

  it("refreshes the office approval list and the SPG's own report list", async () => {
    await catatReturPembeliAction(ISI);
    expect(state.disegarkan).toEqual(expect.arrayContaining(["/backoffice/retur-spg", "/pwa/spg/retur-pembeli"]));
  });
});

describe("setujuiReturPembeliAction", () => {
  it("refuses an SPG supervisor who may only view (spg_sales:view alone)", async () => {
    state.sesi = PENGAWAS;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.disetujui).toHaveLength(0);
  });

  it("refuses the SPG who recorded it (spg_sales:record is not an approval)", async () => {
    state.sesi = SPG;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.disetujui).toHaveLength(0);
  });

  it("refuses with no session at all", async () => {
    state.sesi = null;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });

  it("passes the session user as the approver and refreshes the pages the approval changes", async () => {
    state.sesi = PENYETUJU;
    expect(await setujuiReturPembeliAction({ returnId: "r1", olehUserId: "orang-lain" })).toEqual({ ok: true });
    expect(state.disetujui).toEqual([{ returnId: "r1", olehUserId: "adm1" }]);
    expect(state.disegarkan).toEqual(
      expect.arrayContaining([
        "/backoffice/retur-spg",
        "/backoffice/retur-spg/r1",
        "/backoffice/spg-sales/sale1",
        "/pwa/spg/retur-pembeli",
        "/pwa/spg/sale1/kembali",
        "/pwa/spg/stok",
      ]),
    );
  });

  it("lets the admin wildcard approve", async () => {
    state.sesi = { user: { id: "admin", permissions: ["*"] } };
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: true });
  });

  it("refuses a malformed payload", async () => {
    state.sesi = PENYETUJU;
    expect(await setujuiReturPembeliAction({})).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await setujuiReturPembeliAction({ returnId: "x".repeat(65) })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(state.disetujui).toHaveLength(0);
  });

  it("passes the writer's refusal through and refreshes nothing", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "PELAPOR_SAMA";
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "PELAPOR_SAMA" });
    expect(state.disegarkan).toEqual([]);
  });

  it("returns GAGAL when the writer throws", async () => {
    state.sesi = PENYETUJU;
    state.penulisMelempar = true;
    expect(await diam(() => setujuiReturPembeliAction({ returnId: "r1" }))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("tolakReturPembeliAction", () => {
  it("refuses an SPG supervisor who may only view (spg_sales:view alone)", async () => {
    state.sesi = PENGAWAS;
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "foto tidak jelas" })).toEqual({
      ok: false,
      kode: "TANPA_AKSES",
    });
    expect(state.ditolak).toHaveLength(0);
  });

  it("passes the session user as the decider, with the reason as typed (the writer trims it)", async () => {
    state.sesi = PENYETUJU;
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "  barang tidak sampai  " })).toEqual({ ok: true });
    expect(state.ditolak).toEqual([{ returnId: "r1", olehUserId: "adm1", alasan: "  barang tidak sampai  " }]);
  });

  it("leaves an empty or blank reason to the writer, so the office reads ALASAN_WAJIB", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "ALASAN_WAJIB";
    for (const alasan of ["", "   "]) {
      expect(await tolakReturPembeliAction({ returnId: "r1", alasan })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    }
    expect(state.ditolak).toEqual([
      { returnId: "r1", olehUserId: "adm1", alasan: "" },
      { returnId: "r1", olehUserId: "adm1", alasan: "   " },
    ]);
  });

  it("refuses a missing or over-long reason before the writer runs", async () => {
    state.sesi = PENYETUJU;
    expect(await tolakReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "x".repeat(501) })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(state.ditolak).toHaveLength(0);
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "x".repeat(500) })).toEqual({ ok: true });
  });

  it("passes the writer's refusal through", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "SUDAH_DIPUTUSKAN";
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" })).toEqual({
      ok: false,
      kode: "SUDAH_DIPUTUSKAN",
    });
  });

  it("does not refresh the stock and pay pages, since a rejection moves nothing", async () => {
    state.sesi = PENYETUJU;
    await tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" });
    expect(state.disegarkan).toEqual(expect.arrayContaining(["/backoffice/retur-spg", "/pwa/spg/retur-pembeli"]));
    expect(state.disegarkan).not.toContain("/pwa/spg/stok");
    expect(state.disegarkan).not.toContain("/pwa/spg/gaji");
  });

  it("returns GAGAL when the writer throws", async () => {
    state.sesi = PENYETUJU;
    state.penulisMelempar = true;
    expect(await diam(() => tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" }))).toEqual({
      ok: false,
      kode: "GAGAL",
    });
  });
});

describe("tarikReturPembeliAction", () => {
  it("refuses without spg_sales:record, even for an approver", async () => {
    state.sesi = PENYETUJU;
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({
      ok: false,
      kode: "TANPA_AKSES",
    });
    expect(state.ditarik).toHaveLength(0);
  });

  it("refuses a user with no fixed store", async () => {
    state.tokoTetap = null;
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({
      ok: false,
      kode: "TANPA_TOKO",
    });
    expect(state.ditarik).toHaveLength(0);
  });

  it("passes the server's fixed store and the session user, never what the phone sends", async () => {
    expect(
      await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota", storeId: "s9", userId: "spg9" }),
    ).toEqual({ ok: true });
    expect(state.ditarik).toEqual([{ returnId: "r1", alasan: "salah nota", storeId: "s1", userId: "spg1" }]);
  });

  it("refuses a malformed payload", async () => {
    expect(await tarikReturPembeliAction({ returnId: "", alasan: "salah nota" })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "x".repeat(501) })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(state.ditarik).toHaveLength(0);
  });

  it("passes the writer's refusal through", async () => {
    state.tolakanPenulis = "BUKAN_MILIK";
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({
      ok: false,
      kode: "BUKAN_MILIK",
    });
  });

  it("returns GAGAL when the writer throws", async () => {
    state.penulisMelempar = true;
    expect(await diam(() => tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" }))).toEqual({
      ok: false,
      kode: "GAGAL",
    });
  });
});
