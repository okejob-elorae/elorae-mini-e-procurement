import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Siapa menanggung barang hilang SPG adalah keputusan manager:
 * `receivables:decide_bearer` (keputusan pemilik 2026-11-01), dulu
 * `receivables:manage`. Itu juga berlaku untuk MEMBATALKAN catatan yang sudah
 * diputuskan — pembatalan menghapus bagian penanggungnya dan membalik jurnalnya,
 * jadi tanpa pagar ini pemegang izin kelola menganulir keputusan yang tidak
 * boleh ia buat. Tanpa basis data: penulis dan pembacaan status ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  status: "TERBUKA" as string | null,
  dipanggil: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: { stockLoss: { findUnique: vi.fn(async () => (state.status === null ? null : { status: state.status })) } },
}));
vi.mock("@/lib/konsinyasi/stok-di-toko", () => ({ labelVarian: vi.fn(() => null) }));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBarangHilang: vi.fn(async () => {}),
  kaitPotongSales: vi.fn(async () => {}),
}));
vi.mock("@/lib/spg/hilang-writer", () => {
  const penulis = (nama: string) =>
    vi.fn(async () => {
      state.dipanggil.push(nama);
      return { ok: true, id: "l1" };
    });
  return {
    buatBarangHilang: penulis("buatBarangHilang"),
    putuskanBarangHilang: penulis("putuskanBarangHilang"),
    ubahKeputusanHilang: penulis("ubahKeputusanHilang"),
    batalkanBarangHilang: penulis("batalkanBarangHilang"),
    tandaiTokoDitagih: penulis("tandaiTokoDitagih"),
    tandaiSalesDipotong: penulis("tandaiSalesDipotong"),
  };
});

const aksi = await import("./barang-hilang");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.status = "TERBUKA";
  state.dipanggil = [];
});

const DITOLAK = { ok: false, code: "FORBIDDEN" };
const KEPUTUSAN = { lossId: "l1", bagian: [{ bearer: "ELORAE", bearerUserId: null, amount: 50_000 }] };
const batalkan = () => aksi.batalkanBarangHilangAction({ lossId: "l1", alasan: "salah catat" });

describe("memutuskan dan mengubah keputusan: receivables:decide_bearer", () => {
  it("pengelola piutang ditolak sebelum menyentuh penulis", async () => {
    masuk(["receivables:manage"]);
    expect(await aksi.putuskanBarangHilangAction(KEPUTUSAN)).toEqual(DITOLAK);
    expect(await aksi.ubahKeputusanHilangAction(KEPUTUSAN)).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin keputusan memutuskan dan mengubahnya", async () => {
    masuk(["receivables:decide_bearer"]);
    expect(await aksi.putuskanBarangHilangAction(KEPUTUSAN)).toEqual({ ok: true });
    expect(await aksi.ubahKeputusanHilangAction(KEPUTUSAN)).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["putuskanBarangHilang", "ubahKeputusanHilang"]);
  });
});

describe("membatalkan: yang terbuka milik pengelola, yang sudah diputuskan milik pemutus", () => {
  it("pengelola piutang membatalkan catatan yang masih terbuka", async () => {
    masuk(["receivables:manage"]);
    expect(await batalkan()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["batalkanBarangHilang"]);
  });

  it("pengelola piutang TIDAK bisa membatalkan catatan yang sudah diputuskan", async () => {
    masuk(["receivables:manage"]);
    for (const status of ["DITETAPKAN", "SELESAI"]) {
      state.status = status;
      expect(await batalkan()).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin keputusan membatalkan yang sudah diputuskan, tetapi tidak yang masih terbuka", async () => {
    masuk(["receivables:decide_bearer"]);
    state.status = "DITETAPKAN";
    expect(await batalkan()).toEqual({ ok: true });
    state.status = "TERBUKA";
    expect(await batalkan()).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual(["batalkanBarangHilang"]);
  });

  it("menyerahkan izinnya ke penulis, yang memeriksanya lagi di dalam transaksinya", async () => {
    const penulis = await import("@/lib/spg/hilang-writer");
    masuk(["receivables:manage"]);
    await batalkan();
    expect(vi.mocked(penulis.batalkanBarangHilang)).toHaveBeenLastCalledWith(
      expect.objectContaining({ bolehBatalkanTerbuka: true, bolehBatalkanKeputusan: false }),
    );
    masuk(["receivables:decide_bearer"]);
    state.status = "DITETAPKAN";
    await batalkan();
    expect(vi.mocked(penulis.batalkanBarangHilang)).toHaveBeenLastCalledWith(
      expect.objectContaining({ bolehBatalkanTerbuka: false, bolehBatalkanKeputusan: true }),
    );
  });

  it("keputusan yang masuk di antara baca dan tulis: penolakan penulis dilaporkan FORBIDDEN", async () => {
    const penulis = await import("@/lib/spg/hilang-writer");
    vi.mocked(penulis.batalkanBarangHilang).mockResolvedValueOnce({ ok: false, kode: "TANPA_IZIN" });
    masuk(["receivables:manage"]);
    expect(await batalkan()).toEqual(DITOLAK);
  });

  it("tanpa kedua izin ditolak; catatan yang tak ada tidak sampai ke penulis", async () => {
    masuk(["spg_sales:view"]);
    expect(await batalkan()).toEqual(DITOLAK);
    masuk(["receivables:manage"]);
    state.status = null;
    expect(await batalkan()).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(state.dipanggil).toEqual([]);
  });
});
