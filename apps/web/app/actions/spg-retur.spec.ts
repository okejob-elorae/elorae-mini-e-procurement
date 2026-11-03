import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi retur pembeli SPG (keputusan pemilik 2026-11-02, P12–P14, P77–P83), lewat alamat lama
 * `./spg-retur` yang meneruskan ke `./retur-spg` — satu aturan untuk kedua alamat.
 *
 * Toko retur pembeli selalu toko tetap SPG, apa pun yang dikirim HP; pelaku selalu pengguna sesi.
 * HP SPG (`spg_sales:record`) melapor, mencatat uang yang dikembalikan kasir, dan menarik laporan;
 * kantor memutuskan hanya dengan `spg_returns:approve`, izin yang sama dengan tombolnya. Alasan
 * kosong diputuskan penulis (`ALASAN_WAJIB`), bukan skema. Tanpa basis data.
 */

type Panggilan = Record<string, unknown>;

const state = {
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] } } as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: "s1" as string | null,
  panggilan: {} as Record<string, Panggilan[]>,
  disegarkan: [] as string[],
  /** Kode tolak yang dikembalikan penulis; null = berhasil. */
  tolakanPenulis: null as string | null,
  penulisMelempar: false,
};

function catat(nama: string, input: Panggilan) {
  (state.panggilan[nama] ??= []).push(input);
}

function hasilPutusan(nama: string, input: Panggilan) {
  catat(nama, input);
  if (state.penulisMelempar) throw new Error("basis data mati");
  if (state.tolakanPenulis) return { ok: false, alasan: state.tolakanPenulis };
  return { ok: true, returnId: input.returnId, spgSaleId: "sale1", status: "DISETUJUI" };
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
    catat("catatReturPembeli", input);
    if (state.penulisMelempar) throw new Error("basis data mati");
    if (state.tolakanPenulis) return { ok: false, alasan: state.tolakanPenulis };
    return { ok: true, returnId: "r1" };
  }),
  setujuiReturPembeli: vi.fn(async (input: Panggilan) => hasilPutusan("setujuiReturPembeli", input)),
  tolakReturPembeli: vi.fn(async (input: Panggilan) => hasilPutusan("tolakReturPembeli", input)),
  tarikReturPembeli: vi.fn(async (input: Panggilan) => hasilPutusan("tarikReturPembeli", input)),
  catatUangDikembalikan: vi.fn(async (input: Panggilan) => hasilPutusan("catatUangDikembalikan", input)),
  batalkanPenolakanReturPembeli: vi.fn(async (input: Panggilan) => hasilPutusan("batalkanPenolakanReturPembeli", input)),
  putuskanBarangReturPembeli: vi.fn(async (input: Panggilan) => hasilPutusan("putuskanBarangReturPembeli", input)),
}));
vi.mock("@/lib/spg/beban-spg-writer", () => ({
  ubahBesarBebanSpg: vi.fn(async (input: Panggilan) => {
    catat("ubahBesarBebanSpg", input);
    if (state.tolakanPenulis) return { ok: false, alasan: state.tolakanPenulis };
    return { ok: true, returnId: input.returnId, spgUserId: "spg1" };
  }),
}));

const {
  batalkanPenolakanReturPembeliAction,
  catatReturPembeliAction,
  catatUangDikembalikanAction,
  putuskanBarangReturPembeliAction,
  setujuiReturPembeliAction,
  tarikReturPembeliAction,
  tolakReturPembeliAction,
  ubahBesarBebanSpgAction,
} = await import("./spg-retur");

const DASAR = {
  spgSaleId: "sale1",
  alasan: "ukuran",
  idempotencyKey: "hp-1",
  baris: [{ saleLineId: "l1", qty: 1, condition: "LAYAK" }],
};
const ISI = { ...DASAR, fotoBarangKey: "spg-sale-returns/s1/hp-1/barang.jpg", uangSudahDikembalikan: false };

const SPG = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
const PENYETUJU = { user: { id: "adm1", permissions: ["spg_sales:view", "spg_returns:approve"] } };
const PENGAWAS = { user: { id: "awas1", permissions: ["spg_sales:view"] } };

const dipanggil = (nama: string) => state.panggilan[nama] ?? [];

async function diam<T>(jalan: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await jalan();
  } finally {
    spy.mockRestore();
  }
}

/** Instan ISO `jam` jam yang lalu. */
const jamLalu = (jam: number) => new Date(Date.now() - jam * 3_600_000).toISOString();

beforeEach(() => {
  state.sesi = SPG;
  state.tokoTetap = "s1";
  state.panggilan = {};
  state.disegarkan = [];
  state.tolakanPenulis = null;
  state.penulisMelempar = false;
});

