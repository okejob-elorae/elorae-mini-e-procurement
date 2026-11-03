import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi retur pembeli SPG (`retur-spg.ts`): toko selalu toko tetap SPG, apa pun
 * yang dikirim HP; kunci kiriman harus aman sebagai segmen kunci R2; langkah HP
 * butuh `spg_sales:record`, setiap keputusan kantor `spg_returns:approve` —
 * izin yang sama dengan tombolnya. Tanpa basis data.
 */

type Panggilan = Record<string, unknown>;

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: "s1" as string | null,
  panggil: {} as Record<string, Panggilan[]>,
  disegarkan: [] as string[],
  tolakanPenulis: null as string | null,
  penulisMelempar: false,
};

function catat(nama: string, input: Panggilan) {
  (state.panggil[nama] ??= []).push(input);
  if (state.penulisMelempar) throw new Error("basis data mati");
  if (state.tolakanPenulis) return { ok: false, alasan: state.tolakanPenulis };
  return null;
}

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.disegarkan.push(path);
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/spg/retur-pembeli", () => ({
  catatReturPembeli: vi.fn(async (i: Panggilan) => catat("lapor", i) ?? { ok: true, returnId: "r1" }),
  setujuiReturPembeli: vi.fn(async (i: Panggilan) => catat("setujui", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1", status: "DISETUJUI" }),
  tolakReturPembeli: vi.fn(async (i: Panggilan) => catat("tolak", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1", status: "DITOLAK" }),
  tarikReturPembeli: vi.fn(async (i: Panggilan) => catat("tarik", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1", status: "DIBATALKAN" }),
  catatUangDikembalikan: vi.fn(async (i: Panggilan) => catat("uang", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1", ulang: false }),
  batalkanPenolakanReturPembeli: vi.fn(async (i: Panggilan) => catat("batal", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1" }),
  putuskanBarangReturPembeli: vi.fn(async (i: Panggilan) => catat("barang", i) ?? { ok: true, returnId: i.returnId, spgSaleId: "sale1" }),
}));
vi.mock("@/lib/spg/beban-spg-writer", () => ({
  ubahBesarBebanSpg: vi.fn(async (i: Panggilan) => catat("besar", i) ?? { ok: true, chargeId: "c1", returnId: i.returnId, spgUserId: "spg1" }),
}));

const aksi = await import("./retur-spg");

const SPG = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
const PENYETUJU = { user: { id: "adm1", permissions: ["spg_sales:view", "spg_returns:approve"] } };
const PENGAWAS = { user: { id: "awas1", permissions: ["spg_sales:view"] } };

const LAPOR = {
  spgSaleId: "sale1",
  alasan: "ukuran",
  idempotencyKey: "local-1730000000000-abc",
  baris: [{ saleLineId: "l1", qty: 1, condition: "LAYAK" }],
  fotoBarangKey: "spg-sale-returns/s1/local-1730000000000-abc/barang.jpg",
  uangSudahDikembalikan: true,
  fotoStrukKey: "spg-sale-returns/s1/local-1730000000000-abc/struk.jpg",
};

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
  state.panggil = {};
  state.disegarkan = [];
  state.tolakanPenulis = null;
  state.penulisMelempar = false;
});

describe("catatReturPembeliAction", () => {
  it("passes the photo keys and money answer through, with the server store and session user", async () => {
    expect(await aksi.catatReturPembeliAction({ ...LAPOR, storeId: "toko-dari-hp" })).toEqual({ ok: true, returnId: "r1" });
    expect(state.panggil.lapor[0]).toMatchObject({
      storeId: "s1",
      userId: "spg1",
      fotoBarangKey: LAPOR.fotoBarangKey,
      uangSudahDikembalikan: true,
      fotoStrukKey: LAPOR.fotoStrukKey,
      waktuTangkap: null,
    });
    expect(state.disegarkan).toContain("/backoffice/retur-spg");
  });

  it("an unsafe report key is refused as unreadable input, never as a missing photo", async () => {
    for (const idempotencyKey of ["a/b", "x".repeat(65), "dengan spasi", "../x"]) {
      expect(await aksi.catatReturPembeliAction({ ...LAPOR, idempotencyKey })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    }
    expect(state.panggil.lapor).toBeUndefined();
  });

  it("a missing money answer is the writer's to decide (JAWABAN_UANG_WAJIB), not the schema's", async () => {
    const { uangSudahDikembalikan: _u, ...tanpa } = LAPOR;
    await aksi.catatReturPembeliAction(tanpa);
    expect(state.panggil.lapor[0]).toMatchObject({ uangSudahDikembalikan: null });
  });

  it("refuses without permission or fixed store; an offline time older than the queue limit is refused", async () => {
    state.sesi = PENGAWAS;
    expect(await aksi.catatReturPembeliAction(LAPOR)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    state.sesi = SPG;
    state.tokoTetap = null;
    expect(await aksi.catatReturPembeliAction(LAPOR)).toEqual({ ok: false, kode: "TANPA_TOKO" });
    state.tokoTetap = "s1";
    expect(await aksi.catatReturPembeliAction({ ...LAPOR, luring: true, waktuTangkap: "2020-01-01T00:00:00.000Z" })).toEqual({ ok: false, kode: "WAKTU_TIDAK_VALID" });
  });

  it("passes refusals through and maps a throw to GAGAL", async () => {
    state.tolakanPenulis = "FOTO_BARANG_WAJIB";
    expect(await aksi.catatReturPembeliAction(LAPOR)).toEqual({ ok: false, kode: "FOTO_BARANG_WAJIB" });
    state.tolakanPenulis = null;
    state.penulisMelempar = true;
    expect(await diam(() => aksi.catatReturPembeliAction(LAPOR))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("catatUangDikembalikanAction", () => {
  const ISI = { returnId: "r1", fotoStrukKey: "spg-sale-returns/s1/k/struk.jpg" };

  it("needs spg_sales:record and a fixed store; the store and user come from the server", async () => {
    state.sesi = PENYETUJU;
    expect(await aksi.catatUangDikembalikanAction(ISI)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    state.sesi = SPG;
    state.tokoTetap = null;
    expect(await aksi.catatUangDikembalikanAction(ISI)).toEqual({ ok: false, kode: "TANPA_TOKO" });
    state.tokoTetap = "s1";
    expect(await aksi.catatUangDikembalikanAction(ISI)).toEqual({ ok: true });
    expect(state.panggil.uang[0]).toMatchObject({ returnId: "r1", userId: "spg1", storeId: "s1", fotoStrukKey: ISI.fotoStrukKey, waktuTangkap: null });
  });

  it("an offline capture is clamped and passed on; a future one becomes now", async () => {
    const tadi = new Date(Date.now() - 60_000).toISOString();
    await aksi.catatUangDikembalikanAction({ ...ISI, luring: true, waktuTangkap: tadi });
    expect((state.panggil.uang[0].waktuTangkap as Date).toISOString()).toBe(tadi);
    const nanti = new Date(Date.now() + 3_600_000).toISOString();
    await aksi.catatUangDikembalikanAction({ ...ISI, luring: true, waktuTangkap: nanti });
    expect((state.panggil.uang[1].waktuTangkap as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("passes the writer's refusal through", async () => {
    state.tolakanPenulis = "TIDAK_DISETUJUI";
    expect(await aksi.catatUangDikembalikanAction(ISI)).toEqual({ ok: false, kode: "TIDAK_DISETUJUI" });
  });
});

describe("office decisions need spg_returns:approve", () => {
  const kasus: [string, (i: unknown) => Promise<unknown>, Panggilan, string][] = [
    ["setujui", aksi.setujuiReturPembeliAction, { returnId: "r1" }, "setujui"],
    ["tolak", aksi.tolakReturPembeliAction, { returnId: "r1", alasan: "x" }, "tolak"],
    ["batalkan penolakan", aksi.batalkanPenolakanReturPembeliAction, { returnId: "r1", alasan: "keliru" }, "batal"],
    ["putuskan barang", aksi.putuskanBarangReturPembeliAction, { returnId: "r1", keputusan: "KEMBALI_STOK" }, "barang"],
    ["ubah besar beban", aksi.ubahBesarBebanSpgAction, { returnId: "r1", besar: 40_000, alasan: "struk" }, "besar"],
  ];

  it.each(kasus)("%s: refused for the SPG and for a viewer; allowed for the approver, as the session user", async (_n, fn, isi, kunci) => {
    for (const sesi of [SPG, PENGAWAS]) {
      state.sesi = sesi;
      expect(await fn(isi)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    }
    expect(state.panggil[kunci]).toBeUndefined();
    state.sesi = PENYETUJU;
    expect(await fn(isi)).toEqual({ ok: true });
    expect(state.panggil[kunci][0]).toMatchObject({ olehUserId: "adm1" });
  });

  it("reject passes the P78 mark and the P81 amount through", async () => {
    state.sesi = PENYETUJU;
    await aksi.tolakReturPembeliAction({
      returnId: "r1",
      alasan: "tidak sesuai",
      uangTernyataDikembalikan: true,
      alasanUangKembali: "toko melapor",
      besarBeban: 45_000,
      alasanBesarBeban: "struk kasir",
    });
    expect(state.panggil.tolak[0]).toMatchObject({
      uangTernyataDikembalikan: true,
      alasanUangKembali: "toko melapor",
      besarBeban: 45_000,
      alasanBesarBeban: "struk kasir",
    });
  });

  it("an unknown goods decision or a non-numeric amount is unreadable input", async () => {
    state.sesi = PENYETUJU;
    expect(await aksi.putuskanBarangReturPembeliAction({ returnId: "r1", keputusan: "DIHAPUS" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await aksi.ubahBesarBebanSpgAction({ returnId: "r1", besar: "banyak", alasan: "x" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
  });

  it("passes refusals through and maps a throw to GAGAL", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "SUDAH_DIPOTONG";
    expect(await aksi.batalkanPenolakanReturPembeliAction({ returnId: "r1", alasan: "x" })).toEqual({ ok: false, kode: "SUDAH_DIPOTONG" });
    state.tolakanPenulis = "PELAPOR_SAMA";
    expect(await aksi.ubahBesarBebanSpgAction({ returnId: "r1", besar: 1, alasan: "x" })).toEqual({ ok: false, kode: "PELAPOR_SAMA" });
    state.tolakanPenulis = null;
    state.penulisMelempar = true;
    expect(await diam(() => aksi.putuskanBarangReturPembeliAction({ returnId: "r1", keputusan: "DIBELI_SPG" }))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("tarikReturPembeliAction", () => {
  it("uses the server store and passes UANG_SUDAH_DIKEMBALIKAN through", async () => {
    state.tolakanPenulis = "UANG_SUDAH_DIKEMBALIKAN";
    expect(await aksi.tarikReturPembeliAction({ returnId: "r1", alasan: "salah" })).toEqual({ ok: false, kode: "UANG_SUDAH_DIKEMBALIKAN" });
    expect(state.panggil.tarik[0]).toMatchObject({ storeId: "s1", userId: "spg1" });
  });
});
