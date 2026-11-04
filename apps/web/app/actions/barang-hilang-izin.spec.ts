import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Siapa menanggung barang hilang SPG adalah keputusan manager:
 * `receivables:decide_bearer` (keputusan pemilik 2026-11-01), dulu
 * `receivables:manage`. Itu juga berlaku untuk MEMBATALKAN catatan yang sudah
 * diputuskan — pembatalan menghapus bagian penanggungnya dan membalik jurnalnya,
 * jadi tanpa pagar ini pemegang izin kelola menganulir keputusan yang tidak
 * boleh ia buat. Tanpa basis data: penulis dan pembacaan status ditiru.
 *
 * Selisih retur toko punya izinnya sendiri (P22, `store_returns:decide_shortfall`):
 * izin itu saja tidak memutuskan barang hilang. Klaim ekspedisi: jawaban ekspedisi
 * dicatat pengelola piutang, uangnya dicek pemeriksa pembayaran (`payments:verify`,
 * keputusan 11), nilainya diubah pemutus penanggung.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  status: "TERBUKA" as string | null,
  dipanggil: [] as string[],
  /** Hasil `periksaKlaimEkspedisi` tiruan: SAH = dibayar. */
  dibayar: true,
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
    putuskanKlaimEkspedisi: vi.fn(async () => {
      state.dipanggil.push("putuskanKlaimEkspedisi");
      return { ok: true, lossId: "l1" };
    }),
    periksaKlaimEkspedisi: vi.fn(async () => {
      state.dipanggil.push("periksaKlaimEkspedisi");
      return { ok: true, lossId: "l1", dibayar: state.dibayar };
    }),
    ubahNilaiKlaimEkspedisi: vi.fn(async () => {
      state.dipanggil.push("ubahNilaiKlaimEkspedisi");
      return { ok: true, lossId: "l1" };
    }),
  };
});

