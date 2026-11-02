import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi siklus konsinyasi sesudah izinnya dipecah (keputusan pemilik
 * 2026-11-01). Dulu SATU izin (`consignment:manage`) mencakup mengunci angka,
 * kedua nomor dokumen, dan menandai gaji SPG dibayar — jadi admin penjualan
 * yang mengetik nomor nota sekaligus bisa mengunci angka dan mengetik faktur
 * pajak. Tanpa basis data: penulisnya ditiru, dan yang diperiksa adalah apakah
 * penulis sempat dipanggil.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/konsinyasi/writer", () => {
  const penulis = (nama: string) =>
    vi.fn(async () => {
      state.dipanggil.push(nama);
      return { ok: true };
    });
  return {
    bukaSiklus: penulis("bukaSiklus"),
    catatLaporan: penulis("catatLaporan"),
    kunciAngka: penulis("kunciAngka"),
    bukaKunci: penulis("bukaKunci"),
    bayarKomisi: penulis("bayarKomisi"),
    catatNomorDokumen: penulis("catatNomorDokumen"),
    kirimTitipan: vi.fn(),
    catatPembayaranToko: vi.fn(),
    batalkanPembayaranToko: vi.fn(),
  };
});
vi.mock("@/lib/konsinyasi/laporan-spg", () => ({ bahanLaporanSpg: vi.fn() }));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBayarGajiKonsi: vi.fn(async () => {}),
  kaitBayarTokoKonsi: vi.fn(async () => {}),
  kaitKirimTitipan: vi.fn(async () => {}),
  kaitSiklusKonsi: vi.fn(async () => {}),
}));

const aksi = await import("./konsinyasi");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
});

const DITOLAK = { ok: false, kode: "TANPA_AKSES" };
const kunci = () => aksi.kunciAngkaAction("c1", [], 0);
const bukaKunci = () => aksi.bukaKunciAction("c1");
const bayar = () => aksi.bayarKomisiAction("k1", undefined, 1_010_000);
const nomor = (jenis: "NOTA" | "PAJAK") => aksi.catatNomorDokumenAction("c1", jenis, "NP-202607-0058");

describe("mengunci dan membuka kunci angka: consignment:lock", () => {
  it("pengelola siklus tanpa izin kunci ditolak sebelum menyentuh penulis", async () => {
    masuk(["consignment:view", "consignment:manage", "receivables:manage"]);
    expect(await kunci()).toEqual(DITOLAK);
    expect(await bukaKunci()).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin kunci mengunci dan membuka kunci", async () => {
    masuk(["consignment:lock"]);
    expect(await kunci()).toEqual({ ok: true });
    expect(await bukaKunci()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["kunciAngka", "bukaKunci"]);
  });
});

describe("menandai gaji SPG dibayar: spg_commission:pay", () => {
  it("pengelola siklus, pemegang kunci, dan pengatur tarif komisi ditolak", async () => {
    for (const izin of [["consignment:manage"], ["consignment:lock"], ["spg_commission:manage"]]) {
      masuk(izin);
      expect(await bayar()).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin bayar menandai dibayar", async () => {
    masuk(["spg_commission:pay"]);
    expect(await bayar()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["bayarKomisi"]);
    // Yang dilihat di layar wajib angka ≥ 0; selain itu ditolak sebelum menyentuh penulis.
    state.dipanggil = [];
    for (const salah of [Number.NaN, -1, "1010000" as unknown as number]) {
      expect(await aksi.bayarKomisiAction("k1", undefined, salah)).toEqual({ ok: false, kode: "NILAI_TIDAK_VALID" });
    }
    expect(state.dipanggil).toEqual([]);
  });
});

describe("nomor nota dan nomor faktur pajak: izin masing-masing", () => {
  it("admin penjualan mengetik nomor nota, tidak nomor faktur pajak", async () => {
    masuk(["consignment:view", "consignment:note_number"]);
    expect(await nomor("NOTA")).toEqual({ ok: true });
    expect(await nomor("PAJAK")).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual(["catatNomorDokumen"]);
  });

  it("admin pajak mengetik nomor faktur pajak, tidak nomor nota", async () => {
    masuk(["consignment:view", "consignment:tax_number"]);
    expect(await nomor("PAJAK")).toEqual({ ok: true });
    expect(await nomor("NOTA")).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual(["catatNomorDokumen"]);
  });

  it("pengelola siklus dan antrean faktur nota tagihan tidak membawa nomor konsi", async () => {
    for (const izin of [["consignment:manage"], ["tax_invoices:manage"]]) {
      masuk(izin);
      expect(await nomor("NOTA")).toEqual(DITOLAK);
      expect(await nomor("PAJAK")).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("jenis selain NOTA/PAJAK ditolak di pagarnya, bahkan untuk admin", async () => {
    masuk(["*"]);
    expect(await aksi.catatNomorDokumenAction("c1", "KONSI" as unknown as "NOTA", "X-1")).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });
});

describe("menjalankan siklus tetap consignment:manage", () => {
  it("membuka siklus dan mencatat laporan: pengelola siklus boleh, pemegang izin kunci saja tidak", async () => {
    masuk(["consignment:lock", "consignment:note_number", "consignment:tax_number", "spg_commission:pay"]);
    expect(await aksi.bukaSiklusAction({ storeId: "s1", periodYear: 2026, periodMonth: 10 })).toEqual(DITOLAK);
    expect(
      await aksi.catatLaporanAction({ cycleId: "c1", source: "SPG", reportedAt: "2026-10-03", items: [] }),
    ).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);

    masuk(["consignment:manage"]);
    expect(await aksi.bukaSiklusAction({ storeId: "s1", periodYear: 2026, periodMonth: 10 })).toEqual({ ok: true });
    expect(
      await aksi.catatLaporanAction({ cycleId: "c1", source: "SPG", reportedAt: "2026-10-03", items: [] }),
    ).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["bukaSiklus", "catatLaporan"]);
  });
});

describe("admin", () => {
  it("lolos setiap pagar lewat wildcard", async () => {
    masuk(["*"]);
    expect(await kunci()).toEqual({ ok: true });
    expect(await bukaKunci()).toEqual({ ok: true });
    expect(await bayar()).toEqual({ ok: true });
    expect(await nomor("NOTA")).toEqual({ ok: true });
    expect(await nomor("PAJAK")).toEqual({ ok: true });
  });
});