describe("catatReturPembeliAction", () => {
  it("uses the SPG's fixed store and the session user, ignoring any store the phone sends", async () => {
    expect(await catatReturPembeliAction({ ...ISI, storeId: "s9", userId: "spg9" })).toEqual({ ok: true, returnId: "r1" });
    expect(dipanggil("catatReturPembeli")[0]).toMatchObject({ storeId: "s1", userId: "spg1", spgSaleId: "sale1" });
  });

  it("passes the goods photo, the money answer and the receipt photo through as typed", async () => {
    const isian = { ...ISI, uangSudahDikembalikan: true, fotoStrukKey: "spg-sale-returns/s1/hp-1/struk.jpg" };
    expect(await catatReturPembeliAction(isian)).toEqual({ ok: true, returnId: "r1" });
    expect(dipanggil("catatReturPembeli")[0]).toMatchObject({
      fotoBarangKey: "spg-sale-returns/s1/hp-1/barang.jpg",
      uangSudahDikembalikan: true,
      fotoStrukKey: "spg-sale-returns/s1/hp-1/struk.jpg",
      waktuTangkap: null,
    });
  });

  it("leaves a missing photo or money answer to the writer, whose refusal comes back as its own code", async () => {
    state.tolakanPenulis = "FOTO_BARANG_WAJIB";
    expect(await catatReturPembeliAction(DASAR)).toEqual({ ok: false, kode: "FOTO_BARANG_WAJIB" });
    expect(dipanggil("catatReturPembeli")[0]).toMatchObject({ fotoBarangKey: null, uangSudahDikembalikan: null, fotoStrukKey: null });
  });

  it("refuses a form key that cannot be an R2 key segment — it names the photos' folder", async () => {
    for (const idempotencyKey of ["hp/1", "hp 1", "x".repeat(65)]) {
      expect(await catatReturPembeliAction({ ...ISI, idempotencyKey })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    }
    expect(dipanggil("catatReturPembeli")).toHaveLength(0);
  });

  it("refuses without spg_sales:record", async () => {
    state.sesi = { user: { id: "u1", permissions: ["pwa:access"] } };
    expect(await catatReturPembeliAction(ISI)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(dipanggil("catatReturPembeli")).toHaveLength(0);
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

  it("a report from the phone queue is recorded at the time it was made; one too old is refused", async () => {
    const waktu = jamLalu(3);
    expect(await catatReturPembeliAction({ ...ISI, luring: true, waktuTangkap: waktu })).toEqual({ ok: true, returnId: "r1" });
    expect(dipanggil("catatReturPembeli")[0]).toMatchObject({ waktuTangkap: new Date(waktu) });
    expect(await catatReturPembeliAction({ ...ISI, luring: true, waktuTangkap: jamLalu(24 * 15) })).toEqual({
      ok: false,
      kode: "WAKTU_TIDAK_VALID",
    });
    expect(dipanggil("catatReturPembeli")).toHaveLength(1);
  });

  it("refreshes the office approval list and the SPG's own report list", async () => {
    await catatReturPembeliAction(ISI);
    expect(state.disegarkan).toEqual(expect.arrayContaining(["/backoffice/retur-spg", "/pwa/spg/retur-pembeli"]));
  });

  it("returns GAGAL when the writer throws", async () => {
    state.penulisMelempar = true;
    expect(await diam(() => catatReturPembeliAction(ISI))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("setujuiReturPembeliAction", () => {
  it("refuses an SPG supervisor who may only view (spg_sales:view alone)", async () => {
    state.sesi = PENGAWAS;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(dipanggil("setujuiReturPembeli")).toHaveLength(0);
  });

  it("refuses the SPG who recorded it (spg_sales:record is not an approval)", async () => {
    state.sesi = SPG;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(dipanggil("setujuiReturPembeli")).toHaveLength(0);
  });

  it("refuses with no session at all", async () => {
    state.sesi = null;
    expect(await setujuiReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });

  it("passes the session user as the approver and refreshes the pages the approval changes", async () => {
    state.sesi = PENYETUJU;
    expect(await setujuiReturPembeliAction({ returnId: "r1", olehUserId: "orang-lain" })).toEqual({ ok: true });
    expect(dipanggil("setujuiReturPembeli")).toEqual([{ returnId: "r1", olehUserId: "adm1" }]);
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
    expect(await setujuiReturPembeliAction({ returnId: "x".repeat(65) })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(dipanggil("setujuiReturPembeli")).toHaveLength(0);
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
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "foto tidak jelas" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(dipanggil("tolakReturPembeli")).toHaveLength(0);
  });

  it("passes the session user as the decider, the reason as typed, and no money answer when none was given", async () => {
    state.sesi = PENYETUJU;
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "  barang tidak sampai  " })).toEqual({ ok: true });
    expect(dipanggil("tolakReturPembeli")).toEqual([
      {
        returnId: "r1",
        olehUserId: "adm1",
        alasan: "  barang tidak sampai  ",
        uangTernyataDikembalikan: false,
        alasanUangKembali: null,
        besarBeban: null,
        alasanBesarBeban: null,
      },
    ]);
  });

  it("passes 'the money was already refunded' and the charge amount with their reasons (P78, P81)", async () => {
    state.sesi = PENYETUJU;
    const isian = {
      returnId: "r1",
      alasan: "bukan barang toko",
      uangTernyataDikembalikan: true,
      alasanUangKembali: "kasir sudah membayar",
      besarBeban: 150_000,
      alasanBesarBeban: "angka struk",
    };
    expect(await tolakReturPembeliAction(isian)).toEqual({ ok: true });
    expect(dipanggil("tolakReturPembeli")[0]).toEqual({ ...isian, olehUserId: "adm1" });
  });

  it("leaves an empty or blank reason to the writer, so the office reads ALASAN_WAJIB", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "ALASAN_WAJIB";
    for (const alasan of ["", "   "]) {
      expect(await tolakReturPembeliAction({ returnId: "r1", alasan })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    }
    expect(dipanggil("tolakReturPembeli").map((p) => p.alasan)).toEqual(["", "   "]);
  });

  it("refuses a missing or over-long reason, or a charge that is not a number, before the writer runs", async () => {
    state.sesi = PENYETUJU;
    expect(await tolakReturPembeliAction({ returnId: "r1" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "x".repeat(501) })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "dobel", besarBeban: "150000" })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(dipanggil("tolakReturPembeli")).toHaveLength(0);
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "x".repeat(500) })).toEqual({ ok: true });
  });

  it("passes the writer's refusal through", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "SUDAH_DIPUTUSKAN";
    expect(await tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("refreshes the pay pages too, since a rejected report whose money was refunded charges the SPG", async () => {
    state.sesi = PENYETUJU;
    await tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" });
    expect(state.disegarkan).toEqual(
      expect.arrayContaining(["/backoffice/retur-spg", "/pwa/spg/retur-pembeli", "/pwa/spg/gaji", "/pwa/beban", "/pwa", "/backoffice/komisi-spg"]),
    );
  });

  it("returns GAGAL when the writer throws", async () => {
    state.sesi = PENYETUJU;
    state.penulisMelempar = true;
    expect(await diam(() => tolakReturPembeliAction({ returnId: "r1", alasan: "dobel" }))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("tarikReturPembeliAction", () => {
  it("refuses without spg_sales:record, even for an approver", async () => {
    state.sesi = PENYETUJU;
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(dipanggil("tarikReturPembeli")).toHaveLength(0);
  });

  it("refuses a user with no fixed store", async () => {
    state.tokoTetap = null;
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({ ok: false, kode: "TANPA_TOKO" });
    expect(dipanggil("tarikReturPembeli")).toHaveLength(0);
  });

  it("passes the server's fixed store and the session user, never what the phone sends", async () => {
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota", storeId: "s9", userId: "spg9" })).toEqual({ ok: true });
    expect(dipanggil("tarikReturPembeli")).toEqual([{ returnId: "r1", alasan: "salah nota", storeId: "s1", userId: "spg1" }]);
  });

  it("refuses a malformed payload", async () => {
    expect(await tarikReturPembeliAction({ returnId: "", alasan: "salah nota" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "x".repeat(501) })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(dipanggil("tarikReturPembeli")).toHaveLength(0);
  });

  it("passes the writer's refusal through — once the money is recorded refunded the report cannot be withdrawn", async () => {
    for (const kode of ["BUKAN_MILIK", "UANG_SUDAH_DIKEMBALIKAN"]) {
      state.tolakanPenulis = kode;
      expect(await tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" })).toEqual({ ok: false, kode });
    }
  });

  it("returns GAGAL when the writer throws", async () => {
    state.penulisMelempar = true;
    expect(await diam(() => tarikReturPembeliAction({ returnId: "r1", alasan: "salah nota" }))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("catatUangDikembalikanAction", () => {
  const UANG = { returnId: "r1", fotoStrukKey: "spg-sale-returns/s1/hp-1/struk.jpg" };

  it("refuses without spg_sales:record, even for an approver, and without a fixed store", async () => {
    state.sesi = PENYETUJU;
    expect(await catatUangDikembalikanAction(UANG)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    state.sesi = SPG;
    state.tokoTetap = null;
    expect(await catatUangDikembalikanAction(UANG)).toEqual({ ok: false, kode: "TANPA_TOKO" });
    expect(dipanggil("catatUangDikembalikan")).toHaveLength(0);
  });

  it("passes the server's fixed store, the session user and the receipt photo", async () => {
    expect(await catatUangDikembalikanAction({ ...UANG, storeId: "s9", userId: "spg9" })).toEqual({ ok: true });
    expect(dipanggil("catatUangDikembalikan")).toEqual([
      { returnId: "r1", userId: "spg1", storeId: "s1", fotoStrukKey: UANG.fotoStrukKey, waktuTangkap: null },
    ]);
    expect(state.disegarkan).toEqual(expect.arrayContaining(["/pwa/spg/retur-pembeli", "/pwa/spg/tutup", "/pwa", "/backoffice/retur-spg"]));
  });

  it("refuses a report with no receipt photo key before the writer runs", async () => {
    expect(await catatUangDikembalikanAction({ returnId: "r1" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(dipanggil("catatUangDikembalikan")).toHaveLength(0);
  });

  it("from the phone queue: recorded at the time it was made; one too old is refused", async () => {
    const waktu = jamLalu(2);
    expect(await catatUangDikembalikanAction({ ...UANG, luring: true, waktuTangkap: waktu })).toEqual({ ok: true });
    expect(dipanggil("catatUangDikembalikan")[0]).toMatchObject({ waktuTangkap: new Date(waktu) });
    expect(await catatUangDikembalikanAction({ ...UANG, luring: true, waktuTangkap: jamLalu(24 * 15) })).toEqual({
      ok: false,
      kode: "WAKTU_TIDAK_VALID",
    });
    expect(dipanggil("catatUangDikembalikan")).toHaveLength(1);
  });

  it("passes the writer's refusal through, and returns GAGAL when it throws", async () => {
    state.tolakanPenulis = "SUDAH_DICATAT";
    expect(await catatUangDikembalikanAction(UANG)).toEqual({ ok: false, kode: "SUDAH_DICATAT" });
    state.tolakanPenulis = null;
    state.penulisMelempar = true;
    expect(await diam(() => catatUangDikembalikanAction(UANG))).toEqual({ ok: false, kode: "GAGAL" });
  });
});

describe("keputusan kantor sesudah menolak (P79, P81, P82)", () => {
  it("each needs spg_returns:approve — the SPG and a viewer are refused before any writer runs", async () => {
    for (const sesi of [SPG, PENGAWAS]) {
      state.sesi = sesi;
      expect(await batalkanPenolakanReturPembeliAction({ returnId: "r1", alasan: "keliru" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
      expect(await putuskanBarangReturPembeliAction({ returnId: "r1", keputusan: "DIBELI_SPG" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
      expect(await ubahBesarBebanSpgAction({ returnId: "r1", besar: 120_000, alasan: "angka struk" })).toEqual({
        ok: false,
        kode: "TANPA_AKSES",
      });
    }
    expect(state.panggilan).toEqual({});
  });

  it("passes the session user to each writer", async () => {
    state.sesi = PENYETUJU;
    expect(await batalkanPenolakanReturPembeliAction({ returnId: "r1", alasan: "keliru", olehUserId: "x" })).toEqual({ ok: true });
    expect(await putuskanBarangReturPembeliAction({ returnId: "r1", keputusan: "KEMBALI_STOK" })).toEqual({ ok: true });
    expect(await ubahBesarBebanSpgAction({ returnId: "r1", besar: 120_000, alasan: "angka struk" })).toEqual({ ok: true });
    expect(dipanggil("batalkanPenolakanReturPembeli")).toEqual([{ returnId: "r1", olehUserId: "adm1", alasan: "keliru" }]);
    expect(dipanggil("putuskanBarangReturPembeli")).toEqual([{ returnId: "r1", keputusan: "KEMBALI_STOK", olehUserId: "adm1", catatan: null }]);
    expect(dipanggil("ubahBesarBebanSpg")).toEqual([{ returnId: "r1", olehUserId: "adm1", besar: 120_000, alasan: "angka struk" }]);
  });

  it("refuses an unknown goods decision or a charge that is not a number", async () => {
    state.sesi = PENYETUJU;
    expect(await putuskanBarangReturPembeliAction({ returnId: "r1", keputusan: "DIHAPUSKAN" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_VALID" });
    expect(await ubahBesarBebanSpgAction({ returnId: "r1", besar: Number.NaN, alasan: "angka struk" })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
    expect(state.panggilan).toEqual({});
  });

  it("passes the writers' refusals through", async () => {
    state.sesi = PENYETUJU;
    state.tolakanPenulis = "SUDAH_DIPOTONG";
    expect(await batalkanPenolakanReturPembeliAction({ returnId: "r1", alasan: "keliru" })).toEqual({ ok: false, kode: "SUDAH_DIPOTONG" });
    expect(await ubahBesarBebanSpgAction({ returnId: "r1", besar: 120_000, alasan: "angka struk" })).toEqual({
      ok: false,
      kode: "SUDAH_DIPOTONG",
    });
  });
});