const aksi = await import("./barang-hilang");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  vi.clearAllMocks();
  state.sesi = null;
  state.status = "TERBUKA";
  state.dipanggil = [];
  state.dibayar = true;
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

  it("izin selisih retur toko saja (P22) tidak memutuskan barang hilang", async () => {
    masuk(["store_returns:decide_shortfall"]);
    expect(await aksi.putuskanBarangHilangAction(KEPUTUSAN)).toEqual(DITOLAK);
    expect(await aksi.ubahKeputusanHilangAction(KEPUTUSAN)).toEqual(DITOLAK);
    state.status = "DITETAPKAN";
    expect(await batalkan()).toEqual(DITOLAK);
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

describe("klaim ekspedisi", () => {
  const JAWABAN = { shareId: "sh1", hasil: "DIBAYAR" as const, cara: "transfer", catatan: null };
  const PERIKSA = { shareId: "sh1", hasil: "SAH" as const, catatan: null };
  const NILAI = { shareId: "sh1", nilai: 75_000, catatan: "sepakat dengan ekspedisi" };

  it("mencatat jawaban ekspedisi = receivables:manage; pemutus penanggung dan pemeriksa pembayaran saja ditolak", async () => {
    for (const izin of [["receivables:decide_bearer"], ["payments:verify"], ["spg_sales:view"]]) {
      masuk(izin);
      expect(await aksi.putuskanKlaimEkspedisiAction(JAWABAN)).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
    masuk(["receivables:manage"]);
    expect(await aksi.putuskanKlaimEkspedisiAction(JAWABAN)).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["putuskanKlaimEkspedisi"]);
  });

  it("mengirim pelaku dari sesi, dan hasil yang tidak dikenal tidak sampai ke penulis", async () => {
    const penulis = await import("@/lib/spg/hilang-writer");
    masuk(["receivables:manage"]);
    await aksi.putuskanKlaimEkspedisiAction({ ...JAWABAN, olehUserId: "orang-lain" } as never);
    expect(vi.mocked(penulis.putuskanKlaimEkspedisi)).toHaveBeenLastCalledWith(
      expect.objectContaining({ shareId: "sh1", hasil: "DIBAYAR", cara: "transfer", olehUserId: "u1" }),
    );
    state.dipanggil = [];
    expect(await aksi.putuskanKlaimEkspedisiAction({ ...JAWABAN, hasil: "SAH" } as never)).toEqual({ ok: false, code: "INVALID" });
    expect(await aksi.putuskanKlaimEkspedisiAction({ ...JAWABAN, shareId: "" })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(state.dipanggil).toEqual([]);
  });

  it("memeriksa uang klaim = payments:verify; pengelola piutang dan pemutus penanggung ditolak", async () => {
    for (const izin of [["receivables:manage"], ["receivables:decide_bearer"], ["receivables:manage", "receivables:decide_bearer"]]) {
      masuk(izin);
      expect(await aksi.periksaKlaimEkspedisiAction(PERIKSA)).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
    masuk(["payments:verify"]);
    expect(await aksi.periksaKlaimEkspedisiAction(PERIKSA)).toEqual({ ok: true, dibayar: true });
    expect(state.dipanggil).toEqual(["periksaKlaimEkspedisi"]);
  });

  it("uang yang sah menjurnal pemulihan bebannya; yang dikembalikan tidak", async () => {
    const kait = await import("@/lib/finance/operasional/kait");
    masuk(["payments:verify"]);
    await aksi.periksaKlaimEkspedisiAction(PERIKSA);
    expect(vi.mocked(kait.kaitBarangHilang)).toHaveBeenCalledWith("l1", "u1");
    vi.mocked(kait.kaitBarangHilang).mockClear();
    state.dibayar = false;
    expect(await aksi.periksaKlaimEkspedisiAction({ ...PERIKSA, hasil: "KEMBALIKAN", catatan: "mutasi tidak ada" })).toEqual({
      ok: true,
      dibayar: false,
    });
    expect(vi.mocked(kait.kaitBarangHilang)).not.toHaveBeenCalled();
  });

  it("penolakan penulis diteruskan, dan tidak ada jurnal", async () => {
    const penulis = await import("@/lib/spg/hilang-writer");
    const kait = await import("@/lib/finance/operasional/kait");
    vi.mocked(penulis.periksaKlaimEkspedisi).mockResolvedValueOnce({ ok: false, kode: "PEMERIKSA_SAMA" });
    masuk(["payments:verify"]);
    expect(await aksi.periksaKlaimEkspedisiAction(PERIKSA)).toEqual({ ok: false, code: "PEMERIKSA_SAMA" });
    expect(vi.mocked(kait.kaitBarangHilang)).not.toHaveBeenCalled();
  });

  it("mengubah nilai klaim = receivables:decide_bearer; pengelola, pemeriksa, dan izin selisih retur ditolak", async () => {
    for (const izin of [["receivables:manage"], ["payments:verify"], ["store_returns:decide_shortfall"]]) {
      masuk(izin);
      expect(await aksi.ubahNilaiKlaimEkspedisiAction(NILAI)).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
    masuk(["receivables:decide_bearer"]);
    expect(await aksi.ubahNilaiKlaimEkspedisiAction(NILAI)).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["ubahNilaiKlaimEkspedisi"]);
  });

  it("galat basis data menjadi GAGAL, bukan lemparan", async () => {
    const penulis = await import("@/lib/spg/hilang-writer");
    vi.mocked(penulis.putuskanKlaimEkspedisi).mockRejectedValueOnce(new Error("basis data mati"));
    const diam = vi.spyOn(console, "error").mockImplementation(() => {});
    masuk(["receivables:manage"]);
    expect(await aksi.putuskanKlaimEkspedisiAction(JAWABAN)).toEqual({ ok: false, code: "GAGAL" });
    diam.mockRestore();
  });
});
